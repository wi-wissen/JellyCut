// Real-browser check of removing media from the library: unused removal (immediate, undoable), used
// removal (asks first, Cancel and Escape keep everything, one undo restores clips and asset), the
// "Remove unused media" action, and removal of missing files from a tile and from the re-link dialog.
// Usage: node scripts/e2e-media-remove.mjs
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5183
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const fixture = (name) => join(root, 'tests/fixtures', name)

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
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
// New project asks to discard unsaved changes; accept it.
page.on('dialog', (d) => d.accept())
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && pageErrors.push(m.text()))

// Reads the Pinia stores in the page. `fnSrc` is a function source taking (editor, media, arg).
const read = (fnSrc, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      return new Function(`return (${src})`)()(pinia._s.get('editor'), pinia._s.get('media'), a)
    },
    [fnSrc, arg]
  )

const ASSETS = '(ed) => Object.fromEntries(ed.project.assets.map((a) => [a.name, a.id]))'
const COUNTS = '(ed) => ({ assets: ed.project.assets.length, clips: ed.project.clips.length, canUndo: ed.canUndo })'
const alertDialog = () => page.getByRole('alertdialog')
const note = () => page.locator('[role=status]', { hasText: /Removed|entfernt/ })
const removeTile = (name) => page.getByRole('button', { name: `Remove ${name} from the library` })

async function waitUntil(fnSrc, predicate, timeout = 6000) {
  const t0 = Date.now()
  let value
  while (Date.now() - t0 < timeout) {
    value = await read(fnSrc)
    if (predicate(value)) return value
    await page.waitForTimeout(100)
  }
  return value
}

// Setup: new project, frames.webm used on the timeline, clip-a.webm imported but unused.
await page.goto(APP_URL)
await page.waitForSelector('header')
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project/ }).click()
await page.locator('input[type=file]').first().setInputFiles([fixture('frames.webm'), fixture('clip-a.webm')])
await page.getByRole('button', { name: /frames\.webm/ }).first().waitFor()
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.waitForTimeout(300)
const ids = await read(ASSETS)
check('setup: frames.webm is on the timeline and clip-a.webm is unused', (await read(COUNTS)).clips === 1 && (await read(COUNTS)).assets === 2)
await page.screenshot({ path: join(SHOT_DIR, 'media-remove-tiles-light.png') })
check('setup: thumbnails exist before removal', !!(await read('(ed, me) => me.thumbnails', null))[ids['frames.webm']])

// A: an unused asset is removed at once, from the keyboard, and Undo brings it back.
await removeTile('clip-a.webm').focus()
await page.keyboard.press('Enter')
const a1 = await waitUntil(COUNTS, (c) => c.assets === 1)
check('unused asset: removed at once without asking', a1.assets === 1 && (await alertDialog().count()) === 0, JSON.stringify(a1))
check('unused asset: the file and its status and thumbnail are freed', await read(`(ed, me) => me.status['${ids['clip-a.webm']}'] === undefined && me.thumbnails['${ids['clip-a.webm']}'] === undefined`))
check('unused asset: a note offers Undo', (await note().count()) === 1 && (await note().getByRole('button', { name: 'Undo' }).count()) === 1)
await note().getByRole('button', { name: 'Undo' }).click()
const a2 = await waitUntil(COUNTS, (c) => c.assets === 2)
check('unused asset: Undo restores the asset entry', a2.assets === 2, JSON.stringify(a2))
check('unused asset: the note is gone after Undo', (await note().count()) === 0)

