// Real-browser check of re-linking missing media: banner, dialog (files, drop, duplicates, wrong file),
// the work folder flow with a stubbed File System Access picker, path traversal and access re-grant.
// Usage: node scripts/e2e-relink.mjs   (screenshots go to the scratchpad directory)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5182
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
mkdirSync(SHOT_DIR, { recursive: true })
const fixture = (name) => join(root, 'tests/fixtures', name)

// Files the test writes: a renamed copy and two identical copies in different folders.
const workDir = mkdtempSync(join(tmpdir(), 'jellycut-relink-'))
const renamedPath = join(workDir, 'renamed.webm')
mkdirSync(join(workDir, 'copy1'))
mkdirSync(join(workDir, 'copy2'))
const copy1Path = join(workDir, 'copy1', 'frames.webm')
const copy2Path = join(workDir, 'copy2', 'frames.webm')
copyFileSync(fixture('frames.webm'), renamedPath)
copyFileSync(fixture('frames.webm'), copy1Path)
copyFileSync(fixture('frames.webm'), copy2Path)

const framesBytes = readFileSync(fixture('frames.webm')).toString('base64')
const clipBytes = readFileSync(fixture('clip-a.webm')).toString('base64')

// Fake work folder: a directory handle in memory. Its bytes are the real fixtures.
// Structured clone cannot store it, so the app keeps it in memory for this page only.
const FOLDER_STUB = ({ frames, clip }) => {
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const notFound = (name) => new DOMException(`${name} not found`, 'NotFoundError')
  window.__calls = []
  window.__perm = 'granted'
  const fileHandle = (name, b64) => ({
    kind: 'file',
    name,
    async getFile() {
      return new File([bytes(b64)], name, { type: 'video/webm' })
    }
  })
  const dirHandle = (name, entries) => ({
    kind: 'directory',
    name,
    async getDirectoryHandle(n) {
      window.__calls.push(['dir', n])
      const e = entries.get(n)
      if (!e || e.kind !== 'directory') throw notFound(n)
      return e
    },
    async getFileHandle(n) {
      window.__calls.push(['file', n])
      const e = entries.get(n)
      if (!e || e.kind !== 'file') throw notFound(n)
      return e
    },
    async *values() {
      for (const e of entries.values()) yield e
    },
    async queryPermission() {
      return window.__perm
    },
    async requestPermission() {
      window.__perm = 'granted'
      return 'granted'
    }
  })
  const root = dirHandle('Arbeitsordner', new Map([
    ['frames.webm', fileHandle('frames.webm', frames)],
    ['elsewhere', dirHandle('elsewhere', new Map([['renamed-clip.webm', fileHandle('renamed-clip.webm', clip)]]))]
  ]))
  window.showDirectoryPicker = async () => root
}

