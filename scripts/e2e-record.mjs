// End-to-end check of the Record tab in a real Chromium with fake devices: microphone, camera and screen
// recordings land in the library, pause/resume, cancel, permission and device errors, hidden screen button,
// the level meter, track cleanup, shortcut guard, beforeunload, and screenshots (light and dark).
// Usage: node scripts/e2e-record.mjs   (env SHOT_DIR overrides the screenshot folder)
// Headless Chromium cannot show the screen picker, so the screen source is a canvas stream (see mediaStubs).
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 5183
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'

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

/**
 * Runs before the app. Records every stream it hands out, can make getUserMedia fail like a denied
 * permission or a missing device, and replaces the screen picker with a canvas stream (or removes it).
 */
function mediaStubs(opts) {
  const md = navigator.mediaDevices
  window.__streams = []
  window.__mode = 'normal'
  const realGetUserMedia = md.getUserMedia.bind(md)
  md.getUserMedia = async (constraints) => {
    if (window.__mode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError')
    if (window.__mode === 'missing') throw new DOMException('Requested device not found', 'NotFoundError')
    const stream = await realGetUserMedia(constraints)
    window.__streams.push(stream)
    return stream
  }
  if (opts.noDisplay) {
    Object.defineProperty(md, 'getDisplayMedia', { value: undefined, configurable: true })
  } else {
    md.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const ctx = canvas.getContext('2d')
      let frame = 0
      setInterval(() => {
        ctx.fillStyle = `hsl(${(frame++ * 12) % 360} 70% 45%)`
        ctx.fillRect(0, 0, 640, 360)
      }, 67)
      const stream = canvas.captureStream(15)
      window.__streams.push(stream)
      return stream
    }
  }
}

const snapshot = (page) =>
  page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const editor = pinia.state.value.editor
    return {
      project: JSON.parse(JSON.stringify(editor.history.present)),
      past: editor.history.past.length,
      isPlaying: editor.isPlaying
    }
  })
const project = async (page) => (await snapshot(page)).project

const recState = (page) =>
  page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const r = pinia.state.value.record
    return { phase: r.phase, kind: r.kind, elapsedMs: r.elapsedMs, level: r.level, assetId: r.assetId }
  })

const tracksEnded = (page) =>
  page.evaluate(() => {
    const streams = window.__streams
    return streams.length > 0 && streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))
  })

const bodyText = (page) => page.evaluate(() => document.body.innerText)

async function waitUntil(fn, timeoutMs, message) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(message)
}

const near = (a, b, tol) => Math.abs(a - b) <= tol
const NAME_PATTERN = {
  microphone: /^Microphone \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.webm$/,
  camera: /^Camera \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.webm$/,
  screen: /^Screen \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.webm$/
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'
  ]
})
mkdirSync(SHOT_DIR, { recursive: true })

const pageErrors = []

async function freshPage({ scheme = 'light', stubs = {} } = {}) {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1120, height: 700 },
    colorScheme: scheme
  })
  await context.addInitScript(mediaStubs, stubs)
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(APP_URL)
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('heading', { name: 'Record', exact: true }).waitFor()
  return { page, context }
}

const sourceButton = (page, kind) =>
  page.getByRole('button', { name: { microphone: /^Microphone/, camera: /^Camera/, screen: /^Screen/ }[kind] })
const stopButton = (page) => page.getByRole('button', { name: 'Stop', exact: true })
const addButton = (page) => page.getByRole('button', { name: 'Add to timeline', exact: true })

/** Clicks Stop and waits until the recording is an asset in the project. Returns the asset. */
async function stopAndWaitForAsset(page, kind, before) {
  await stopButton(page).click()
  try {
    await addButton(page).waitFor({ timeout: 15000 })
  } catch (e) {
    const alert = await page.getByRole('alert').textContent().catch(() => '')
    throw new Error(`no "Add to timeline" after stop; alert: "${alert}"`)
  }
  const proj = await project(page)
  const asset = proj.assets.find((a) => !before.includes(a.id) && NAME_PATTERN[kind].test(a.name))
  assert(asset, `no new ${kind} asset; names: ${proj.assets.map((a) => a.name).join(', ')}`)
  return asset
}

const assetIds = async (page) => (await project(page)).assets.map((a) => a.id)

// ---------- idle state, light and dark ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('idle panel offers microphone and camera, and screen where it is supported', async () => {
    await sourceButton(page, 'microphone').waitFor()
    await sourceButton(page, 'camera').waitFor()
    await sourceButton(page, 'screen').waitFor()
    const boxes = await Promise.all(['microphone', 'camera', 'screen'].map((k) => sourceButton(page, k).boundingBox()))
    for (const box of boxes) assert(box && box.height >= 44, `button height ${box?.height}`)
  })
  await check('idle state screenshot (light)', async () => {
    await page.screenshot({ path: join(SHOT_DIR, 'record-idle-light.png') })
  })
  await context.close()
}
{
  const { page, context } = await freshPage({ scheme: 'dark' })
  await check('idle state screenshot (dark)', async () => {
    await sourceButton(page, 'microphone').waitFor()
    await page.screenshot({ path: join(SHOT_DIR, 'record-idle-dark.png') })
  })
  await context.close()
}