// B: a used asset asks first; Cancel keeps everything.
await removeTile('frames.webm').click()
await alertDialog().waitFor({ timeout: 3000 })
const askText = await alertDialog().innerText()
check('used asset: asks first and says how many clips go', askText.includes('used in 1 clip') && askText.includes('also removes that clip'), askText)
check('used asset: the confirmation takes focus on Cancel', await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Cancel'))
await alertDialog().getByRole('button', { name: 'Cancel' }).click()
await page.waitForTimeout(200)
const b1 = await read(COUNTS)
check('cancel keeps the asset and the clip', (await alertDialog().count()) === 0 && b1.assets === 2 && b1.clips === 1, JSON.stringify(b1))
check('cancel keeps the file ready', (await read(`(ed, me) => me.statusOf('${ids['frames.webm']}') === 'ready'`)) === true)
await removeTile('frames.webm').click()
await alertDialog().waitFor({ timeout: 3000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('Escape cancels the confirmation too', (await alertDialog().count()) === 0 && (await read(COUNTS)).clips === 1)

// C: confirm removes the asset and its clip in one step; one Undo restores both.
await removeTile('frames.webm').click()
await alertDialog().waitFor({ timeout: 3000 })
await alertDialog().getByRole('button', { name: 'Remove', exact: true }).focus()
await page.keyboard.press('Enter')
const c1 = await waitUntil(COUNTS, (c) => c.assets === 1 && c.clips === 0)
check('confirm: removes the asset and its clip together', c1.assets === 1 && c1.clips === 0, JSON.stringify(c1))
check('confirm: the removed file has no status, thumbnail or dialog entry', await read(`(ed, me) => me.status['${ids['frames.webm']}'] === undefined && me.thumbnails['${ids['frames.webm']}'] === undefined`))
await note().getByRole('button', { name: 'Undo' }).click()
const c2 = await waitUntil(COUNTS, (c) => c.assets === 2 && c.clips === 1)
check('one Undo restores the clip and the asset', c2.assets === 2 && c2.clips === 1, JSON.stringify(c2))

// E: "Remove unused media" removes every unused file at once; Undo restores them.
await page.getByRole('button', { name: 'Remove unused media' }).click()
const e1 = await waitUntil(COUNTS, (c) => c.assets === 1)
check('remove unused media: unused files go at once, used ones stay', e1.assets === 1 && e1.clips === 1, JSON.stringify(e1))
check('remove unused media: the button disappears when nothing is unused', (await page.getByRole('button', { name: 'Remove unused media' }).count()) === 0)
await note().getByRole('button', { name: 'Undo' }).click()
await waitUntil(COUNTS, (c) => c.assets === 2)

// D: missing files. Reload: both are missing and the dialog opens once.
await page.waitForTimeout(1500)
await page.reload()
await page.waitForSelector('header')
const dialog = page.getByRole('dialog', { name: /Missing files/ })
await dialog.waitFor({ timeout: 8000 })
await page.screenshot({ path: join(SHOT_DIR, 'media-remove-dialog-light.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('after reload: the banner is still there after the dialog is dismissed', (await page.locator('[role=status]', { hasText: /files? (is|are) missing/ }).count()) === 1)
await removeTile('clip-a.webm').click()
const d1 = await waitUntil(COUNTS, (c) => c.assets === 1)
check('missing unused file: removed from its tile without a question', d1.assets === 1 && (await alertDialog().count()) === 0, JSON.stringify(d1))
await removeTile('frames.webm').click()
await alertDialog().waitFor({ timeout: 3000 })
await alertDialog().getByRole('button', { name: 'Remove', exact: true }).click()
await page.waitForTimeout(400)
const d2 = await read(COUNTS)
check('missing used file: removal asks, then removes it with its clip', d2.assets === 0 && d2.clips === 0, JSON.stringify(d2))
check('removing the last missing file closes the banner and the dialog', (await page.locator('[role=status]', { hasText: /files? (is|are) missing/ }).count()) === 0 && (await dialog.count()) === 0)

// Dialog path: reload with a fresh missing used file, remove it from the dialog row.
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project/ }).click()
await page.locator('input[type=file]').first().setInputFiles(fixture('frames.webm'))
await page.getByRole('button', { name: /frames\.webm/ }).first().waitFor()
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.waitForTimeout(1500)
await page.reload()
await page.waitForSelector('header')
await dialog.waitFor({ timeout: 8000 })
const rowRemove = dialog.getByRole('button', { name: 'Remove frames.webm from the library' })
await rowRemove.click()
await alertDialog().waitFor({ timeout: 3000 })
await alertDialog().getByRole('button', { name: 'Remove', exact: true }).click()
await page.waitForTimeout(400)
check('dialog row: removing the last missing file closes the dialog', (await dialog.count()) === 0)
check('dialog row: the project has no assets left', (await read(COUNTS)).assets === 0)

// F: a used file removed and undone comes back as ready and plays; redo removes it again; New project clears the kept files.
const CACHED = '(ed, me) => me.removedMediaIds()'
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project/ }).click()
await page.locator('input[type=file]').first().setInputFiles(fixture('frames.webm'))
await page.getByRole('button', { name: /frames\.webm/ }).first().waitFor()
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.waitForTimeout(300)
const fId = (await read(ASSETS))['frames.webm']
await removeTile('frames.webm').click()
await alertDialog().waitFor({ timeout: 3000 })
await alertDialog().getByRole('button', { name: 'Remove', exact: true }).click()
await waitUntil(COUNTS, (c) => c.assets === 0 && c.clips === 0)
check('F: the removed file is kept for undo', (await read(CACHED)).includes(fId))
await note().getByRole('button', { name: 'Undo' }).click()
const f1 = await waitUntil(COUNTS, (c) => c.assets === 1 && c.clips === 1)
check('F: undo brings the asset and its clip back', f1.assets === 1 && f1.clips === 1, JSON.stringify(f1))
check('F: after undo the asset is ready again with its thumbnail', await read(`(ed, me) => me.statusOf('${fId}') === 'ready' && !!me.thumbnails['${fId}']`))
check('F: a restored file is no longer kept twice', !(await read(CACHED)).includes(fId))

// The restored clip shows its picture in the fine cut view.
await read(`(ed) => { ed.setPlayhead(ed.project.clips[0].start + 200000); return true }`)
await page.locator('#fine-cut-button').click()
await page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'visible', timeout: 5000 })
await page.waitForTimeout(800)
const framesDrawn = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="fine-frame"]')].map((c) => {
    if (!c.width) return false
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const seen = new Set()
    for (let i = 0; i < d.length && seen.size < 3; i += 4 * 97) seen.add(d[i] + ':' + d[i + 1] + ':' + d[i + 2] + ':' + d[i + 3])
    return seen.size >= 2
  })
)
check('F: the restored clip shows its frames in the fine cut view', framesDrawn.length === 2 && framesDrawn.every(Boolean), JSON.stringify(framesDrawn))
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// The restored clip plays: the playhead moves on from the clip start.
const start = (await read(`(ed) => ed.project.clips[0].start`))
await read(`(ed) => { ed.setPlayhead(${start}); return true }`)
await page.getByRole('button', { name: 'Play', exact: true }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: 'Pause', exact: true }).click()
const moved = await read(`(ed) => ed.playheadMicros`)
check('F: the restored clip plays (the playhead moves on from its start)', moved - start > 300000, `${start} -> ${moved}`)

// Redo removes the file again, with its clip; the kept copy is there for another undo.
await page.getByRole('button', { name: 'Redo' }).click()
const f2 = await waitUntil(COUNTS, (c) => c.assets === 0 && c.clips === 0)
check('F: redo removes the asset and its clip again', f2.assets === 0 && f2.clips === 0, JSON.stringify(f2))
check('F: the file is kept again after redo', (await read(CACHED)).includes(fId))

// New project: the document is replaced, so nothing removed from the old one is kept.
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project/ }).click()
await page.waitForTimeout(300)
check('F: New project clears the kept files', (await read(CACHED)).length === 0, JSON.stringify(await read(CACHED)))

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
await page.screenshot({ path: join(SHOT_DIR, 'media-remove-final.png') })
await browser.close()
await server.close()

if (failedCount > 0) {
  console.log(`${failedCount} CHECK(S) FAILED of ${outcomes.length}`)
  process.exit(1)
}
console.log(`ALL ${outcomes.length} CHECKS PASSED`)
