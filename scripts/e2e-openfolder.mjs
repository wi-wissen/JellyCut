// "Open folder" in Chromium: a folder without a project becomes a new project with its media, saving writes the
// project file into the folder, opening the folder again loads it and links the media; several projects ask which.
// The browser's own file system (OPFS) stands in for the folder dialog, which headless Chromium does not have.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = 5480
const SHOT_DIR = process.env.SHOT_DIR
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
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: process.env.LOCALE ?? 'en' })
let page = await context.newPage()
function wire(page) {
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GL Driver|socket/.test(m.text())) console.log('console', m.type(), m.text().slice(0, 300)) })
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)))
  page.on('crash', () => console.log('PAGE CRASH'))
  page.on('close', () => console.log('PAGE CLOSE'))
  page.on('dialog', (d) => { console.log('dialog', d.type(), d.message().slice(0, 80)); d.accept().catch(() => undefined) })
}
let opened = false
wire(page)
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
const state = (fn, arg) => page.evaluate(`(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; return (${fn})(p._s.get('editor'), p._s.get('media'), ${JSON.stringify(arg ?? null)}) })()`)

async function openApp() {
  // Headless Chromium dies when it reloads with an OPFS handle in IndexedDB (a real folder handle is fine), so drop it.
  if (opened) await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('jellycut', 2)
    request.onsuccess = () => {
      const tx = request.result.transaction('kv', 'readwrite')
      tx.objectStore('kv').delete('workFolder')
      tx.oncomplete = () => { request.result.close(); resolve() }
    }
  }))
  if (opened) { await page.close({ runBeforeUnload: false }).catch(() => undefined); page = await context.newPage(); wire(page) }
  opened = true
  await page.goto(`http://localhost:${PORT}/app/`)
  await page.waitForSelector('header', { timeout: 10000 }).catch(async (e) => { await page.screenshot({ path: process.env.SHOT ?? '/tmp/claude-0/openfolder-fail.png' }); throw e })
  // The folder dialog is replaced by the OPFS folder "Class" (created here once, filled by seedFolder).
  await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Class', { create: true })
    window.showDirectoryPicker = async () => dir
  })
}
async function seedFolder(files) {
  await page.evaluate(async (list) => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry('Class', { recursive: true }).catch(() => undefined)
    const dir = await root.getDirectoryHandle('Class', { create: true })
    for (const [path, source] of list) {
      let d = dir
      const parts = path.split('/')
      for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true })
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable()
      await w.write(source.url ? await (await fetch(source.url)).arrayBuffer() : source.text)
      await w.close()
    }
  }, files)
}
const folderFiles = () => page.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Class')
  const names = []
  for await (const e of dir.values()) names.push(e.name)
  return names.sort()
})
async function menuOpenFolder() {
  // After a restart the relink dialog opens by itself when the restored project has missing media.
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')
  await page.locator('header button[aria-haspopup]').first().click()
  await page.getByRole('menuitem', { name: /Open folder/ }).click()
}

try {
  await openApp()
  // 1. A folder with media and no project.
  await seedFolder([
    ['clip-a.webm', { url: '/tests/fixtures/clip-a.webm' }],
    ['sub/frames.webm', { url: '/tests/fixtures/frames.webm' }]
  ])
  await menuOpenFolder()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').project.assets.length === 2, null, { timeout: 20000 })
  check('a new project named after the folder', (await state('(ed) => ed.project.name')) === 'Class')
  check('all media of the folder (also in subfolders) are imported and ready', (await state('(ed, m) => ed.project.assets.every((a) => m.statusOf(a.id) === "ready")')) === true)
  check('the asset paths are relative to the folder', JSON.stringify(await state('(ed) => ed.project.assets.map((a) => a.relPath).sort()')) === JSON.stringify(['clip-a.webm', 'sub/frames.webm']))
  check('the library says what happened', await page.getByText(/New project “Class” started: 2 files/).waitFor({ timeout: 15000 }).then(() => true, () => false))

  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/ordner-neues-projekt.png` })

  // 2. Edit and save: the project file lands in the folder.
  await state('(ed, m) => m.addToTimeline(ed.project.assets[0].id)')
  await page.waitForTimeout(300)
  await state('(ed) => ed.saveProject()')
  await page.waitForTimeout(500)
  check('saving writes the project file into the folder', (await folderFiles()).includes('Class.jellycut.json'), JSON.stringify(await folderFiles()))

  // 3. A fresh start of the app: opening the folder loads that project and links the media.
  await openApp()
  await menuOpenFolder()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('media').folderNote?.key === 'relink.folder.openedProject', null, { timeout: 20000 })
  check('the project is loaded with its clip', (await state('(ed) => ed.project.clips.length')) === 1)
  check('the media are linked from the folder, nothing is missing', (await state('(ed, m) => ed.project.assets.every((a) => m.statusOf(a.id) === "ready")')) === true)
  await state('(ed) => ed.renameProject("Renamed")')
  await state('(ed) => ed.saveProject()')
  await page.waitForTimeout(500)
  check('saving again overwrites the same file (no second project file)', JSON.stringify((await folderFiles()).filter((n) => n.endsWith('.json'))) === JSON.stringify(['Class.jellycut.json']), JSON.stringify(await folderFiles()))

  // 4. Two projects: the user picks one.
  const text = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Class')
    return (await (await dir.getFileHandle('Class.jellycut.json')).getFile()).text()
  })
  await seedFolder([
    ['clip-a.webm', { url: '/tests/fixtures/clip-a.webm' }],
    ['one.jellycut.json', { text }],
    ['two.jellycut.json', { text: text.replace('Renamed', 'Second') }]
  ])
  await openApp()
  await menuOpenFolder()
  await page.getByRole('dialog', { name: 'Which project?' }).waitFor({ timeout: 10000 })
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/ordner-mehrere-projekte.png` })
  await page.getByRole('button', { name: 'two.jellycut.json' }).click()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').project.name === 'Second', null, { timeout: 20000 })
  check('with several projects the chosen one opens', true)

  // 5. An empty folder.
  await seedFolder([])
  await openApp()
  await menuOpenFolder()
  await page.getByText(/holds no videos, sounds or pictures yet/).waitFor({ timeout: 10000 })
  check('an empty folder gives a visible note and an empty new project', (await state('(ed) => ed.project.assets.length')) === 0)
} finally {
  await browser.close()
  await server.close()
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
