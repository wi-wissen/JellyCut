// Real-browser check that recordings survive: a recording stays ready through fine cut and export (no state loss
// inside the session), is restored from the browser's private storage after a reload (no re-link dialog), is
// removed with "New project", falls back to the rescue download on a quota error, and shows the specific message
// when a project file is opened where the recording was never stored. File pickers are disabled (Firefox-like).
// Usage: node scripts/e2e-persist.mjs        (BROWSER=firefox runs it in Firefox when installed; env SHOT_DIR)
import { chromium, firefox } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 5430
const APP_URL = `http://localhost:${PORT}/app/`
const BROWSER = process.env.BROWSER === 'firefox' ? 'firefox' : 'chromium'
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
mkdirSync(SHOT_DIR, { recursive: true })

let failed = 0
function check(name, ok, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`)
}

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

// The browsers cannot show the screen picker headless: the screen is a moving canvas stream.
function stubs() {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    let frame = 0
    setInterval(() => {
      ctx.fillStyle = `hsl(${(frame++ * 12) % 360} 70% 45%)`
      ctx.fillRect(0, 0, 640, 360)
    }, 67)
    return canvas.captureStream(15)
  }
  Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true })
  Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true, writable: true })
  Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true, writable: true })
}

const server = await createServer({ server: { port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' })
await server.listen()
const browser =
  BROWSER === 'firefox'
    ? await firefox.launch({ firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } })
    : await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })

const pageErrors = []
async function newSession(init = null) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, acceptDownloads: true })
  await context.addInitScript(stubs)
  if (init) await context.addInitScript(init)
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('dialog', (d) => void d.accept())
  await page.goto(APP_URL)
  await page.locator('#project-menu-trigger').waitFor()
  return { context, page }
}

// Runs `fn(editor, media, record, arg)` in the page.
const run = (page, fn, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      return new Function(`return (${src})`)()(pinia._s.get('editor'), pinia._s.get('media'), pinia._s.get('record'), a, pinia)
    },
    [fn.toString(), arg]
  )

async function waitFor(fn, timeout = 15_000, step = 100) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, step))
  }
  return false
}

const relinkOpen = (page) => page.locator('[role=dialog]').filter({ hasText: 'Missing files' }).count()

/** Records the screen for about 2 s, puts the clip on the timeline. Returns the asset. */
async function recordAndPlace(page) {
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: /^Screen/ }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
  await page.waitForTimeout(2200)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).click()
  return run(page, (ed) => ed.project.assets.find((a) => /^Screen /.test(a.name)))
}

const mediaState = (page, id) =>
  run(
    page,
    async (ed, me, rec, assetId) => {
      const mod = await import('/src/ui/stores/media.ts')
      const f = mod.getAssetFile(assetId)
      return { status: me.statusOf(assetId), fileSize: f ? f.size : null, hasFile: !!f, relinkOpen: me.relinkOpen, missing: me.missingCount }
    },
    id
  )


/** Starts the export (download path). Returns 'done', or 'unsupported' where this browser cannot encode (headless Firefox). */
async function exportVideo(page) {
  await page.locator('#export-button').click()
  await page.getByRole('button', { name: 'Start export', exact: true }).waitFor({ timeout: 30_000 })
  const ready = await waitFor(() => page.getByRole('button', { name: 'Start export', exact: true }).isEnabled(), 30_000)
  if (!ready) return 'unsupported'
  const download = page.waitForEvent('download', { timeout: BROWSER === 'firefox' ? 45_000 : 120_000 }).catch(() => null)
  await page.getByRole('button', { name: 'Start export', exact: true }).click()
  const got = await download
  await waitFor(async () => (await run(page, (ed, me, rec, a, pinia) => pinia._s.get('export').phase)) !== 'running', 60_000)
  return got ? 'done' : 'failed'
}

const storedKeys = (page) => run(page, (ed, me) => me.storedKeys())
const assetOf = (page) => run(page, (ed) => ed.project.assets.find((a) => /^Screen /.test(a.name)) ?? null)

/** Average brightness (0..255) of the preview canvas. */
async function canvasLuma(page) {
  const buf = await page.locator('canvas').first().screenshot()
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3
    return sum / (d.length / 4)
  }, buf.toString('base64'))
}

async function menuItem(page, name) {
  await page.locator('#project-menu-trigger').click()
  await page.getByRole('menuitem', { name }).click()
}

// ---------- A. inside one session: record, fine cut, export; nothing is lost ----------
{
  const { context, page } = await newSession()
  const asset = await recordAndPlace(page)
  check('recording is an asset on the timeline', !!asset && (await run(page, (ed) => ed.project.clips.length)) === 1)
  check('the asset is marked as a recording with a store key', asset?.origin === 'recording' && /^[A-Za-z0-9_-]{8,64}$/.test(asset?.storeKey ?? ''), JSON.stringify(asset))
  const before = await mediaState(page, asset.id)
  check('recording is ready with a File', before.status === 'ready' && before.hasFile, JSON.stringify(before))
  check('a copy is in the browser storage', (await storedKeys(page)).includes(asset.storeKey))

  await run(page, async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const fc = pinia._s.get('fineCut')
    await fc.open()
    await fc.stepFrames(5)
    await fc.cutHere()
    fc.close()
  })
  const exported = await exportVideo(page)
  console.log(`INFO export in ${BROWSER}: ${exported}`)
  await page.waitForTimeout(1500)
  const after = await mediaState(page, asset.id)
  check('after fine cut and export the recording is still ready, same File size', after.status === 'ready' && after.fileSize === before.fileSize, JSON.stringify(after))
  check('no re-link dialog after the export', (await relinkOpen(page)) === 0 && !after.relinkOpen)
  if (exported === 'done') check('the export did not produce a "missing files" message', !(await page.locator('[role=dialog]').innerText().catch(() => '')).includes('missing'))
  await context.close()
}

// ---------- B. reload: the recording comes back from storage ----------
{
  const { context, page } = await newSession()
  const asset = await recordAndPlace(page)
  await run(page, (ed) => ed.flushAutosave())
  await page.waitForTimeout(500)
  await page.reload()
  await page.locator('#project-menu-trigger').waitFor()
  await page.waitForTimeout(800)
  const st = await mediaState(page, asset.id)
  check('after a reload the recording is ready at once', st.status === 'ready' && st.hasFile, JSON.stringify(st))
  check('after a reload no re-link dialog and no banner', (await relinkOpen(page)) === 0 && st.missing === 0)
  const again = await assetOf(page)
  check('the restored asset keeps its duration and store key', again?.duration === asset.duration && again?.storeKey === asset.storeKey)
  check('the project menu shows the used storage', await (async () => {
    await page.locator('#project-menu-trigger').click()
    const text = await page.locator('[data-role=stored-media]').innerText().catch(() => '')
    await page.keyboard.press('Escape')
    return /Recordings in this browser: [\d.,]+ (kB|KB|MB|B)/.test(text)
  })())
  // Headless Firefox in the sandbox has no WebGL2: the preview cannot draw there.
  const gl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))
  if (gl) {
    await run(page, (ed) => ed.setPlayhead(Math.round(ed.totalDuration / 2)))
    await page.waitForTimeout(800)
    const luma = await canvasLuma(page)
    check('the paused preview shows a frame of the recording (not black)', luma > 25, `luma ${luma.toFixed(1)}`)
    const t0 = await run(page, (ed) => ed.playheadMicros)
    await run(page, (ed) => { ed.setPlayhead(0); ed.togglePlaying() })
    await page.waitForTimeout(700)
    const playing = await run(page, (ed) => ({ t: ed.playheadMicros, p: ed.isPlaying }))
    await run(page, (ed) => { if (ed.isPlaying) ed.togglePlaying() })
    check('the recording plays and pauses', playing.p && playing.t > 100_000 && t0 > 0, JSON.stringify(playing))
  } else console.log('SKIP preview checks (no WebGL2 in this browser)')
  await page.screenshot({ path: join(SHOT_DIR, 'persist-restored.png') })
  await context.close()
}

// ---------- C. New project removes the stored copy ----------
{
  const { context, page } = await newSession()
  const asset = await recordAndPlace(page)
  check('stored before New project', (await storedKeys(page)).includes(asset.storeKey))
  let confirmText = ''
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => { confirmText = d.message(); void d.accept() })
  await menuItem(page, /New project/)
  await waitFor(async () => (await storedKeys(page)).length === 0, 8000)
  check('New project asks first because the recording exists only in this browser', /only in this browser|stored only/i.test(confirmText), confirmText)
  check('New project deleted the stored copy', (await storedKeys(page)).length === 0)
  await context.close()
}

// ---------- D. quota error: stays in memory, rescue download offered ----------
{
  const { context, page } = await newSession(() => {
    const realPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'media') throw new DOMException('quota', 'QuotaExceededError')
      return realPut.apply(this, args)
    }
  })
  const asset = await recordAndPlace(page)
  check('quota: the recording is still ready in memory', (await mediaState(page, asset.id)).status === 'ready')
  check('quota: nothing was stored', (await storedKeys(page)).length === 0)
  // The done panel is gone after "Add to timeline"? It stays; reopen the Record tab if needed.
  await page.getByRole('button', { name: 'Record', exact: true }).click().catch(() => undefined)
  const alert = page.locator('[data-role=storage-problem]')
  check('quota: a clear message is shown', (await alert.count()) === 1 && /storage is full/i.test(await alert.innerText()))
  const download = page.waitForEvent('download', { timeout: 10_000 })
  await page.locator('[data-role=save-file]').first().click()
  const file = await download
  check('quota: the rescue download delivers the recording', /^Screen .*\.webm$/.test(file.suggestedFilename()), file.suggestedFilename())
  await page.screenshot({ path: join(SHOT_DIR, 'persist-quota.png') })
  await context.close()
}

// ---------- E. success state offers a copy as a file ----------
{
  const { context, page } = await newSession()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: /^Screen/ }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
  await page.waitForTimeout(2200)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).waitFor({ timeout: 20_000 })
  const btn = page.getByRole('button', { name: 'Save a copy as a file', exact: true })
  check('the done panel has a small "Save a copy as a file" button', (await btn.count()) === 1)
  check('the done panel says the recording is stored in this browser', (await page.locator('[data-role=stored-hint]').count()) === 1)
  const download = page.waitForEvent('download', { timeout: 10_000 })
  await btn.click()
  const file = await download
  check('the copy downloads as the recording file', /^Screen .*\.webm$/.test(file.suggestedFilename()))
  await page.screenshot({ path: join(SHOT_DIR, 'persist-done.png') })
  await context.close()
}

// ---------- F. project file opened where the recording was never stored ----------
{
  const first = await newSession()
  const asset = await recordAndPlace(first.page)
  const projectText = await run(first.page, async (ed) => {
    const mod = await import('/src/core/project/schema.ts')
    return mod.serializeProject(ed.project)
  })
  const recordingB64 = await run(first.page, async (ed, me, rec, id) => {
    const mod = await import('/src/ui/stores/media.ts')
    const buf = new Uint8Array(await mod.getAssetFile(id).arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192))
    return btoa(bin)
  }, asset.id)
  await first.context.close()

  const { context, page } = await newSession()
  await page.locator('#project-menu-trigger').click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: /Open project/ }).click()])
  await chooser.setFiles({ name: 'clip.jellycut.json', mimeType: 'application/json', buffer: Buffer.from(projectText) })
  const dialog = page.locator('[role=dialog]').filter({ hasText: 'Missing files' })
  await dialog.waitFor({ timeout: 10_000 })
  check('the dialog opens for a recording that is not in this browser', (await dialog.count()) === 1)
  const note = await dialog.locator('[data-role=relink-elsewhere]').innerText().catch(() => '')
  check('the dialog explains it was only stored in the other browser', /only stored in the other browser/.test(note), note)
  check('the dialog has no folder button without the directory picker', (await dialog.getByRole('button', { name: /Choose folder/ }).count()) === 0)
  const tile = await page.locator('main, body').first().innerText()
  check('the library tile says "Recording not found any more."', tile.includes('Recording not found any more.'))
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: /Select files/ }).click()])
  await chooser2.setFiles({ name: asset.name, mimeType: 'video/webm', buffer: Buffer.from(recordingB64, 'base64') })
  const ok = await waitFor(async () => (await mediaState(page, asset.id)).status === 'ready', 15_000)
  check('picking the saved file links the recording again', ok)
  await waitFor(async () => (await storedKeys(page)).includes(asset.storeKey), 8000)
  check('and keeps it in this browser from now on', (await storedKeys(page)).includes(asset.storeKey))
  await page.screenshot({ path: join(SHOT_DIR, 'persist-elsewhere.png') })
  await context.close()
}

console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5))
await browser.close()
await server.close()
process.exit(failed === 0 ? 0 : 1)
