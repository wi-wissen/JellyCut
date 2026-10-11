// Smoke test of the PRODUCTION build served like static hosting: real pages, relative paths, a worker export.
import { chromium } from 'playwright-core'
import { preview } from 'vite'
import { existsSync, readdirSync, statSync } from 'node:fs'
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
if (!existsSync(join(root, 'dist/app/index.html'))) { console.error('Run npm run build first'); process.exit(2) }

// Serve dist/ under a sub path, as a project page would be: this proves nothing depends on the root.
const server = await preview({ root, preview: { port: 5177, strictPort: true }, base: './' })
const origin = 'http://localhost:5177'
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en' })
const errors = []
const failedRequests = []
const requested = new Set()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()))
page.on('requestfailed', (r) => !/favicon/.test(r.url()) && failedRequests.push(r.url()))
page.on('response', (r) => { requested.add(new URL(r.url()).pathname); if (r.status() >= 400 && !/favicon/.test(r.url())) failedRequests.push(`${r.status()} ${r.url()}`) })
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }

// 1) Landing page loads without the editor code.
await page.goto(`${origin}/`)
await page.waitForSelector('h1')
const landingJs = [...requested].filter((p) => p.endsWith('.js'))
check('landing page renders', (await page.locator('header').innerText()).includes('Jelly Cut') && (await page.locator('h1').count()) === 1)
check('landing page does not load the editor, mediabunny or the export worker', !landingJs.some((p) => /EditorView|mediabunny|worker|exporter/i.test(p)) && landingJs.length <= 3, landingJs.join(', '))
await page.getByRole('link', { name: /Open editor|Editor öffnen/ }).first().click()
await page.waitForURL(/\/app\/$/)
await page.waitForSelector('header')
check('the landing link opens the editor at /app/', true)

// 2) Direct visit of the editor and the guide page (real files, no fallback needed).
const direct = await page.goto(`${origin}/app/`)
check('/app/ is a real page (HTTP 200)', direct?.status() === 200)
// Every help page in dist/help/**/index.html must be a real page with one heading and the shared frame.
const helpPages = []
const walkHelp = (dir, rel) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkHelp(path, `${rel}${name}/`)
    else if (name === 'index.html') helpPages.push(`/help/${rel}`)
  }
}
walkHelp(join(root, 'dist/help'), '')
check(`help: ${helpPages.length} help pages are built`, helpPages.length >= 8, helpPages.join(' '))
for (const path of helpPages) {
  const response = await page.goto(`${origin}${path}`)
  await page.waitForSelector('h1')
  const frame = (await page.locator('header a[href]').count()) > 0 && (await page.locator('footer').count()) === 1
  check(`help page ${path} is a real page (HTTP 200) with one heading and the shared frame`, response?.status() === 200 && (await page.locator('h1').count()) === 1 && frame, String(response?.status()))
}
await page.goto(`${origin}/app/`)
await page.waitForSelector('canvas')

// 3) A complete production workflow: new project, import, play, export.
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project/ }).click()
await page.keyboard.press('Escape')
await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/frames.webm'))
await page.getByRole('button', { name: /frames\.webm/ }).first().click({ timeout: 15000 })
await page.waitForTimeout(500)
const clipCount = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').project.clips.length)
check('production build: import puts a clip on the timeline', clipCount === 1)
await page.getByRole('button', { name: /^Play$/ }).click()
await page.waitForTimeout(800)
const playing = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').playheadMicros)
await page.getByRole('button', { name: /^Pause$/ }).click()
check('production build: playback advances', playing > 300_000, String(playing))

await page.locator('#export-button, header button:has-text("Export")').first().click()
await page.getByRole('radio', { name: '480p' }).click().catch(() => undefined)
await page.getByRole('button', { name: /Start export/ }).click()
await page.waitForSelector('text=Done', { timeout: 60000 })
check('production build: export finishes in the worker (the finished state appears)', true)
check('the export worker file was requested from the built assets', [...requested].some((p) => /export\.worker|worker/i.test(p)))

check('no failed requests (404s or network errors)', failedRequests.length === 0, failedRequests.join('; '))
check('no console errors or uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await new Promise((r) => server.httpServer.close(r))
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
