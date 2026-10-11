// Playback quality: the picture must follow the playhead while playing (also on a slow CPU), without seek storms.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: 5180, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en' })
// Count every write to HTMLMediaElement.currentTime (a seek).
await context.addInitScript(() => {
  window.__seeks = 0
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get: d.get, set(v) { window.__seeks++; d.set.call(this, v) }, configurable: true })
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
const state = (fn, arg) => page.evaluate(`(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const ed = p._s.get('editor'); return (${fn})(ed, ${JSON.stringify(arg ?? null)}) })()`)

async function canvasBits() {
  const box = await page.locator('canvas').first().boundingBox()
  const buf = await page.screenshot({ clip: box })
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    let n = 0
    for (let b = 0; b < 10; b++) {
      const d = ctx.getImageData(Math.round(((b * 64 + 32) / 640) * bmp.width), Math.round(bmp.height / 2), 1, 1).data
      if (d[0] > 127) n |= 1 << b
    }
    return n
  }, buf.toString('base64'))
}

await page.goto('http://localhost:5180/app/')
await page.waitForSelector('header')
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
await page.keyboard.press('Escape')
await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/long-frames.webm'))
await page.getByRole('button', { name: /long-frames\.webm/ }).first().click({ timeout: 15000 })
await page.waitForTimeout(600)
check('the long clip is on the timeline (10 s)', (await state('(ed) => ed.totalDuration')) >= 9_900_000)

// Samples (playhead frame, displayed frame) taken INSIDE the page, in the same animation frame, so the
// two values belong to the same instant (a Playwright screenshot is far too slow for this).
async function startSampler() {
  await page.evaluate(() => {
    window.__samples = []
    window.__sampling = true
    const canvas = document.querySelector('canvas')
    const probe = new OffscreenCanvas(canvas.width, canvas.height)
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    const ed = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor')
    const loop = () => {
      if (!window.__sampling) return
      if (probe.width !== canvas.width) { probe.width = canvas.width; probe.height = canvas.height }
      ctx.drawImage(canvas, 0, 0)
      let n = 0
      for (let b = 0; b < 10; b++) {
        const d = ctx.getImageData(Math.round(((b * 64 + 32) / 640) * canvas.width), Math.round(canvas.height / 2), 1, 1).data
        if (d[0] > 127) n |= 1 << b
      }
      window.__samples.push({ ph: ed.playheadMicros, shown: n, at: performance.now() })
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
}
async function stopSampler() {
  return page.evaluate(() => { window.__sampling = false; return window.__samples })
}
const lagOf = (samples) => samples.filter((s) => s.shown > 0 || s.ph > 300_000).map((s) => Math.round((s.ph * 30) / 1_000_000) - s.shown)
const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))]

async function playAndSample(seconds, label) {
  await state('(ed) => ed.setPlayhead(0)')
  await page.waitForTimeout(500)
  await page.evaluate(() => { window.__seeks = 0 })
  await page.getByRole('button', { name: /^Play$/ }).click()
  await startSampler()
  await page.waitForTimeout(seconds * 1000)
  const samples = await stopSampler()
  const end = await state('(ed) => ed.playheadMicros')
  await page.getByRole('button', { name: /^Pause$/ }).click()
  const seeks = await page.evaluate(() => window.__seeks)
  const lag = lagOf(samples)
  const good = lag.filter((d) => Math.abs(d) <= 6).length / lag.length
  console.log(`INFO ${label}: ${samples.length} samples, playhead moved ${(end / 1e6).toFixed(2)} s in ${seconds} s, seeks ${seeks}, lag p50 ${pct(lag, 0.5)} p95 ${pct(lag, 0.95)} min ${Math.min(...lag)} max ${Math.max(...lag)} frames`)
  return { samples, end, seeks, good, lag }
}

const normal = await playAndSample(3.5, 'normal CPU')
check('normal CPU: playhead advances in real time (+-30 %)', normal.end > 3_500_000 * 0.7 && normal.end < 3_500_000 * 1.3, String(normal.end))
check('normal CPU: the picture matches the playhead (within 6 frames) in at least 90 % of samples', normal.good >= 0.9, `${(normal.good * 100).toFixed(0)} %`)
check('normal CPU: no seek storm (at most 6 seeks in 3.5 s of playback)', normal.seeks <= 6, String(normal.seeks))

// A slow machine: 6x CPU throttle through the DevTools protocol.
const cdp = await context.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
const slow = await playAndSample(3.5, 'CPU throttled 6x')
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
check('slow CPU: the picture follows the playhead (|lag| <= 12 frames at the 95th percentile)', Math.max(Math.abs(pct(slow.lag, 0.05)), Math.abs(pct(slow.lag, 0.95))) <= 12, `p5 ${pct(slow.lag, 0.05)} p95 ${pct(slow.lag, 0.95)}`)
check('slow CPU: no seek storm (at most 10 seeks)', slow.seeks <= 10, String(slow.seeks))
check('slow CPU: playback still makes progress', slow.end > 1_500_000, String(slow.end))

// Two clips of the same file back to back (a cut in the middle of playback).
await state('(ed) => { ed.setPlayhead(5000000); ed.splitAtPlayhead() }')
await page.waitForTimeout(300)
check('split created two clips', (await state('(ed) => ed.project.clips.length')) === 2)
await state('(ed) => ed.setPlayhead(4000000)')
await page.waitForTimeout(500)
await page.getByRole('button', { name: /^Play$/ }).click()
await startSampler()
await page.waitForTimeout(3000)
const across = await stopSampler()
await page.getByRole('button', { name: /^Pause$/ }).click()
const acrossLag = lagOf(across)
check('playback runs across a cut between two clips of the same file', across.some((x) => x.ph < 4_900_000) && across.some((x) => x.ph > 5_200_000), `${across[0]?.ph} .. ${across.at(-1)?.ph}`)
check('across the cut the picture follows the playhead (|lag| <= 8 frames in 90 % of samples)', acrossLag.filter((d) => Math.abs(d) <= 8).length / acrossLag.length >= 0.9, `p5 ${pct(acrossLag, 0.05)} p95 ${pct(acrossLag, 0.95)}`)
// No frozen picture: the shown frame number keeps changing while the playhead runs.
const changes = across.filter((x, i) => i > 0 && x.shown !== across[i - 1].shown).length
check('the picture keeps changing while playing (no freeze)', changes > across.length * 0.35, `${changes} changes in ${across.length} frames`)

check('no uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
