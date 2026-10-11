// Real-browser check of the media probe against the ffmpeg fixtures in tests/fixtures.
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

const server = await createServer({ server: { port: 5193, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5193/')

const results = await page.evaluate(async () => {
  const { probeFile } = await import('/src/engine/media/probe.ts')
  const load = async (name, type) => new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type })
  const out = {}
  const timed = async (key, file) => { const t0 = performance.now(); out[key] = await probeFile(file); out[key].ms = Math.round(performance.now() - t0) }
  await timed('a', await load('clip-a.webm', 'video/webm'))
  await timed('b', await load('clip-b-portrait.mp4', 'video/mp4'))
  await timed('music', await load('music.webm', 'audio/webm'))
  await timed('still', await load('still.png', 'image/png'))
  await timed('junk', new File([new Uint8Array(5000).fill(7)], 'junk.mp4', { type: 'video/mp4' }))
  await timed('empty', new File([], 'empty.mov'))
  const avc = await VideoDecoder.isConfigSupported({ codec: 'avc1.42001f', codedWidth: 640, codedHeight: 360 })
  out.h264Supported = avc.supported
  return out
})

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`)
  if (!ok) failed++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const a = results.a, b = results.b
check('video: kind, size and fps', a.kind === 'video' && a.width === 640 && a.height === 360 && near(a.fps, 30, 0.5), JSON.stringify(a))
check('video: duration is about 4 s in whole microseconds', Number.isInteger(a.duration) && near(a.duration, 4_000_000, 100_000), String(a.duration))
check('video: codecs known, audio detected, no problems', a.videoCodec === 'vp9' && a.audioCodec === 'opus' && a.hasAudio && a.problems.length === 0, JSON.stringify(a))
check('probe is fast (no decoding)', a.ms < 1500, `${a.ms} ms`)
check('portrait mp4: size and fps', b.width === 480 && b.height === 640 && near(b.fps, 25, 0.5), JSON.stringify(b))
check('h264 is flagged exactly when this browser cannot decode it', results.h264Supported === !b.problems.includes('cannot-decode-video') || b.videoCodec !== 'avc', `supported=${results.h264Supported} problems=${b.problems}`)
check('audio file', results.music.kind === 'audio' && !results.music.width && near(results.music.duration, 5_000_000, 100_000) && results.music.hasAudio, JSON.stringify(results.music))
check('image: size, zero duration', results.still.kind === 'image' && results.still.width === 320 && results.still.height === 180 && results.still.duration === 0, JSON.stringify(results.still))
check('junk file is reported, not thrown', results.junk.problems.length > 0, JSON.stringify(results.junk))
check('empty file is reported, not thrown', results.empty.problems.length > 0, JSON.stringify(results.empty))
check('no uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