const outcomes = []
let failedCount = 0
function check(name, ok, detail = '') {
  outcomes.push(ok)
  if (!ok) failedCount++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` (${detail})`}`)
}

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
await context.addInitScript(FOLDER_STUB, { frames: framesBytes, clip: clipBytes })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && pageErrors.push(m.text()))

// Reads the Pinia stores in the page. `fnSrc` is a function source taking (editor, media, arg).
const read = (fnSrc, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = pinia._s.get('editor')
      const me = pinia._s.get('media')
      return new Function(`return (${src})`)()(ed, me, a)
    },
    [fnSrc, arg]
  )

async function until(fnSrc, predicate, timeout = 8000) {
  const t0 = Date.now()
  let value
  while (Date.now() - t0 < timeout) {
    value = await read(fnSrc)
    if (predicate(value)) return value
    await page.waitForTimeout(100)
  }
  return value
}

const STATUSES = '(ed, me) => Object.fromEntries(ed.project.assets.map((a) => [a.name, me.statusOf(a.id)]))'
const REASONS = '(ed, me) => Object.fromEntries(ed.project.assets.map((a) => [a.name, me.relinkReasons[a.id] ?? null]))'
const RELPATHS = '(ed) => Object.fromEntries(ed.project.assets.map((a) => [a.name, a.relPath]))'
const SAVED = '(ed) => ed.saveStatus'

// Same frame-number technique as scripts/e2e-preview.mjs: the frame index is encoded in the picture.
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

async function settleFrame(expected, timeout = 6000) {
  const t0 = Date.now()
  let got = -1
  while (Date.now() - t0 < timeout) {
    got = await canvasBits()
    if (got === expected) return got
    await page.waitForTimeout(150)
  }
  return got
}

const dialog = () => page.getByRole('dialog', { name: /Missing files/ })
const dialogCount = () => page.locator('[role=dialog]').filter({ hasText: 'Missing files' }).count()
const banner = () => page.locator('[role=status]', { hasText: /files? (is|are) missing/ })

async function reloadApp() {
  await page.reload()
  await page.waitForSelector('header')
  await page.waitForTimeout(400)
}

// Setup: a fresh project with both fixtures on the timeline, frames first.
await page.goto(APP_URL)
await page.waitForSelector('header')
await page.waitForTimeout(800)
const modalCount = () => page.locator('.fixed.inset-0.z-50').count()
check('fresh start (demo project, nothing imported): no re-link dialog', (await dialogCount()) === 0)
check('fresh start: no banner and no modal blocks the page', (await banner().count()) === 0 && (await modalCount()) === 0)
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
await page.waitForTimeout(500)
check('New project: no re-link dialog, no banner, no modal', (await dialogCount()) === 0 && (await banner().count()) === 0 && (await modalCount()) === 0)
await page.locator('input[type=file]').first().setInputFiles([fixture('frames.webm'), fixture('clip-a.webm')])
await page.getByRole('button', { name: /frames\.webm/ }).first().waitFor()
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.getByRole('button', { name: /clip-a\.webm/ }).first().click()
await until(SAVED, (s) => s === 'saved', 6000)
await page.waitForTimeout(1500)
const setupAssets = await read('(ed) => ed.project.assets.map((a) => a.name)')
check('setup: both fixtures imported and placed on the timeline', setupAssets.length === 2 && (await read('(ed) => ed.project.clips.length')) === 2)

// Scenario 1: restore after reload. Banner and dialog open once; Escape closes; it does not reopen.
await reloadApp()
await dialog().waitFor({ timeout: 8000 })
check('after reload the dialog opens automatically', (await dialogCount()) === 1)
check('after reload the banner shows the missing count', (await banner().count()) === 1 && (await banner().first().innerText()).includes('2 files are missing'))
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
check('the dialog opens only once per opened project (stays closed after Escape)', (await dialogCount()) === 0)
check('a dismissed dialog leaves the calm banner in the library', (await banner().count()) === 1)
await page.screenshot({ path: join(SHOT_DIR, 'relink-banner-light.png') })
await page.emulateMedia({ colorScheme: 'dark' })
await page.screenshot({ path: join(SHOT_DIR, 'relink-banner-dark.png') })
await page.emulateMedia({ colorScheme: 'light' })

// Banner button: pick clip-a first, frames second (the project order is the other way round).
const [chooser1] = await Promise.all([
  page.waitForEvent('filechooser'),
  banner().getByRole('button', { name: /Select files/ }).click()
])
await chooser1.setFiles([fixture('clip-a.webm'), fixture('frames.webm')])
const s1 = await until(STATUSES, (s) => s['frames.webm'] === 'ready' && s['clip-a.webm'] === 'ready')
check('banner "Select files" re-links both files given in a different order', s1['frames.webm'] === 'ready' && s1['clip-a.webm'] === 'ready', JSON.stringify(s1))
const r1 = await read(REASONS)
check('matched by name and size', r1['frames.webm'] === 'name-size' && r1['clip-a.webm'] === 'name-size', JSON.stringify(r1))
await page.waitForTimeout(600)
const thumbs = await page.locator('button[aria-label*="frames.webm"] img, button[aria-label*="clip-a.webm"] img').count()
check('the library shows thumbnails again', thumbs === 2, String(thumbs))
await read('(ed, me) => ed.setPlayhead(Math.round(10 * 1000000 / 30))')
const frame10 = await settleFrame(10)
check('the preview shows frame 10 of frames.webm after re-linking', frame10 === 10, `got ${frame10}`)
check('nothing reopens the dialog when all media is linked', (await dialogCount()) === 0)

// Scenario 2: a renamed copy dropped on the dialog is matched by size and length.
await reloadApp()
await dialog().waitFor({ timeout: 8000 })
const renamedBase64 = readFileSync(renamedPath).toString('base64')
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'renamed.webm', { type: 'video/webm' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  document.querySelector('[role=dialog][aria-labelledby="relink-dialog-title"]').dispatchEvent(
    new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
  )
}, renamedBase64)
const s2 = await until(STATUSES, (s) => s['frames.webm'] === 'ready')
check('a dropped renamed copy is matched by size and length', s2['frames.webm'] === 'ready' && s2['clip-a.webm'] === 'missing', JSON.stringify(s2))
check('the renamed match is reported as found by size and length', (await read(REASONS))['frames.webm'] === 'size-duration')
check('the dialog stays open while a file is still missing', (await dialogCount()) === 1)
const notFoundRow = await page.locator('[data-relink-state=notFound]').count()
check('the dialog lists the still missing file as not found', notFoundRow === 1, String(notFoundRow))
await page.locator('[role=dialog]').getByRole('button', { name: /^Close$/ }).click()
await page.waitForTimeout(200)

// Scenario 3: two identical copies are ambiguous; the select resolves it. Mixed results: screenshots.
await reloadApp()
await dialog().waitFor({ timeout: 8000 })
const [chooser3] = await Promise.all([
  page.waitForEvent('filechooser'),
  dialog().getByRole('button', { name: /Select files/ }).click()
])
await chooser3.setFiles([copy1Path, copy2Path])
const ambiguousRow = await until(`(ed, me) => me.relinkPlan ? Object.keys(me.relinkPlan.ambiguous).length : 0`, (n) => n === 1)
check('two identical copies are reported as several candidates', ambiguousRow === 1)
const chooseState = await page.locator('[role=dialog] [data-relink-state=choose]').count()
check('the dialog shows the choice for the ambiguous file', chooseState === 1, String(chooseState))
await page.screenshot({ path: join(SHOT_DIR, 'relink-dialog-light.png') })
await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(300)
await page.screenshot({ path: join(SHOT_DIR, 'relink-dialog-dark.png') })
await page.emulateMedia({ colorScheme: 'light' })
const select = dialog().getByLabel('File for frames.webm')
const options = await select.locator('option').allInnerTexts()
check('the choice lists both files, numbered apart', options.length === 3 && options[1] !== options[2], JSON.stringify(options))
await select.selectOption({ index: 2 })
await dialog().getByRole('button', { name: /^Apply$/ }).click()
const s3 = await until(STATUSES, (s) => s['frames.webm'] === 'ready')
check('Apply links the chosen copy', s3['frames.webm'] === 'ready', JSON.stringify(s3))
check('the chosen copy is reported as chosen by the user', (await read(REASONS))['frames.webm'] === 'manual')
check('the dialog stays open while clip-a is still missing', (await dialogCount()) === 1)
await page.locator('[role=dialog]').getByRole('button', { name: /^Close$/ }).click()
await page.waitForTimeout(200)

// Scenario 4: a wrong file picked for one tile is refused with a friendly message.
await reloadApp()
await dialog().waitFor({ timeout: 8000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const [chooser4] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('button[title="Re-link clip-a.webm"]').click()
])
await chooser4.setFiles([fixture('music.webm')])
await dialog().waitFor({ timeout: 8000 })
const alertText = await page.locator('[role=dialog] [role=alert]').allInnerTexts()
check('a wrong file is refused with a friendly message', alertText.some((t) => t.includes('does not match')), JSON.stringify(alertText))
check('the wrong file does not link the asset', (await read(STATUSES))['clip-a.webm'] === 'missing')
// Same kind (video), but 1.4 s shorter than clip-a: only the length check can refuse it.
await page.locator('[role=dialog]').getByRole('button', { name: /^Close$/ }).click()
await page.waitForTimeout(200)
const [chooser4b] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('button[title="Re-link clip-a.webm"]').click()
])
await chooser4b.setFiles([fixture('talk.webm')])
await dialog().waitFor({ timeout: 8000 })
const lengthAlert = await page.locator('[role=dialog] [role=alert]').allInnerTexts()
check('a video of another length is refused too', lengthAlert.some((t) => t.includes('does not match')), JSON.stringify(lengthAlert))
check('the shorter video does not link the asset', (await read(STATUSES))['clip-a.webm'] === 'missing')
await page.locator('[role=dialog]').getByRole('button', { name: /^Close$/ }).click()
await page.waitForTimeout(200)

// Scenario 5: work folder. Stub picker: frames.webm sits at the folder root, the clip is renamed in a subfolder.
// The asset path of clip-a is hostile: it must never be looked up.
await reloadApp()
await dialog().waitFor({ timeout: 8000 })
await read(
  '(ed) => { const p = JSON.parse(JSON.stringify(ed.project)); for (const a of p.assets) if (a.name === "clip-a.webm") a.relPath = "../../etc/passwd"; ed.commitProject(p) }'
)
await dialog().getByRole('button', { name: /Choose folder/ }).click()
const s5 = await until(STATUSES, (s) => s['frames.webm'] === 'ready' && s['clip-a.webm'] === 'ready')
check('the work folder re-links both files', s5['frames.webm'] === 'ready' && s5['clip-a.webm'] === 'ready', JSON.stringify(s5))
const r5 = await read(REASONS)
check('the file at its stored path is found by path', r5['frames.webm'] === 'path', JSON.stringify(r5))
check('the file elsewhere in the folder is found by scanning (size and length)', r5['clip-a.webm'] === 'size-duration', JSON.stringify(r5))
const rp5 = await read(RELPATHS)
check('the scanned file path is stored on the asset', rp5['clip-a.webm'] === 'elsewhere/renamed-clip.webm', JSON.stringify(rp5))
const calls = await page.evaluate(() => window.__calls)
check('the folder was asked for the stored path of frames.webm', calls.some(([k, n]) => k === 'file' && n === 'frames.webm'), JSON.stringify(calls))
const traversal = calls.filter(([, n]) => n === '..' || n === 'etc' || n === 'passwd')
check('a path with ".." is never looked up in the folder', traversal.length === 0, JSON.stringify(traversal))
await page.locator('[role=dialog]').getByRole('button', { name: /^Close$/ }).click()
await page.waitForTimeout(200)

// Scenario 6: after a browser restart the permission is 'prompt': the menu offers to grant it again.
await page.evaluate(() => {
  window.__perm = 'prompt'
})
await page.locator('#project-menu-trigger').click()
const grant = page.getByRole('menuitem', { name: /Grant access again/ })
await grant.waitFor({ timeout: 4000 }).catch(() => undefined)
await page.screenshot({ path: join(SHOT_DIR, 'relink-menu-prompt-light.png') })
check('the work folder menu offers "Grant access again" when permission must be re-granted', (await grant.count()) === 1)
await grant.click()
await page.waitForTimeout(500)
await page.locator('#project-menu-trigger').click()
await page.waitForTimeout(300)
check('after granting again the menu no longer asks', (await page.getByRole('menuitem', { name: /Grant access again/ }).count()) === 0)
check('the folder is still shown by name', (await page.locator('#project-menu-panel').innerText()).includes('Arbeitsordner'))
await page.keyboard.press('Escape')

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '))

await page.screenshot({ path: join(SHOT_DIR, 'relink-final-light.png') })
await browser.close()
await server.close()

if (failedCount > 0) {
  console.log(`${failedCount} CHECK(S) FAILED of ${outcomes.length}`)
  process.exit(1)
}
console.log(`ALL ${outcomes.length} CHECKS PASSED`)
