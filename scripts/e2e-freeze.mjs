// Real-browser check of the freeze frame (Standbild): the preview and the exported MP4 hold the frame under the
// playhead for the freeze length, then play on from the same place in the source.
// tests/fixtures/frames.webm encodes its frame number in 8 blocks (see e2e-frames.mjs).
// Usage: node scripts/e2e-freeze.mjs
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5220
const ORIGIN = `http://localhost:${PORT}`
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
mkdirSync(SHOT_DIR, { recursive: true })
const S = 1_000_000

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`)
  if (!ok) failed++
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
// The download path of Save: no save picker, so the file arrives as a download.
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 }, locale: 'en-US' })
await context.addInitScript(`Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true });`)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))

/** Reads from the Pinia stores in the page. fn is (editor, exporter) => value, written as source. */
const state = (fn) =>
  page.evaluate(`(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; return (${fn})(p._s.get('editor'), p._s.get('export')) })()`)

/** The frame number in the preview canvas, read from a screenshot (WebGL canvases cannot be read directly). */
async function canvasBits() {
  const buf = await page.locator('canvas').first().screenshot()
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    let n = 0
    for (let b = 0; b < 8; b++) {
      const d = ctx.getImageData(Math.round(((b * 20 + 10) / 160) * bmp.width), Math.round(bmp.height / 2), 1, 1).data
      if (d[0] > 127) n |= 1 << b
    }
    return n
  }, buf.toString('base64'))
}

async function previewShows(t, expected) {
  await state(`(ed) => ed.setPlayhead(${t})`)
  const t0 = Date.now()
  let got = -1
  while (Date.now() - t0 < 6000) {
    got = await canvasBits()
    if (got === expected) return { ok: true, got }
    await page.waitForTimeout(120)
  }
  return { ok: false, got }
}

// ---------- Setup: 3 s fixture on the timeline, playhead at 1 s (frame 30) ----------
await page.goto(`${ORIGIN}/app/`)
await page.waitForSelector('header')
await page.locator('#project-menu-trigger').click()
await page.getByRole('menuitem', { name: /New project/ }).click()
await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/frames.webm'))
await page.getByRole('button', { name: /^Add frames\.webm to the timeline/ }).waitFor({ timeout: 20000 })
await page.getByRole('button', { name: /^Add frames\.webm to the timeline/ }).click()
await state('(ed) => ed.setPlayhead(1000000)')
await page.getByRole('button', { name: 'Clip: frames.webm', exact: true }).first().click()
const freezeButton = page.getByRole('button', { name: /^(Freeze frame at playhead|Standbild am Abspielkopf)$/ })
await freezeButton.waitFor({ timeout: 5000 })
check('the freeze button is enabled with the playhead on the clip', await freezeButton.isEnabled())
await freezeButton.click()
await page.waitForTimeout(200)
const clips = await state('(ed) => ed.project.clips.map((c) => ({ id: c.id, start: c.start, srcIn: c.srcIn, srcOut: c.srcOut, speed: c.speed, still: c.still ?? null, muted: c.muted }))')
check('the timeline now has the clip split around a 2 s freeze frame', clips.length === 3, JSON.stringify(clips))
const [left, frame, right] = clips
check('the freeze frame holds frame 30 (1 s) from 1 s to 3 s, with no sound', frame?.still === S && frame.start === S && frame.srcOut - frame.srcIn === 2 * S && frame.muted === true, JSON.stringify(frame))
check('the right part continues from source 1 s at 3 s', right?.start === 3 * S && right.srcIn === S && left.srcOut === S, JSON.stringify([left, right]))
await page.screenshot({ path: join(SHOT_DIR, 'freeze-clip-panel.png') })

// ---------- Preview: the frozen frame holds, then playback continues in the source ----------
const previewChecks = [
  [0.5 * S, 15, 'preview before the freeze shows frame 15'],
  [1.5 * S, 30, 'preview inside the freeze shows frame 30'],
  [2.5 * S, 30, 'preview near the end of the freeze still shows frame 30'],
  [3.5 * S, 45, 'preview after the freeze continues at frame 45']
]
for (const [t, expected, name] of previewChecks) {
  const r = await previewShows(t, expected)
  check(name, r.ok, `expected ${expected}, got ${r.got}`)
}

// ---------- Export: the MP4 from the same project shows the same frames ----------
await page.locator('#export-button').click()
const dialog = page.getByRole('dialog', { name: /Export video/ })
await dialog.waitFor({ timeout: 5000 })
await page.getByRole('radio', { name: '480p', exact: true }).click({ force: true })
await page.getByRole('radio', { name: '30', exact: true }).click({ force: true })
const start = page.getByRole('button', { name: 'Start export', exact: true })
for (let i = 0; i < 150 && !(await start.isEnabled().catch(() => false)); i++) await page.waitForTimeout(100)
// The finished file is saved automatically (download path, no file dialog in headless Chromium).
const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
await start.click()
const download = await downloadPromise
const savedPath = join(SHOT_DIR, 'freeze-export.mp4')
await download.saveAs(savedPath)
const bytesB64 = readFileSync(savedPath).toString('base64')
check('the export downloads an MP4', readFileSync(savedPath).toString('latin1', 4, 8) === 'ftyp')

const exported = await page.evaluate(async (b64) => {
  const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
  const { frameStart } = await import('/src/core/time.ts')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const provider = new ExactFrameProvider()
  provider.setFile('o', new File([bytes], 'out.mp4', { type: 'video/mp4' }), false)
  const bits = (canvas) => {
    const c = new OffscreenCanvas(canvas.width, canvas.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const sx = canvas.width / 160, sy = canvas.height / 90
    let n = 0
    for (let b = 0; b < 8; b++) {
      const d = ctx.getImageData(Math.round((b * 20 + 10) * sx), Math.round(45 * sy), 1, 1).data
      if (d[0] > 127) n |= 1 << b
    }
    return n
  }
  const out = []
  // Output frames at 30 fps: the still covers frames 30..89, the source continues from frame 30 at frame 90.
  for (const k of [0, 10, 29, 30, 45, 60, 89, 90, 120, 149]) {
    const f = await provider.getFrame('o', frameStart(k, 30))
    out.push([k, f ? bits(f) : null])
  }
  await provider.dispose()
  return out
}, bytesB64)
const expectedFrame = (k) => (k < 30 ? k : k < 90 ? 30 : k - 60)
const badFrames = exported.filter(([k, got]) => got !== expectedFrame(k))
check('exported frames: 0..29 play, 30..89 hold frame 30, 90 on continues at 30', badFrames.length === 0, JSON.stringify(exported.map(([k, g]) => [k, g, expectedFrame(k)])))

check('the editor reported no uncaught errors', errors.length === 0, errors.join(' | '))
await browser.close()
await server.close()
console.log(failed === 0 ? 'all checks passed' : `${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