// ---------- microphone: level meter, stop, library, timeline, track cleanup, shortcut guard ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('microphone: records about 2 s, the level meter moves, the asset lands in the library', async () => {
    const before = await assetIds(page)
    await sourceButton(page, 'microphone').click()
    await stopButton(page).waitFor()

    // The editor's shortcuts must not reach the timeline while recording: Space would start playback.
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Space')
    await page.waitForTimeout(200)
    assert((await snapshot(page)).isPlaying === false, 'Space started playback during a recording')
    const dirty = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
    assert(dirty, 'leaving the page during a recording does not warn')

    let peak = 0
    await waitUntil(
      async () => {
        const state = await recState(page)
        peak = Math.max(peak, state.level)
        return state.elapsedMs >= 2000
      },
      5000,
      'microphone recording did not reach 2 s'
    )
    assert(peak > 0.01, `level meter did not move (peak ${peak.toFixed(4)})`)

    const asset = await stopAndWaitForAsset(page, 'microphone', before)
    assert(asset.kind === 'audio', `kind ${asset.kind}`)
    assert(near(asset.duration / 1e6, 2, 0.4), `duration ${(asset.duration / 1e6).toFixed(2)} s, expected 2 +- 0.4`)
    assert(await tracksEnded(page), 'microphone tracks are still live after stop')
    const idle = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
    assert(!idle, 'beforeunload still warns after the recording ended')
  })

  await check('microphone: "Add to timeline" adds a music item for the new asset', async () => {
    const asset = (await project(page)).assets.findLast((a) => NAME_PATTERN.microphone.test(a.name))
    assert(asset, 'microphone asset missing')
    const musicBefore = (await project(page)).music.length
    await addButton(page).click()
    await waitUntil(
      async () => (await project(page)).music.length === musicBefore + 1,
      5000,
      'music item was not added'
    )
    const proj = await project(page)
    assert(proj.music.at(-1).assetId === asset.id, 'music item points at another asset')
  })

  await check('microphone: "Record again" returns to the source buttons', async () => {
    await page.getByRole('button', { name: 'Record again', exact: true }).click()
    await sourceButton(page, 'microphone').waitFor()
  })
  await context.close()
}

// ---------- camera: pause/resume, preview, tab switch, asset with picture and sound ----------
for (const scheme of ['light', 'dark']) {
  const { page, context } = await freshPage({ scheme })
  const before = await assetIds(page)
  let asset = null
  await check(`camera (${scheme}): preview is bound, screenshot of the recording`, async () => {
    await sourceButton(page, 'camera').click()
    await stopButton(page).waitFor()
    await waitUntil(
      () => page.evaluate(() => {
        const v = document.querySelector('video')
        return !!v && v.srcObject instanceof MediaStream && v.videoWidth > 0
      }),
      8000,
      'camera preview has no picture'
    )
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(SHOT_DIR, `record-camera-${scheme}.png`) })
  })

  if (scheme === 'light') {
    await check('camera: pause stops the elapsed time, resume continues it, tab switch keeps the recording', async () => {
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: 'Pause', exact: true }).click()
      await page.getByRole('button', { name: 'Resume', exact: true }).waitFor()
      const paused1 = (await recState(page)).elapsedMs
      await page.waitForTimeout(1500)
      const paused2 = (await recState(page)).elapsedMs
      assert(paused2 - paused1 < 50, `elapsed moved while paused by ${paused2 - paused1} ms`)
      assert(paused1 >= 600 && paused1 <= 1700, `elapsed before pause ${paused1} ms`)

      await page.getByRole('button', { name: 'Resume', exact: true }).click()
      await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Media', exact: true }).click()
      await page.waitForTimeout(400)
      assert((await recState(page)).phase === 'recording', 'recording stopped when the left column switched tab')
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await stopButton(page).waitFor()
      const state = await recState(page)
      assert(state.phase === 'recording', `phase ${state.phase} after coming back`)
      assert(state.elapsedMs > paused2, 'elapsed time did not continue after resume')
    })
  }

  await check(`camera (${scheme}): stop yields a video asset with picture, sound and thumbnail`, async () => {
    await waitUntil(async () => (await recState(page)).elapsedMs >= 2000, 8000, 'camera recording did not reach 2 s')
    asset = await stopAndWaitForAsset(page, 'camera', before)
    assert(asset.kind === 'video', `kind ${asset.kind}`)
    assert(asset.width > 0 && asset.height > 0, `size ${asset.width}x${asset.height}`)
    assert(asset.hasAudio === true, `hasAudio ${asset.hasAudio}`)
    assert(near(asset.duration / 1e6, 2, 0.8), `duration ${(asset.duration / 1e6).toFixed(2)} s`)
    assert(await tracksEnded(page), 'camera tracks are still live after stop')
    await waitUntil(
      () => page.evaluate((id) => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        return !!pinia.state.value.media.thumbnails[id]
      }, asset.id),
      8000,
      'no thumbnail for the camera asset'
    )
  })

  await check(`camera (${scheme}): finished state screenshot`, async () => {
    await addButton(page).waitFor()
    await page.screenshot({ path: join(SHOT_DIR, `record-done-${scheme}.png`) })
  })
  await context.close()
}

