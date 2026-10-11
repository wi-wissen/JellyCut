// Keyframe index and streaming waveform against the ffmpeg fixtures.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${root}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return `${root}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: 5185, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5185/')

const r = await page.evaluate(async () => {
  const mod = (p) => import(p)
  const { KeyframeIndex } = await mod('/src/engine/media/keyframes.ts')
  const { computeWaveform } = await mod('/src/engine/audio/waveform.ts')
  const { findPauses, peaksForRange } = await mod('/src/core/audio/peaks.ts')
  const load = async (name, type) => new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type })
  const out = {}

  const kf = await KeyframeIndex.open(await load('frames.webm', 'video/webm'))
  out.kfAll = await kf.inRange(0, 3_000_000)
  out.kfBefore = await kf.before(700_000)
  out.kfAfter = await kf.after(500_000)
  out.kfAfterLast = await kf.after(2_900_000)
  out.kfBeforeFirst = await kf.before(0)
  kf.dispose()
  out.noVideo = await KeyframeIndex.open(await load('music.webm', 'audio/webm'))

  const progress = []
  const gap = await computeWaveform(await load('speech-gap.webm', 'audio/webm'), (p) => progress.push(p.fraction))
  out.gap = { duration: gap.duration, levels: gap.levels.length, bins: gap.levels[0].peaks.length }
  out.pauses = findPauses(gap, { thresholdDb: -40, minDuration: 300_000 })
  const loud = peaksForRange(gap, 200_000, 800_000, 4)
  out.loud = Array.from(loud)
  out.quiet = Array.from(peaksForRange(gap, 1_100_000, 1_500_000, 4))
  out.progressOk = progress.length > 0 && progress.at(-1) === 1 && progress.every((v, i) => i === 0 || v >= progress[i - 1])

  out.noAudio = await computeWaveform(await load('frames.webm', 'video/webm'))
  const aborted = new AbortController(); aborted.abort()
  out.aborted = await computeWaveform(await load('clip-a.webm', 'video/webm'), undefined, aborted.signal)
  const clipA = await computeWaveform(await load('clip-a.webm', 'video/webm'))
  out.clipA = { duration: clipA.duration, max: Math.max(...clipA.levels[0].peaks) }
  return out
})

let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
const near = (a, b, tol) => Math.abs(a - b) <= tol
check('keyframes come every 0.5 s in the fixture (0 .. 2.5 s)', r.kfAll.length >= 6 && r.kfAll.every((t, i) => near(t, i * 500_000, 3000)), JSON.stringify(r.kfAll))
check('before(0.7 s) is the 0.5 s keyframe, before(0) is the first one', near(r.kfBefore, 500_000, 3000) && near(r.kfBeforeFirst, 0, 3000), JSON.stringify([r.kfBefore, r.kfBeforeFirst]))
check('after(0.5 s) is the 1.0 s keyframe and after the last keyframe there is none', near(r.kfAfter, 1_000_000, 3000) && r.kfAfterLast === null, JSON.stringify([r.kfAfter, r.kfAfterLast]))
check('a file without video has no keyframe index', r.noVideo === null)
check('waveform: duration about 2.6 s with 5 ms bins', near(r.gap.duration, 2_608_000, 60_000) && Math.abs(r.gap.bins - r.gap.duration / 5000) <= 2 && r.gap.levels > 3, JSON.stringify(r.gap))
check('waveform: exactly one pause around 1.0 .. 1.6 s is found', r.pauses.length === 1 && near(r.pauses[0].start, 1_000_000, 40_000) && near(r.pauses[0].end, 1_600_000, 40_000), JSON.stringify(r.pauses))
check('waveform: tone is loud, the pause is quiet', r.loud.every((v) => v > 0.05) && r.quiet.every((v) => v < 0.01), JSON.stringify([r.loud, r.quiet]))
check('waveform: progress is monotonic and ends at 1', r.progressOk)
check('a file without audio gives null, an aborted run gives null', r.noAudio === null && r.aborted === null)
check('tone amplitude is plausible (ffmpeg sine = 0.125)', r.clipA.max > 0.08 && r.clipA.max < 0.2 && near(r.clipA.duration, 4_000_000, 80_000), JSON.stringify(r.clipA))
check('no uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
