// Offline and install check of the PRODUCTION build: manifest, service worker, update toast, offline use.
// The preview server emulates GitHub Pages for unknown paths (dist/404.html with status 404).
import { chromium } from 'playwright-core'
import { preview } from 'vite'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}
if (!existsSync(join(dist, 'app/index.html'))) { console.error('Run npm run build first'); process.exit(2) }

const PORT = 5260
const origin = `http://localhost:${PORT}`
let swBumped = false

const pagesLike = {
  name: 'pages-like-hosting',
  configurePreviewServer(server) {
    server.middlewares.use('/__e2e/bump-sw', (_req, res) => {
      swBumped = true
      res.end('ok')
    })
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent(req.url.split('?')[0])
      if (swBumped && path === '/sw.js') {
        // A byte-different worker with a new build id, as a new deployment would bring.
        const source = readFileSync(join(dist, 'sw.js'), 'utf8').replace(/const BUILD_ID = "[^"]+"/, 'const BUILD_ID = "e2e-bumped"')
        res.setHeader('content-type', 'text/javascript')
        return res.end(source)
      }
      const target = join(dist, path)
      const exists = existsSync(target) && (statSync(target).isFile() || existsSync(join(target, 'index.html')))
      if (exists || path === '/') return next()
      res.statusCode = 404
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(readFileSync(join(dist, '404.html')))
    })
  }
}

const server = await preview({ root, plugins: [pagesLike], preview: { port: PORT, strictPort: true }, base: './' })
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en', serviceWorkers: 'allow' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
// The 404 checks below request an unknown path on purpose; its console error is expected.
page.on('console', (m) => m.type() === 'error' && !/favicon|does-not-exist/.test(m.location().url) && errors.push(m.text()))

let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }

// 1) Manifest: reachable, installable icons, linked from every real page.
const manifest = await (await fetch(`${origin}/manifest.webmanifest`)).json()
check('manifest is reachable and named Jelly Cut', manifest.name === 'Jelly Cut' && manifest.theme_color === '#6D4CF5')
const pngs = manifest.icons.filter((i) => i.type === 'image/png')
const iconStatus = await Promise.all(manifest.icons.map(async (i) => (await fetch(new URL(i.src, `${origin}/manifest.webmanifest`))).status))
check('manifest lists 192 and 512 PNG icons, incl. maskable', ['192x192', '512x512'].every((s) => pngs.some((i) => i.sizes === s && i.purpose === 'any')) && pngs.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'))
check('every manifest icon is served (HTTP 200)', iconStatus.every((s) => s === 200), iconStatus.join(','))
for (const path of ['/', '/app/', '/help/sources/']) {
  await page.goto(`${origin}${path}`)
  const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href ?? '')
  check(`manifest link on ${path}`, (await fetch(href)).status === 200, href)
}

// 2) Service worker registers and precaches the shell on the first visit.
await page.goto(`${origin}/`)
await page.evaluate(() => navigator.serviceWorker.ready)
const reg = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => ({ scope: r.scope, state: r.active?.state })))
check('service worker is registered and active with scope at the site root', reg.state === 'activated' && reg.scope === `${origin}/`, JSON.stringify(reg))
await page.reload()
await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
const precached = await page.evaluate(async () => {
  const names = (await caches.keys()).filter((k) => k.startsWith('jellycut-'))
  const keys = (await caches.open(names[0])).keys().then((ks) => ks.map((k) => new URL(k.url).pathname))
  return { names, keys: await keys }
})
check('exactly one versioned cache holds the precache', precached.names.length === 1, JSON.stringify(precached.names))
check('precache holds pages, the editor worker and icons', ['/', '/app/', '/help/sources/', '/404.html', '/manifest.webmanifest'].every((p) => precached.keys.includes(p)) && precached.keys.some((p) => /export\.worker-.*\.js$/.test(p)) && precached.keys.some((p) => p.endsWith('icon-maskable-512.png')), String(precached.keys.length))
check('no media files are precached', !precached.keys.some((p) => /\.(webm|mp4|mp3|wav|m4a)$/i.test(p)))

// 3) Online: the editor page works, unknown paths show the 404 page with status 404.
await page.goto(`${origin}/app/`)
await page.waitForSelector('header')
check('/app/ renders online and is controlled by the worker', await page.evaluate(() => navigator.serviceWorker.controller !== null))
const notFound = await page.goto(`${origin}/does-not-exist/`)
check('unknown path online: status 404 with the 404 page', notFound?.status() === 404 && (await page.content()).includes('Seite nicht gefunden'))

// 4) Update: a new build waiting shows the toast; accepting it reloads into the new worker.
await fetch(`${origin}/__e2e/bump-sw`)
await page.goto(`${origin}/app/`)
await page.waitForSelector('header')
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
const reloadButton = page.getByRole('button', { name: 'Reload' })
await reloadButton.waitFor({ timeout: 20000 })
check('update toast appears when a new worker waits', await page.getByRole('status').getByText('Update available').isVisible())
await Promise.all([page.waitForEvent('load'), reloadButton.click()])
await page.waitForSelector('header')
await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
const after = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('jellycut-')))
check('after the update the old cache is removed', after.length === 1 && after[0] === 'jellycut-e2e-bumped', JSON.stringify(after))
check('toast is gone after the reload', (await page.getByRole('button', { name: 'Reload' }).count()) === 0)

// 5) Offline: the server is gone and the network is off; everything comes from the worker.
await context.setOffline(true)
await new Promise((r) => { server.httpServer.closeAllConnections?.(); server.httpServer.close(r) })
await page.goto(`${origin}/app/`)
await page.locator('header button[aria-haspopup]').first().waitFor({ timeout: 15000 })
await page.locator('header button[aria-haspopup]').first().click()
check('/app/ opens offline and the editor script runs', await page.getByRole('menuitem', { name: /New project/ }).isVisible())
await page.keyboard.press('Escape')
await page.goto(`${origin}/`)
check('landing page opens offline', (await page.locator('h1').innerText()).includes('Jelly Cut'))
await page.goto(`${origin}/help/sources/`)
check('guide opens offline', (await page.locator('h1').count()) === 1)
const offlineMissing = await page.goto(`${origin}/does-not-exist/`)
check('unknown path offline: 404 page from the worker, status 404', offlineMissing?.status() === 404 && (await page.content()).includes('Seite nicht gefunden'), String(offlineMissing?.status()))
check('no uncaught page errors or console errors', errors.length === 0, errors.join('; '))

await browser.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