// ---------- cancel discards ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('cancel discards the recording and adds no asset', async () => {
    const before = await assetIds(page)
    await sourceButton(page, 'microphone').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await sourceButton(page, 'microphone').waitFor()
    assert((await recState(page)).phase === 'idle', 'phase is not idle after cancel')
    assert(await tracksEnded(page), 'tracks still live after cancel')
    const status = await page.getByRole('status').textContent()
    assert(/discarded/i.test(status), `status says "${status}"`)
    await page.waitForTimeout(300)
    const after = await assetIds(page)
    assert(after.length === before.length, `asset count changed from ${before.length} to ${after.length}`)
  })
  await context.close()
}

// ---------- errors: friendly text, retry, no raw error names ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('denied permission shows a friendly message and "Try again" works after allowing', async () => {
    await page.evaluate(() => (window.__mode = 'deny'))
    await sourceButton(page, 'camera').click()
    const alert = page.getByRole('alert')
    await alert.waitFor()
    const text = await alert.textContent()
    assert(/Access was not allowed/.test(text), `alert says "${text}"`)
    assert(!(await bodyText(page)).includes('NotAllowedError'), 'raw NotAllowedError text is shown')
    await page.evaluate(() => (window.__mode = 'normal'))
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1200)
    await stopButton(page).click()
    await addButton(page).waitFor({ timeout: 15000 })
  })
  await check('missing device shows a friendly message without the raw name', async () => {
    await page.getByRole('button', { name: 'Record again', exact: true }).click()
    await page.evaluate(() => (window.__mode = 'missing'))
    await sourceButton(page, 'microphone').click()
    const alert = page.getByRole('alert')
    await alert.waitFor()
    const text = await alert.textContent()
    assert(/No suitable device was found/.test(text), `alert says "${text}"`)
    assert(!(await bodyText(page)).includes('NotFoundError'), 'raw NotFoundError text is shown')
    await page.evaluate(() => (window.__mode = 'normal'))
  })
  await context.close()
}

{
  const { page, context } = await freshPage({ scheme: 'light', stubs: { noDisplay: true } })
  await check('without getDisplayMedia the Screen button is hidden, the others stay', async () => {
    await sourceButton(page, 'microphone').waitFor()
    await sourceButton(page, 'camera').waitFor()
    assert((await sourceButton(page, 'screen').count()) === 0, 'Screen button is still shown')
  })
  await context.close()
}

// ---------- screen: canvas stub, browser stop-sharing finishes the recording ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('screen: the browser stop-sharing button finishes the recording as a normal asset', async () => {
    const before = await assetIds(page)
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1200)
    await page.evaluate(() => {
      const track = window.__streams.at(-1).getVideoTracks()[0]
      track.dispatchEvent(new Event('ended'))
    })
    await addButton(page).waitFor({ timeout: 15000 })
    const proj = await project(page)
    const asset = proj.assets.find((a) => !before.includes(a.id) && NAME_PATTERN.screen.test(a.name))
    assert(asset, `no screen asset; names: ${proj.assets.map((a) => a.name).join(', ')}`)
    assert(asset.kind === 'video' && asset.width > 0, `screen asset ${asset.kind} ${asset.width}`)
    assert(await tracksEnded(page), 'screen tracks are still live after the browser ended the share')
  })
  await context.close()
}

// ---------- responsiveness after all that ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('the app stays responsive: the tab switches and the project is still editable', async () => {
    const t0 = Date.now()
    await page.getByRole('button', { name: 'Media', exact: true }).click()
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await sourceButton(page, 'microphone').waitFor()
    assert(Date.now() - t0 < 3000, `tab switching took ${Date.now() - t0} ms`)
  })
  await context.close()
}

await browser.close()
await server.close()

outcomes.push(pageErrors.length === 0)
console.log(pageErrors.length === 0 ? 'PASS no uncaught page errors' : `FAIL uncaught page errors: ${pageErrors.join(' | ')}`)

const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
