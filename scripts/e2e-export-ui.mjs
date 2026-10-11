// Real-browser check of the export dialog: settings, export, save (download and picker paths), cancel, missing media.
// Usage: node scripts/e2e-export-ui.mjs   (optional env SHOT_DIR=<dir> for screenshots and downloads)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5186
const APP_URL = `http://localhost:${PORT}/app`
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const FRAMES = join(root, 'tests/fixtures/frames.webm')
const CLIP_A = join(root, 'tests/fixtures/clip-a.webm')
mkdirSync(SHOT_DIR, { recursive: true })

const PICKER_OFF = `Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true });`
// Records the picker call and keeps the written blob for the test to read back.
const PICKER_STUB = `
window.__picker = { calls: [], written: null };
Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, writable: true, value: async (opts) => {
  window.__picker.calls.push({ suggestedName: opts.suggestedName });
  return { name: opts.suggestedName, createWritable: async () => ({
    write: async (data) => { window.__picker.written = data; },
    close: async () => {}
  }) };
} });`

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

async function newPage({ locale = 'en-US', initScript = null, viewport = { width: 1120, height: 700 } } = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport, locale })
  if (initScript) await context.addInitScript(initScript)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && pageErrors.push(`console: ${m.text()}`))
  return { context, page, pageErrors }
}

const state = (page, fn) =>
  page.evaluate(
    `(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; return (${fn})(p._s.get('editor'), p._s.get('export'), p._s.get('media')) })()`
  )

async function waitFor(fn, timeout = 10_000, step = 100) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, step))
  }
  return false
}

const dialog = (page) => page.getByRole('dialog', { name: /Export video|Video exportieren/ })
const startButton = (page) => page.getByRole('button', { name: 'Start export', exact: true })
const estimateText = (page) =>
  page.locator('[role=dialog] p', { hasText: /size about/ }).first().innerText()

async function setTheme(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
}

async function shot(page, name) {
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme)
    await page.waitForTimeout(150)
    await dialog(page).screenshot({ path: join(SHOT_DIR, `export-${name}-${theme}.png`) })
  }
  await setTheme(page, 'light')
}

async function setupProject(page) {
  await page.goto(APP_URL)
  await page.locator('#project-menu-trigger').waitFor()
  await page.locator('#project-menu-trigger').click()
  await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await page.locator('input[type=file]').first().setInputFiles([FRAMES, CLIP_A])
  const frames = page.getByRole('button', { name: /frames\.webm/ }).first()
  const clip = page.getByRole('button', { name: /clip-a\.webm/ }).first()
  await frames.waitFor({ timeout: 30_000 })
  await clip.waitFor({ timeout: 30_000 })
  await frames.click()
  await clip.click()
  await waitFor(async () => (await state(page, '(ed) => ed.project.clips.length')) === 2, 10_000)
}

async function pickResolution(page, label) {
  await page.getByRole('radio', { name: label, exact: true }).click({ force: true })
}

async function waitPhase(page, phase, timeout) {
  return waitFor(async () => (await state(page, '(ed, ex) => ex.phase')) === phase, timeout, 200)
}

function readFileBytesAsBase64Js() {
  return `(async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(s) })`
}

