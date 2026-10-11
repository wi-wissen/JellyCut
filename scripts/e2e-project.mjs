// End-to-end check of project save/load, autosave and the project menu in a real Chromium.
// Usage: node scripts/e2e-project.mjs   (optional env SHOT_DIR=<dir> writes menu screenshots there)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 5198
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR = process.env.SHOT_DIR ?? null
const workDir = mkdtempSync(join(tmpdir(), 'jellycut-e2e-'))
const PICKER_APIS = ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']
// Firefox has none of the File System Access pickers; hide them before the app scripts run.
const HIDE_PICKERS = `
for (const k of ${JSON.stringify(PICKER_APIS)}) {
  Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true });
}`

const outcomes = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(name, fn) {
  try {
    await fn()
    outcomes.push(true)
    console.log(`PASS ${name}`)
  } catch (e) {
    outcomes.push(false)
    console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`)
  }
}

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${root}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return `${root}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })

async function openPage({ firefoxLike }) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1120, height: 700 }, locale: 'en-US' })
  if (firefoxLike) await context.addInitScript(HIDE_PICKERS)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(APP_URL)
  await page.locator('#project-menu-trigger').waitFor()
  return { context, page, pageErrors }
}

const trigger = (page) => page.locator('#project-menu-trigger')
const menuItem = (page, name) => page.getByRole('menuitem', { name })

async function openMenu(page) {
  if (!(await page.locator('#project-menu-panel').isVisible())) await trigger(page).click()
  await page.locator('#project-menu-panel').waitFor()
}

async function closeMenuWithEscape(page) {
  await page.keyboard.press('Escape')
  await page.locator('#project-menu-panel').waitFor({ state: 'detached' })
}

async function waitForName(page, name) {
  await trigger(page).filter({ hasText: name }).waitFor({ timeout: 5000 })
}

async function waitForAutosaved(page) {
  await page.getByRole('img', { name: 'Autosave: saved' }).waitFor({ timeout: 5000 })
}

async function chooseFileToOpen(page, path) {
  await openMenu(page)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menuItem(page, 'Open project').click()])
  await chooser.setFiles(path)
}

// --- Firefox-like browser: no File System Access pickers ---
const firefox = await openPage({ firefoxLike: true })
const fx = firefox.page
let downloadedText = null

await check('Firefox-like: no picker APIs are exposed', async () => {
  const types = await fx.evaluate((names) => names.map((n) => typeof window[n]), PICKER_APIS)
  assert(types.every((t) => t === 'undefined'), `picker types: ${types.join(',')}`)
})

await check('Firefox-like: menu shows the browser info and no work folder item', async () => {
  await openMenu(fx)
  await fx.getByText(/Chrome or Edge/).waitFor()
  assert((await menuItem(fx, 'Choose work folder').count()) === 0, 'work folder item must be hidden')
  await closeMenuWithEscape(fx)
})

await check('Firefox-like: rename is autosaved', async () => {
  await openMenu(fx)
  await fx.locator('#project-name-input').fill('Trip Renamed')
  await waitForName(fx, 'Trip Renamed')
  await waitForAutosaved(fx)
  await closeMenuWithEscape(fx)
})

await check('Firefox-like: Ctrl+Z and Ctrl+Shift+Z undo and redo the rename', async () => {
  await fx.keyboard.press('Control+z')
  await waitForName(fx, 'Summer trip')
  await fx.keyboard.press('Control+Shift+z')
  await waitForName(fx, 'Trip Renamed')
  await waitForAutosaved(fx)
})

await check('Firefox-like: autosave survives a reload', async () => {
  await fx.reload()
  // A restored project with missing media opens the re-link dialog once; it would cover the menu.
  const relinkDialog = fx.getByRole('dialog', { name: /Missing files|Dateien fehlen/ })
  if (await relinkDialog.isVisible({ timeout: 3000 }).catch(() => false)) await fx.keyboard.press('Escape')
  await waitForName(fx, 'Trip Renamed')
})

