// Phone video with rotation metadata (tests/fixtures/clip-c-rotated.mp4: coded 640x360, rotated, shown 360x640):
// the paused picture (WebCodecs) and the playing picture (<video> element) must show it the same way.
import { chromium, firefox } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = 5470
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const FIREFOX = process.env.BROWSER === 'firefox'
const browser = FIREFOX
  ? await firefox.launch({ headless: !process.env.DISPLAY, firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } })
  : await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en' })).newPage()
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
const state = (fn) => page.evaluate(`(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const ed = p._s.get('editor'); return (${fn})(ed) })()`)

// Bounding box of the strongly red pixels of the preview canvas, as fractions of the canvas.
async function redBox() {
  // A screenshot of the canvas element: reading a WebGL canvas back directly is blank in some browsers.
  const shot = await page.locator('canvas').first().screenshot()
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height)
    let x0 = width, y0 = height, x1 = -1, y1 = -1
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    }
    if (x1 < 0) return null
    return [x0 / width, y0 / height, x1 / width, y1 / height].map((v) => Math.round(v * 100) / 100)
  }, shot.toString('base64'))
}

try {
  await page.goto(`http://localhost:${PORT}/app/`)
  await page.waitForSelector('header')
  await page.locator('header button[aria-haspopup]').first().click()
  await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await page.keyboard.press('Escape')
  await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/clip-c-rotated.mp4'))
  await page.getByRole('button', { name: /clip-c-rotated\.mp4/ }).first().click({ timeout: 15000 })
  await page.waitForTimeout(1000)

  const asset = await state('(ed) => ed.project.assets[0]')
  check('the asset size is the display size (portrait 360x640)', asset.width === 360 && asset.height === 640, `${asset.width}x${asset.height}`)

  await state('(ed) => ed.setPlayhead(100000)')
  await page.waitForTimeout(800)
  const paused = await redBox()
  console.log('INFO paused red box', JSON.stringify(paused))
  check('the paused picture shows the red marker', paused !== null)

  await page.getByRole('button', { name: /^Play$/ }).click()
  await page.waitForTimeout(500)
  const samples = []
  for (let i = 0; i < 4; i++) { samples.push(await redBox()); await page.waitForTimeout(150) }
  await page.getByRole('button', { name: /^Pause$/ }).click()
  console.log('INFO playing red boxes', JSON.stringify(samples))
  const close = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 0.06)
  check('while playing the marker is where it was when paused (same rotation, same aspect)', samples.every((s) => close(s, paused)), JSON.stringify(samples))

  // Turning the portrait clip by 90 degrees makes a landscape picture: it must fill the landscape output.
  await state('(ed) => { ed.select({ kind: "clip", id: ed.project.clips[0].id }); ed.rotateSelected() }')
  await page.waitForTimeout(500)
  const turned = await redBox()
  console.log('INFO turned red box', JSON.stringify(turned))
  const corner = turned && (turned[0] < 0.02 || turned[2] > 0.98) && (turned[1] < 0.02 || turned[3] > 0.98)
  check('after the quarter turn the picture fills the whole output (marker sits in a corner)', !!corner, JSON.stringify(turned))
} finally {
  await browser.close()
  await server.close()
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