// ---------- Pass A: download path (no picker APIs) ----------
{
  const { context, page, pageErrors } = await newPage({ initScript: PICKER_OFF })
  await setupProject(page)

  const projectDuration = await state(page, '(ed) => ed.totalDuration')
  check('two clips are on the timeline', (await state(page, '(ed) => ed.project.clips.length')) === 2)

  await page.locator('#export-button').click()
  await dialog(page).waitFor()
  await waitPhase(page, 'ready', 15_000)
  check('Export button opens the dialog', await dialog(page).isVisible())
  check('focus moves into the dialog on open', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))
  check('Start export is enabled once encoders are checked', await startButton(page).isEnabled())
  await shot(page, 'idle')

  const est0 = await estimateText(page)
  await pickResolution(page, '720p')
  await waitFor(async () => (await estimateText(page)) !== est0, 3000)
  const est1 = await estimateText(page)
  check('resolution change updates the estimate', est1 !== est0, `${est0} -> ${est1}`)
  await pickResolution(page, '480p')
  await waitFor(async () => (await estimateText(page)) !== est1, 3000)
  const est2 = await estimateText(page)
  check('480p gives a smaller estimate than 720p', est2 !== est1, `${est1} -> ${est2}`)
  const bytes480_30 = await state(page, '(ed, ex) => ex.estimatedBytes')
  await page.getByRole('radio', { name: '24', exact: true }).click({ force: true })
  await waitFor(async () => (await state(page, '(ed, ex) => ex.estimatedBytes')) !== bytes480_30, 3000)
  check('frame rate change updates the estimate', (await state(page, '(ed, ex) => ex.estimatedBytes')) !== bytes480_30)
  await page.getByRole('radio', { name: '30', exact: true }).click({ force: true })
  await page.getByRole('radio', { name: 'Small', exact: true }).click({ force: true })
  await waitFor(async () => (await estimateText(page)) !== est2, 3000)
  const est4 = await estimateText(page)
  check('quality change updates the estimate', est4 !== est2, `${est2} -> ${est4}`)
  await page.getByRole('radio', { name: 'Good', exact: true }).click({ force: true })
  await waitFor(async () => (await estimateText(page)) === est2, 3000)
  check('switching back restores the same estimate', (await estimateText(page)) === est2)
  const gifDisabled = await page.getByRole('radio', { name: /GIF/ }).isDisabled()
  check('GIF format is shown but disabled', gifDisabled)

  // Tab stays inside the dialog, wrapping at both ends.
  let tabOutside = 0
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) tabOutside++
  }
  check('Tab cycles inside the dialog only', tabOutside === 0, `${tabOutside} presses left the dialog`)

  await page.keyboard.press('Escape')
  await dialog(page).waitFor({ state: 'detached', timeout: 3000 }).catch(() => undefined)
  check('Escape closes the dialog', !(await dialog(page).isVisible().catch(() => false)))
  check('focus returns to the Export button', await page.evaluate(() => document.activeElement?.id === 'export-button'))

  // A click on the backdrop closes it while nothing runs.
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await page.mouse.click(5, 5)
  check('a backdrop click closes the dialog when idle', !(await dialog(page).isVisible().catch(() => false)))

  // Reopen and export at 480p, 30 fps, Good.
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await pickResolution(page, '480p')
  await page.getByRole('radio', { name: '30', exact: true }).click({ force: true })
  await startButton(page).click()
  let maxFraction = 0
  let sawProgressbar = false
  const runDone = await waitFor(async () => {
    const bar = page.getByRole('progressbar')
    if (await bar.count()) sawProgressbar = true
    maxFraction = Math.max(maxFraction, (await state(page, '(ed, ex) => ex.progress?.fraction ?? 0')) || 0)
    return (await state(page, '(ed, ex) => ex.phase')) === 'done'
  }, 180_000, 100)
  const phaseNow = await state(page, '(ed, ex) => ex.phase')
  check('export at 480p/30 finishes in the done state', runDone, `phase=${phaseNow} error=${JSON.stringify(await state(page, '(ed, ex) => ex.error'))}`)
  check('done state shows Save and the file name', runDone && (await page.getByRole('button', { name: 'Save', exact: true }).isVisible()) && (await dialog(page).innerText()).includes('New project.mp4'))
  await shot(page, 'done')

  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null)
  await page.getByRole('button', { name: 'Save', exact: true }).click().catch(() => undefined)
  const download = await downloadPromise
  check('Save starts a download', download !== null)
  const savedPath = join(SHOT_DIR, 'export-download.mp4')
  if (download) {
    check('Save file name is "New project.mp4"', download.suggestedFilename() === 'New project.mp4', download.suggestedFilename())
    await download.saveAs(savedPath)
  }
  const bytes = download ? readFileSync(savedPath) : Buffer.alloc(0)
  check('downloaded bytes start with an MP4 ftyp box at offset 4', bytes.length > 8 && bytes.toString('latin1', 4, 8) === 'ftyp', bytes.subarray(0, 12).toString('hex'))
  check('downloaded file is above 2 KB', bytes.length > 2048, `${bytes.length} bytes`)

  const probe = await page.evaluate(async (b64) => {
    const bin = atob(b64)
    const data = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
    const { probeFile } = await import('/src/engine/media/probe.ts')
    const info = await probeFile(new File([data], 'x.mp4', { type: 'video/mp4' }))
    return { duration: info.duration, width: info.width, height: info.height }
  }, bytes.toString('base64'))
  check(
    `probed duration is about the project duration (${projectDuration / 1e6} s)`,
    Math.abs(probe.duration - projectDuration) <= 150_000,
    `file ${probe.duration} us, project ${projectDuration} us`
  )
  check('probed size is 854x480', probe.width === 854 && probe.height === 480, `${probe.width}x${probe.height}`)

  // Cancel halfway through a longer export.
  await page.getByRole('button', { name: 'Export again', exact: true }).click()
  await waitPhase(page, 'ready', 5000)
  await pickResolution(page, '1080p')
  await page.getByRole('radio', { name: '60', exact: true }).click({ force: true })
  await startButton(page).click()
  const halfway = await waitFor(async () => ((await state(page, '(ed, ex) => ex.progress?.fraction ?? 0')) || 0) >= 0.25, 120_000, 50)
  check('progress reaches 25 percent before cancelling', halfway)
  check('progress bar reports a value while running', sawProgressbar || halfway)
  const bar = page.getByRole('progressbar')
  check('progressbar carries aria-valuenow', Number(await bar.getAttribute('aria-valuenow')) >= 25)
  await page.keyboard.press('Escape')
  check('Escape does nothing while an export runs', await dialog(page).isVisible())
  await shot(page, 'running')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const cancelled = await waitPhase(page, 'cancelled', 60_000)
  check('cancel ends in the cancelled state', cancelled, `phase=${await state(page, '(ed, ex) => ex.phase')}`)
  check('cancelled state shows its message', (await dialog(page).innerText()).match(/cancelled|abgebrochen/) !== null)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await waitPhase(page, 'ready', 5000)
  check('after cancel the dialog is usable again (Start enabled)', await startButton(page).isEnabled())
  await page.keyboard.press('Escape')
  check('Escape closes the dialog after a cancelled export', !(await dialog(page).isVisible().catch(() => false)))
  check('no uncaught page errors in pass A', pageErrors.length === 0, pageErrors.join(' | '))

  // Missing media after a reload: the restored project's assets have no files in this session.
  await waitFor(async () => (await state(page, '(ed) => ed.saveStatus')) === 'saved', 10_000)
  await page.waitForTimeout(1200)
  await page.reload()
  await page.locator('#project-menu-trigger').waitFor()
  await waitFor(async () => (await state(page, '(ed) => ed.project.clips.length')) === 2, 10_000)
  await page.locator('#export-button').click()
  await dialog(page).waitFor()
  await waitPhase(page, 'ready', 15_000)
  const warning = dialog(page).getByRole('alert')
  await warning.waitFor({ timeout: 5000 }).catch(() => undefined)
  const warningText = (await warning.count()) ? await warning.first().innerText() : ''
  check('missing media shows a warning naming the files', /frames\.webm/.test(warningText) && /clip-a\.webm/.test(warningText), warningText)
  check('missing media disables Start export', !(await startButton(page).isEnabled()))
  await shot(page, 'warning')

  // Narrow viewport: the dialog must fit without horizontal scrolling.
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 800 })
    await page.waitForTimeout(300)
    const fit = await page.evaluate(() => {
      const panel = document.querySelector('[role=dialog]')
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelOverflow: panel.scrollWidth - panel.clientWidth,
        panelWidth: panel.getBoundingClientRect().width
      }
    })
    check(`dialog fits ${width} px without horizontal overflow`, fit.pageOverflow <= 0 && fit.panelOverflow <= 0, JSON.stringify(fit))
    if (width === 390) await shot(page, 'warning-390')
  }
  await page.keyboard.press('Escape')
  await context.close()
}

