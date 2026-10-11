// Real-browser check of the live preview: frame-exact seeking, stepping, and playback through the UI.
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

const server = await createServer({ server: { port: 5188, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }

const store = (name) => page.evaluate((n) => { const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n); return null }, name)
const state = (fn, arg) => page.evaluate(`(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const ed = p._s.get('editor'); const me = p._s.get('media'); return (${fn})(ed, me, ${JSON.stringify(arg ?? null)}) })()`)

// Reads the frame number encoded in the preview canvas by screenshotting it (a WebGL canvas cannot be read directly).
async function canvasBits() {
  const buf = await page.locator('canvas').first().screenshot()
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    let n = 0
    for (let b = 0; b < 8; b++) {
      const d = ctx.getImageData(Math.round(((b * 20 + 10) / 160) * bmp.width), Math.round(bmp.height / 2), 1, 1).data
      if (d[0] > 127) n |= 1 << b
    }
    return n
  }, buf.toString('base64'))
}
async function settle(expected, tol = 0, timeout = 6000) {
  const t0 = Date.now()
  let got = -1
  while (Date.now() - t0 < timeout) {
    got = await canvasBits()
    if (Math.abs(got - expected) <= tol) return { ok: true, got }
    await page.waitForTimeout(100)
  }
  return { ok: false, got }
}

await page.goto('http://localhost:5188/app/')
await page.waitForSelector('header')
// Fresh project, then import the frame-coded clip and put it on the timeline.
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/frames.webm'))
await page.waitForFunction(() => document.querySelectorAll('[data-asset-id], button[aria-label*="frames.webm"]').length > 0 || document.body.innerText.includes('frames.webm'))
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.waitForTimeout(500)
const clipCount = await state('(ed) => ed.project.clips.length')
check('importing and clicking the tile puts one clip on the timeline', clipCount === 1, String(clipCount))
check('player shows the empty hint only without clips', !(await page.locator('text=No video yet').count()))

// Frame-exact seeking through the playhead.
const rows = []
for (const n of [0, 1, 2, 14, 15, 16, 29, 30, 59, 89, 45, 3]) {
  await state('(ed, me, n) => ed.setPlayhead(Math.round(n * 1000000 / 30))', n)
  const r = await settle(n)
  rows.push([n, r.got])
}
check('paused preview shows exactly the frame under the playhead (12 seeks, forwards and backwards)', rows.every(([n, g]) => n === g), JSON.stringify(rows))

// Single-frame stepping.
await state('(ed) => ed.setPlayhead(Math.round(10 * 1000000 / 30))')
await settle(10)
await page.getByRole('button', { name: /Forward one frame/ }).click()
const s1 = await settle(11)
await page.getByRole('button', { name: /Back one frame/ }).click()
await page.getByRole('button', { name: /Back one frame/ }).click()
const s2 = await settle(9)
check('frame buttons step exactly one frame', s1.ok && s2.ok, JSON.stringify([s1, s2]))

// Playback.
await state('(ed) => ed.setPlayhead(0)')
await settle(0)
await page.getByRole('button', { name: /^Play$/ }).click()
await page.waitForTimeout(1200)
const midPlaying = await state('(ed) => ({ playing: ed.isPlaying, t: ed.playheadMicros })')
await page.getByRole('button', { name: /^Pause$/ }).click()
await page.waitForTimeout(400)
const afterPause = await state('(ed) => ({ playing: ed.isPlaying, t: ed.playheadMicros })')
check('playing advances the playhead in real time', midPlaying.playing && midPlaying.t > 700_000 && midPlaying.t < 2_400_000, JSON.stringify(midPlaying))
check('pause stops the playhead', !afterPause.playing && afterPause.t >= midPlaying.t)
const frameAtPause = Math.round((afterPause.t * 30) / 1_000_000)
const r3 = await settle(frameAtPause, 1)
check('after pausing the canvas shows the frame at the playhead (exact decode)', r3.ok, `expected ${frameAtPause} got ${r3.got}`)

// Playback reaches the end and stops by itself.
await state('(ed) => ed.setPlayhead(Math.round(2.6 * 1000000))')
await page.getByRole('button', { name: /^Play$/ }).click()
await page.waitForFunction(() => !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').isPlaying, null, { timeout: 8000 })
const end = await state('(ed) => ({ t: ed.playheadMicros, total: ed.totalDuration })')
check('playback stops at the end of the project', end.t >= end.total - 40_000, JSON.stringify(end))

// Space bar toggles playback, but not while typing in a field.
await page.locator('body').click({ position: { x: 5, y: 400 } })
await state('(ed) => ed.setPlayhead(0)')
await page.keyboard.press('Space')
await page.waitForTimeout(300)
const spacePlaying = await state('(ed) => ed.isPlaying')
await page.keyboard.press('Space')
await page.waitForTimeout(200)
const spaceStopped = !(await state('(ed) => ed.isPlaying'))
check('space bar starts and stops playback', spacePlaying && spaceStopped)

// Aspect ratio follows the project format.
await state('(ed) => { const p = JSON.parse(JSON.stringify(ed.project)); p.format.ratio = "9:16"; p.format.width = 1080; p.format.height = 1920; ed.commitProject(p) }')
await page.waitForTimeout(400)
const box = await page.locator('canvas').first().boundingBox()
check('the player box follows the project aspect ratio (9:16)', Math.abs(box.width / box.height - 9 / 16) < 0.02, JSON.stringify(box))
check('no uncaught page errors', errors.length === 0, errors.join('; '))

await page.screenshot({ path: process.env.SHOT ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad/preview.png' })
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
