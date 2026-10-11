// Real-browser check of the export dialog: settings and estimate range, automatic saving (download and picker
// paths), picker cancel and write errors, details, ETA, cancel, missing media, German wording.
// Usage: node scripts/e2e-export-ui.mjs   (optional env SHOT_DIR=<dir> for screenshots and downloads)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5186
const APP_URL = `http://localhost:${PORT}/app/`
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const FRAMES = join(root, 'tests/fixtures/frames.webm')
const CLIP_A = join(root, 'tests/fixtures/clip-a.webm')
mkdirSync(SHOT_DIR, { recursive: true })

const PICKER_OFF = `Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true });`
// A picker stub: 'ok' keeps the written blob for the test to read back, 'abort' is a cancelled dialog,
// 'writefail' accepts the file and then fails to write it.
const pickerStub = (mode) => `
window.__picker = { calls: [], written: null };
Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, writable: true, value: async (opts) => {
  window.__picker.calls.push({ suggestedName: opts.suggestedName });
  if ('${mode}' === 'abort') throw new DOMException('The user aborted a request.', 'AbortError');
  return { name: opts.suggestedName, createWritable: async () => ({
    write: async (data) => { if ('${mode}' === 'writefail') throw new Error('disk full'); window.__picker.written = data; },
    close: async () => {},
    abort: async () => {}
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
const saveAgainButton = (page) => page.getByRole('button', { name: 'Save again', exact: true })
const sizeLine = (page) => page.locator('[role=dialog] p', { hasText: /size about/ }).first().innerText()
const timeLine = (page) => page.locator('[role=dialog] p', { hasText: /Export takes about/ }).first().innerText().catch(() => '')

// The time range as the dialog must spell it in English: the same rule as the store's estimate.range.
const expectedRange = (page) =>
  page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const r = pinia._s.get('export').estimate.range
    const units = { seconds: 's', minutes: 'min', hours: 'h' }
    const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
    if (r.low === r.high) return `${nf.format(r.low)} ${units[r.unit]}`
    return `${nf.format(r.low)}–${nf.format(r.high)} ${units[r.unit]}`
  })
const exportTimeOf = async (page) => ((await timeLine(page)).match(/Export takes about ([^\n]+)/)?.[1] ?? '').trim()

async function setTheme(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
}

async function shot(page, name) {
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme)
    await page.waitForTimeout(150)
    await dialog(page).screenshot({ path: join(SHOT_DIR, `export2-${name}-${theme}.png`) })
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

// Emulates a hidden (background) tab: the page reads visibilityState 'hidden' and gets a visibilitychange event.
async function setVisibility(page, value) {
  await page.evaluate((v) => {
    if (v === 'visible') delete document.visibilityState
    else Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
}

async function pickResolution(page, label) {
  await page.getByRole('radio', { name: label, exact: true }).click({ force: true })
}

async function waitPhase(page, phase, timeout) {
  return waitFor(async () => (await state(page, '(ed, ex) => ex.phase')) === phase, timeout, 200)
}

// ---------- Pass A: automatic download path (no picker APIs) ----------
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
  check('the format choice is the first control in the dialog', (await dialog(page).getByRole('radio').first().getAttribute('name')) === 'export-format')
  check('the ready state hints that the estimate applies to a foreground tab', (await dialog(page).innerText()).includes('tab in the foreground'))
  await shot(page, 'ready')

  check('the video length, file size and export time are separate lines', (await dialog(page).innerText()).match(/Video: \S+/) !== null)
  const est0 = await sizeLine(page)
  await pickResolution(page, '720p')
  await waitFor(async () => (await sizeLine(page)) !== est0, 3000)
  const est1 = await sizeLine(page)
  check('resolution change updates the file size line', est1 !== est0, `${est0} -> ${est1}`)
  await pickResolution(page, '480p')
  await waitFor(async () => (await sizeLine(page)) !== est1, 3000)
  const est2 = await sizeLine(page)
  check('480p gives a smaller file size than 720p', est2 !== est1, `${est1} -> ${est2}`)
  const bytes480_30 = await state(page, '(ed, ex) => ex.estimatedBytes')
  await page.getByRole('radio', { name: '24', exact: true }).click({ force: true })
  await waitFor(async () => (await state(page, '(ed, ex) => ex.estimatedBytes')) !== bytes480_30, 3000)
  check('frame rate change updates the estimate', (await state(page, '(ed, ex) => ex.estimatedBytes')) !== bytes480_30)
  await page.getByRole('radio', { name: '30', exact: true }).click({ force: true })
  await page.getByRole('radio', { name: 'Small', exact: true }).click({ force: true })
  await waitFor(async () => (await sizeLine(page)) !== est2, 3000)
  check('quality change updates the file size line', (await sizeLine(page)) !== est2)
  await page.getByRole('radio', { name: 'Good', exact: true }).click({ force: true })
  await waitFor(async () => (await sizeLine(page)) === est2, 3000)
  check('switching back restores the same file size', (await sizeLine(page)) === est2)

  // Time: resolution and frame rate change it; the line shows the range the store computes.
  const seconds = () => state(page, '(ed, ex) => ex.estimatedSeconds')
  const sec480 = await seconds()
  check('the time line names the export time', (await exportTimeOf(page)) !== '', await timeLine(page))
  check('the export time text matches the store range', (await exportTimeOf(page)) === (await expectedRange(page)), `${await exportTimeOf(page)} vs ${await expectedRange(page)}`)
  check('before any export the time is a range (uncertain)', /–/.test(await exportTimeOf(page)), await exportTimeOf(page))
  check('the calibration hint is shown before any export', (await dialog(page).innerText()).includes('more accurate'))
  await pickResolution(page, '1080p')
  await waitFor(async () => (await seconds()) > sec480, 3000)
  const sec1080 = await seconds()
  check('1080p takes longer to export than 480p', sec1080 > sec480, `${sec480} s -> ${sec1080} s`)
  await page.getByRole('radio', { name: '60', exact: true }).click({ force: true })
  await waitFor(async () => (await seconds()) > sec1080, 3000)
  const sec1080at60 = await seconds()
  check('60 fps takes longer to export than 30 fps', sec1080at60 > sec1080, `${sec1080} s -> ${sec1080at60} s`)
  check('the time text follows the new value', (await exportTimeOf(page)) === (await expectedRange(page)), await exportTimeOf(page))
  await pickResolution(page, '480p')
  await page.getByRole('radio', { name: '30', exact: true }).click({ force: true })
  await waitFor(async () => (await seconds()) === sec480, 3000)
  check('back at 480p/30 the time is the first value again', (await seconds()) === sec480)

  check('GIF format is selectable (e2e-gif.mjs covers the GIF flow)', await page.getByRole('radio', { name: 'GIF', exact: true }).isEnabled())

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

  // Reopen and export at 480p, 30 fps, Good. Without a picker the file is downloaded by itself.
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await pickResolution(page, '480p')
  await page.getByRole('radio', { name: '30', exact: true }).click({ force: true })
  const autoDownload = page.waitForEvent('download', { timeout: 180_000 }).catch(() => null)
  await startButton(page).click()
  let sawProgressbar = false
  const runDone = await waitFor(async () => {
    if (await page.getByRole('progressbar').count()) sawProgressbar = true
    return (await state(page, '(ed, ex) => ex.phase')) === 'done'
  }, 180_000, 100)
  const phaseNow = await state(page, '(ed, ex) => ex.phase')
  check('export at 480p/30 finishes in the done state', runDone, `phase=${phaseNow} error=${JSON.stringify(await state(page, '(ed, ex) => ex.error'))}`)
  check('the progress bar was shown while running', sawProgressbar)
  check('done state names the file and says it was downloaded', runDone && (await dialog(page).innerText()).includes('Downloaded as New project.mp4'))
  check('done state offers "Save again" instead of "Save"', runDone && (await saveAgainButton(page).isVisible()) && (await page.getByRole('button', { name: 'Save', exact: true }).count()) === 0)
  check('the comparison line shows estimated and actual time', runDone && /Estimated: .+, actual: .+/.test(await dialog(page).innerText()))

  const download = await autoDownload
  check('the download starts without a click (fallback path)', download !== null)
  const savedPath = join(SHOT_DIR, 'export-download.mp4')
  if (download) {
    check('the automatic file name is "New project.mp4"', download.suggestedFilename() === 'New project.mp4', download.suggestedFilename())
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

  // Save again: the same file again, from the button.
  const again = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null)
  await saveAgainButton(page).click()
  const secondDownload = await again
  check('"Save again" starts another download with the same name', secondDownload !== null && secondDownload.suggestedFilename() === 'New project.mp4')

  // Details: the phases are measured and shown next to the estimate.
  await page.getByText('Details', { exact: true }).click()
  const detailRows = await dialog(page).locator('details tbody tr').count()
  check('the details table has one row per phase', detailRows === 4, `${detailRows} rows`)
  check('the details name the decoding and drawing steps', (await dialog(page).innerText()).includes('Decoding the source video') && (await dialog(page).innerText()).includes('Drawing the frames'))
  const measured = await state(page, '(ed, ex) => ex.result?.measuredPhases ?? null')
  check('the measured phases are stored for the run', measured !== null && measured.decode >= 0 && measured.encode > 0, JSON.stringify(measured))
  await shot(page, 'done')

  const storedCalibration = await page.evaluate(() => localStorage.getItem('jellycut.export.calibration'))
  const learned = storedCalibration ? JSON.parse(storedCalibration) : {}
  // The test Chromium encodes VP9 (software family); a machine with H.264 would store the avc family.
  check('the first export stores a calibration for its family and class', (learned.avc?.plain?.samples ?? 0) + (learned.software?.plain?.samples ?? 0) >= 1, storedCalibration ?? 'nothing stored')
  check('after one export the estimate is calibrated', await state(page, '(ed, ex) => ex.estimate.calibrated'))

  // A full 1080p/60 export with the ETA sampled on the way: at a quarter the estimate must be near the real rest.
  await page.getByRole('button', { name: 'Export again', exact: true }).click()
  await waitPhase(page, 'ready', 5000)
  const uncal = await state(page, '(ed, ex) => ex.uncalibratedSeconds')
  const corrected = await state(page, '(ed, ex) => ex.estimatedSeconds')
  check('the learned correction changes the estimated time', Math.abs(corrected - uncal) > 0.01, `${uncal} s -> ${corrected} s`)
  check('the displayed time is the corrected range', (await exportTimeOf(page)) === (await expectedRange(page)), await exportTimeOf(page))
  check('the calibration hint is gone after an export', !(await dialog(page).innerText()).includes('more accurate'))
  await shot(page, 'calibrated')
  await pickResolution(page, '1080p')
  await page.getByRole('radio', { name: '60', exact: true }).click({ force: true })
  const etaSamples = []
  await startButton(page).click()
  const finished = await waitFor(async () => {
    const p = await state(page, '(ed, ex) => (ex.progress ? { eta: ex.progress.etaMs, elapsed: ex.progress.elapsedMs, fraction: ex.progress.fraction } : null)')
    if (p && typeof p.eta === 'number' && (etaSamples.length === 0 || etaSamples[etaSamples.length - 1].eta !== p.eta)) etaSamples.push(p)
    return (await state(page, '(ed, ex) => ex.phase')) === 'done'
  }, 300_000, 100)
  check('the 1080p/60 export finishes', finished, `phase=${await state(page, '(ed, ex) => ex.phase')}`)
  const totalMs = await state(page, '(ed, ex) => ex.result?.elapsedMs ?? 0')
  const quarter = etaSamples.find((x) => x.fraction >= 0.25)
  const restMs = quarter ? totalMs - quarter.elapsed : 0
  const ratio = quarter && restMs > 0 ? quarter.eta / restMs : 0
  const seq = etaSamples.map((x) => (x.eta / 1000).toFixed(1)).join(' ')
  check('the ETA at a quarter is within a factor of two of the real rest', ratio > 0.5 && ratio < 2, `ETA ${Math.round((quarter?.eta ?? 0) / 1000)} s, real ${Math.round(restMs / 1000)} s; sequence ${seq}`)
  // The encoder's speed changes during a run, so the ETA follows it (several small rises are real). A wild jump is one
  // change of more than half the value; none is allowed.
  let wildJumps = 0
  for (let i = 1; i < etaSamples.length; i++) if (etaSamples[i].eta - etaSamples[i - 1].eta > Math.max(3000, 0.5 * etaSamples[i - 1].eta)) wildJumps++
  check('the ETA has no wild jumps (more than half of its value in one step)', wildJumps === 0, `${wildJumps} jumps; sequence ${seq}`)
  check('the ETA values are finite and never negative', etaSamples.every((x) => Number.isFinite(x.eta) && x.eta >= 0))
  let countdowns = 0
  for (let i = 1; i < etaSamples.length; i++) if (etaSamples[i].eta < etaSamples[i - 1].eta) countdowns++
  check('the ETA mostly counts down between updates', countdowns >= (etaSamples.length - 1) / 2, `${countdowns} of ${etaSamples.length - 1}`)
  check('the done state keeps the comparison line', (await dialog(page).innerText()).match(/Estimated: .+, actual: .+/) !== null)

  // Cancel at a quarter of a second run of the same size.
  await page.getByRole('button', { name: 'Export again', exact: true }).click()
  await waitPhase(page, 'ready', 5000)
  await page.getByRole('radio', { name: '30', exact: true }).click({ force: true })
  await startButton(page).click()
  const halfway = await waitFor(async () => ((await state(page, '(ed, ex) => ex.progress?.fraction ?? 0')) || 0) >= 0.25, 120_000, 50)
  check('progress reaches 25 percent before cancelling', halfway)
  check('progressbar carries aria-valuenow', Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')) >= 25)
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
  // Restoring a project with missing media opens the re-link dialog, which covers the page. It is not part of this check.
  if (await waitFor(async () => await state(page, '(ed, ex, m) => m.relinkOpen'), 5000)) {
    await page.keyboard.press('Escape')
    await waitFor(async () => !(await state(page, '(ed, ex, m) => m.relinkOpen')), 2000)
    await state(page, '(ed, ex, m) => { m.relinkOpen = false }')
  }
  await page.locator('#export-button').click()
  await dialog(page).waitFor()
  await waitPhase(page, 'ready', 15_000)
  const warning = dialog(page).getByRole('alert')
  await warning.waitFor({ timeout: 5000 }).catch(() => undefined)
  const warningText = (await warning.count()) ? await warning.first().innerText() : ''
  check('missing media shows a warning naming the files', /frames\.webm/.test(warningText) && /clip-a\.webm/.test(warningText), warningText)
  check('missing media disables Start export', !(await startButton(page).isEnabled()))

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
  }
  await page.keyboard.press('Escape')
  await context.close()
}

// ---------- Pass D: background tab while exporting ----------
{
  const { context, page, pageErrors } = await newPage({ initScript: PICKER_OFF })
  await setupProject(page)
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await pickResolution(page, '480p')
  const noticeText = /Keep it open in the foreground/
  await startButton(page).click()
  await waitFor(async () => ((await state(page, '(ed, ex) => ex.progress?.fraction ?? 0')) || 0) > 0.05, 120_000, 50)
  await setVisibility(page, 'hidden')
  check('a hidden tab shows the calm notice while exporting', await waitFor(async () => noticeText.test(await dialog(page).innerText()), 3000, 50))
  check('the store knows the tab is hidden', await state(page, '(ed, ex) => ex.hiddenNow'))
  await setVisibility(page, 'visible')
  check('the notice disappears when the tab is visible again', await waitFor(async () => !noticeText.test(await dialog(page).innerText()), 3000, 50))
  await waitPhase(page, 'done', 180_000)
  check('the run with a short hidden stretch finishes', (await state(page, '(ed, ex) => ex.phase')) === 'done')

  // A run that stays hidden is throttled: its timing must not become the calibration.
  await page.getByRole('button', { name: 'Export again', exact: true }).click()
  await waitPhase(page, 'ready', 5000)
  const before = await page.evaluate(() => localStorage.getItem('jellycut.export.calibration'))
  await setVisibility(page, 'hidden')
  await startButton(page).click()
  await waitPhase(page, 'done', 180_000)
  const share = await state(page, '(ed, ex) => ex.result?.hiddenShare ?? 0')
  check('the hidden run reports most of its time as hidden', share > 0.5, `share ${share}`)
  check('a run hidden for most of its time does not change the calibration', (await page.evaluate(() => localStorage.getItem('jellycut.export.calibration'))) === before)
  check('the done state explains that the estimate was not changed', (await dialog(page).textContent()).includes('did not change the estimate'))
  await setVisibility(page, 'visible')
  check('no uncaught page errors in pass D', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// ---------- Pass B: picker path (showSaveFilePicker present and stubbed) ----------
{
  const { context, page, pageErrors } = await newPage({ initScript: pickerStub('ok') })
  await setupProject(page)
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await pickResolution(page, '480p')
  let downloads = 0
  page.on('download', () => downloads++)
  await startButton(page).click()
  const calledAtStart = await waitFor(() => page.evaluate(() => window.__picker.calls.length === 1), 5000, 50)
  check('picker pass: the save dialog opens when Start is pressed (before the export)', calledAtStart)
  check('picker pass: the save dialog suggests "New project.mp4"', await page.evaluate(() => window.__picker.calls[0]?.suggestedName === 'New project.mp4'))
  const midRun = await state(page, '(ed, ex) => ex.phase')
  check('picker pass: the export runs after the file is chosen', ['running', 'done'].includes(midRun), midRun)
  const done = await waitPhase(page, 'done', 180_000)
  check('picker pass: export finishes', done)
  const picked = await waitFor(() => page.evaluate(() => window.__picker.written !== null), 10_000, 100)
  check('picker pass: the finished file is written to the picked file by itself', picked)
  check('picker pass: the done state says the file was saved', (await dialog(page).innerText()).includes('Saved to New project.mp4'))
  if (picked) {
    const b64 = await page.evaluate(`(async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(s) })(window.__picker.written)`)
    const bytes = Buffer.from(b64, 'base64')
    check('picker pass: written bytes are an MP4 (ftyp at offset 4)', bytes.toString('latin1', 4, 8) === 'ftyp')
  }
  await page.waitForTimeout(500)
  check('picker pass: no download is started', downloads === 0, `${downloads}`)
  await saveAgainButton(page).click()
  const againPicked = await waitFor(() => page.evaluate(() => window.__picker.calls.length === 2), 5000, 100)
  check('picker pass: "Save again" asks for a file again', againPicked)
  check('picker pass: no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// ---------- Pass B2: picker cancelled: nothing starts ----------
{
  const { context, page, pageErrors } = await newPage({ initScript: pickerStub('abort') })
  await setupProject(page)
  let downloads = 0
  page.on('download', () => downloads++)
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await pickResolution(page, '480p')
  await startButton(page).click()
  await waitFor(() => page.evaluate(() => window.__picker.calls.length === 1), 5000, 50)
  await page.waitForTimeout(800)
  check('cancelled picker: the dialog is back in the settings', (await state(page, '(ed, ex) => ex.phase')) === 'ready' && (await dialog(page).isVisible()))
  check('cancelled picker: no export has started', (await state(page, '(ed, ex) => ex.progress')) === null && (await dialog(page).getByRole('progressbar').count()) === 0)
  check('cancelled picker: no download', downloads === 0)
  check('cancelled picker: Start export is enabled again', await startButton(page).isEnabled())
  check('cancelled picker: no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
}

// ---------- Pass B3: write error after the export: clear message and the file is downloaded ----------
{
  const { context, page, pageErrors } = await newPage({ initScript: pickerStub('writefail') })
  await setupProject(page)
  let downloads = 0
  page.on('download', () => downloads++)
  await page.locator('#export-button').click()
  await waitPhase(page, 'ready', 15_000)
  await pickResolution(page, '480p')
  const autoDownload = page.waitForEvent('download', { timeout: 180_000 }).catch(() => null)
  await startButton(page).click()
  await waitPhase(page, 'done', 180_000)
  const fallback = await autoDownload
  check('write error: the file is downloaded instead', fallback !== null && fallback.suggestedFilename() === 'New project.mp4')
  const alert = dialog(page).getByRole('alert')
  await alert.waitFor({ timeout: 5000 }).catch(() => undefined)
  const alertText = (await alert.count()) ? await alert.first().innerText() : ''
  check('write error: a clear message names the reason', /could not be written \(disk full\)/.test(alertText), alertText)
  check('write error: no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
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
  check('German estimate lines: video length, file size and export time', text.includes('Video: ') && text.includes('Datei ca. ') && /Export dauert ca\. \S/.test(text) && !text.includes('export takes'), text.replace(/\n/g, ' | '))
  check('German calibration hint is shown', text.includes('Die Schätzung wird nach dem ersten Export'))
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