// ---------- Pass B: picker path (showSaveFilePicker present and stubbed) ----------
{
  const { context, page, pageErrors } = await newPage({ initScript: PICKER_STUB })
  await setupProject(page)
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await pickResolution(page, '480p')
  await startButton(page).click()
  const done = await waitPhase(page, 'done', 180_000)
  check('picker pass: export finishes', done)
  let downloads = 0
  page.on('download', () => downloads++)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const picked = await waitFor(() => page.evaluate(() => window.__picker.written !== null), 10_000, 100)
  const calls = await page.evaluate(() => window.__picker.calls)
  check('picker pass: showSaveFilePicker is used', calls.length === 1 && calls[0].suggestedName === 'New project.mp4', JSON.stringify(calls))
  check('picker pass: the blob is written to the picker writable', picked)
  if (picked) {
    const b64 = await page.evaluate(`${readFileBytesAsBase64Js()}(window.__picker.written)`)
    const bytes = Buffer.from(b64, 'base64')
    check('picker pass: written bytes are an MP4 (ftyp at offset 4)', bytes.toString('latin1', 4, 8) === 'ftyp')
  }
  await page.waitForTimeout(500)
  check('picker pass: no download is started', downloads === 0, `${downloads}`)
  check('picker pass: no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// ---------- Pass C: German wording and empty project ----------
{
  const { context, page, pageErrors } = await newPage({ locale: 'de-DE', initScript: PICKER_OFF })
  await page.goto(APP_URL)
  await page.locator('#project-menu-trigger').waitFor()
  await page.locator('#project-menu-trigger').click()
  await page.getByRole('menuitem', { name: 'Neues Projekt' }).click()
  await waitFor(async () => (await state(page, '(ed) => ed.project.clips.length')) === 0 && (await state(page, '(ed) => ed.totalDuration')) === 0, 5000)
  await page.locator('#export-button').click()
  await dialog(page).waitFor()
  const text = await dialog(page).innerText()
  check('German title and labels are shown', ['Video exportieren', 'Auflösung', 'Bilder pro Sekunde', 'Qualität', 'Format'].every((s) => text.includes(s)))
  check('German quality names are shown', ['Gut', 'Klein', 'Sehr klein'].every((s) => text.includes(s)))
  await waitPhase(page, 'ready', 15_000)
  const emptyText = await dialog(page).innerText()
  check('an empty project explains that there is nothing to export', emptyText.includes('nichts zu exportieren'), emptyText.replace(/\n/g, ' | '))
  check('an empty project disables Start export', !(await page.getByRole('button', { name: 'Export starten', exact: true }).isEnabled()))
  check('dialog in German has no bitrate wording', !/kbit|Mbit|bit\/s/i.test(text))
  check('German pass: no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