await check('Firefox-like: Download as file writes a parsable .jellycut file', async () => {
  await openMenu(fx)
  const [download] = await Promise.all([fx.waitForEvent('download'), menuItem(fx, 'Download as file').click()])
  assert(download.suggestedFilename() === 'Trip Renamed.jellycut', `file name ${download.suggestedFilename()}`)
  downloadedText = readFileSync(await download.path(), 'utf8')
  const parsed = JSON.parse(downloadedText)
  assert(parsed.name === 'Trip Renamed', `project name ${parsed.name}`)
})

await check('Firefox-like: Open project loads a modified file via the hidden input', async () => {
  const modified = { ...JSON.parse(downloadedText), name: 'Opened Trip' }
  const path = join(workDir, 'opened.jellycut')
  writeFileSync(path, JSON.stringify(modified, null, 2))
  await chooseFileToOpen(fx, path)
  await waitForName(fx, 'Opened Trip')
})

await check('Firefox-like: an invalid file shows the alert and keeps the project', async () => {
  const path = join(workDir, 'broken.jellycut')
  writeFileSync(path, 'this is not json')
  await chooseFileToOpen(fx, path)
  await openMenu(fx)
  const alert = fx.getByRole('alert')
  await alert.waitFor()
  assert(await alert.getByText(/invalid JSON/).isVisible(), 'alert should name the JSON error')
  await waitForName(fx, 'Opened Trip')
  if (SHOT_DIR) await fx.screenshot({ path: join(SHOT_DIR, 'menu-alert-light.png') })
  await fx.getByRole('button', { name: 'Dismiss message' }).click()
  assert((await alert.count()) === 0, 'alert should be dismissed')
  await closeMenuWithEscape(fx)
})

await check('Firefox-like: no uncaught page errors', async () => {
  assert(firefox.pageErrors.length === 0, firefox.pageErrors.join(' | '))
})
await firefox.context.close()

// --- Chromium with the File System Access pickers ---
const chrome = await openPage({ firefoxLike: false })
const cr = chrome.page

await check('Chromium: picker APIs are present', async () => {
  const types = await cr.evaluate((names) => names.map((n) => typeof window[n]), PICKER_APIS)
  assert(types.every((t) => t === 'function'), `picker types: ${types.join(',')}`)
})

await check('Chromium: menu offers Choose work folder and no browser info', async () => {
  await openMenu(cr)
  assert(await menuItem(cr, 'Choose work folder').isVisible(), 'work folder item missing')
  const hits = await cr.getByText(/Chrome or Edge/).allInnerTexts()
  assert(hits.length === 0, `browser info must not be shown: ${JSON.stringify(hits)}`)
})

await check('Chromium: menu fits a 390 px phone viewport', async () => {
  await cr.setViewportSize({ width: 390, height: 800 })
  await openMenu(cr)
  const box = await cr.locator('#project-menu-panel').boundingBox()
  assert(box && box.x >= 0 && box.x + box.width <= 390, `panel box ${JSON.stringify(box)}`)
  await closeMenuWithEscape(cr)
  await cr.setViewportSize({ width: 1120, height: 700 })
})

if (SHOT_DIR) {
  for (const scheme of ['light', 'dark']) {
    await cr.emulateMedia({ colorScheme: scheme })
    await openMenu(cr)
    await cr.waitForTimeout(200)
    await cr.screenshot({ path: join(SHOT_DIR, `menu-${scheme}.png`) })
    await closeMenuWithEscape(cr)
  }
  console.log(`screenshots written to ${SHOT_DIR}`)
}

await check('Chromium: no uncaught page errors', async () => {
  assert(chrome.pageErrors.length === 0, chrome.pageErrors.join(' | '))
})
await chrome.context.close()

await browser.close()
await server.close()
rmSync(workDir, { recursive: true, force: true })

const failed = outcomes.filter((ok) => !ok).length
console.log(failed === 0 ? `ALL ${outcomes.length} CHECKS PASSED` : `${failed} of ${outcomes.length} CHECKS FAILED`)
process.exit(failed === 0 ? 0 : 1)
