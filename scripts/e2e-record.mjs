// End-to-end check of the Record tab in a real Chromium with fake devices: microphone, camera and screen
// recordings land in the library, pause/resume, cancel, permission and device errors, hidden screen button,
// the level meter, track cleanup, shortcut guard, beforeunload, and screenshots (light and dark).
// Usage: node scripts/e2e-record.mjs   (env SHOT_DIR overrides the screenshot folder)
// Headless Chromium cannot show the screen picker, so the screen source is a canvas stream (see mediaStubs).
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 5183)
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
  // Failure injection for the Firefox-like cases: a recorder that never fires 'stop', and unreadable recorder output.
  const stopDesc = Object.getOwnPropertyDescriptor(MediaRecorder.prototype, 'onstop')
  Object.defineProperty(MediaRecorder.prototype, 'onstop', {
    configurable: true,
    get: stopDesc.get,
    set(fn) {
      stopDesc.set.call(this, window.__silentStop ? null : fn)
    }
  })
  const dataDesc = Object.getOwnPropertyDescriptor(MediaRecorder.prototype, 'ondataavailable')
  Object.defineProperty(MediaRecorder.prototype, 'ondataavailable', {
    configurable: true,
    get: dataDesc.get,
    set(fn) {
      if (!fn) return dataDesc.set.call(this, fn)
      dataDesc.set.call(this, (event) =>
        {
          if (!window.__garbage && event.data.size > 0) window.__recBlobs.push(event.data)
          return window.__garbage ? fn({ data: new Blob([new Uint8Array(5000).fill(7)]) }) : fn(event)
        }
      )
    }
  })
  window.__recStreams = []
  window.__recBlobs = []
  window.__gumCalls = 0
  const realStart = MediaRecorder.prototype.start
  MediaRecorder.prototype.start = function (...args) {
    window.__recStreams.push(this.stream)
    return realStart.apply(this, args)
  }
  window.__mode = 'normal'
  const realGetUserMedia = md.getUserMedia.bind(md)
  md.getUserMedia = async (constraints) => {
    window.__gumCalls++
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
      if (window.__staticScreen) {
        // Firefox with a window that does not change: one frame at the start, then nothing.
        const still = document.createElement('canvas')
        still.width = 800
        still.height = 450
        const sctx = still.getContext('2d')
        sctx.fillStyle = '#2d6a4f'
        sctx.fillRect(0, 0, 800, 450)
        const stillStream = still.captureStream(0)
        stillStream.getVideoTracks()[0].requestFrame()
        window.__streams.push(stillStream)
        return stillStream
      }
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
      const track = window.__streams.findLast((s) => s.getVideoTracks().length > 0).getVideoTracks()[0]
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

// ---------- screen, still content (Firefox delivers no frames for a window that does not change) ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('screen: a still share is recorded through the canvas pipeline and keeps its length', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__staticScreen = true))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(2500)
    const recorded = await page.evaluate(() => {
      const track = window.__recStreams.at(-1).getVideoTracks()[0]
      return { canvasTrack: typeof track.requestFrame === 'function' }
    })
    assert(recorded.canvasTrack, 'the recorder got the raw display stream, not the canvas stream')
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.kind === 'video' && asset.width > 0, `screen asset ${asset.kind} ${asset.width}`)
    assert(asset.width % 2 === 0 && asset.height % 2 === 0, `odd size ${asset.width}x${asset.height}`)
    assert(asset.duration / 1e6 >= 1.5, `still screen clip lasts ${(asset.duration / 1e6).toFixed(2)} s, expected >= 1.5`)
    assert(await tracksEnded(page), 'tracks still live after the still recording')
  })
  await check('screen: a short still recording stopped right away still flushes its data', async () => {
    await page.getByRole('button', { name: 'Record again', exact: true }).click()
    const before = await assetIds(page)
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1200)
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.duration / 1e6 >= 0.5, `clip lasts ${(asset.duration / 1e6).toFixed(2)} s`)
    assert(await tracksEnded(page), 'tracks still live')
  })
  await check('screen: pausing a still recording and resuming it keeps working', async () => {
    await page.getByRole('button', { name: 'Record again', exact: true }).click()
    const before = await assetIds(page)
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.waitForTimeout(900)
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.duration / 1e6 >= 1, `clip lasts ${(asset.duration / 1e6).toFixed(2)} s`)
  })
  await context.close()
}

// ---------- screen with the student's voice ----------
const micSwitch = (page) => page.locator('[data-role="mic-switch"]')
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('screen: the voice switch is on by default, explained, and has a 44px target', async () => {
    assert(await micSwitch(page).isChecked(), 'switch is off by default')
    const text = await bodyText(page)
    assert(/Record my voice/.test(text) && /headphones avoid echo/.test(text), 'switch label or help text missing')
    const box = await micSwitch(page).locator('xpath=ancestor::label').boundingBox()
    assert(box && box.height >= 44, `switch row height ${box?.height}`)
  })
  await check('screen + voice: one video and one audio track are recorded, the clip has audible sound and a waveform', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(2500)
    const level = await page.locator('[data-role="mic-level"]').count()
    assert(level === 1, 'no level meter for screen + voice')
    const tracks = await page.evaluate(() => {
      const s = window.__recStreams.at(-1)
      return { video: s.getVideoTracks().length, audio: s.getAudioTracks().length }
    })
    assert(tracks.video === 1 && tracks.audio === 1, `recorded tracks ${JSON.stringify(tracks)}`)
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.hasAudio === true, `hasAudio ${asset.hasAudio}`)
    assert(asset.duration / 1e6 >= 1.5, `duration ${(asset.duration / 1e6).toFixed(2)} s`)
    assert(await tracksEnded(page), 'tracks (screen and microphone) still live after stop')
    const peak = await page.evaluate(async () => {
      const { computeWaveform } = await import('/src/engine/audio/waveform.ts')
      const { peaksForRange } = await import('/src/core/audio/peaks.ts')
      const file = new File(window.__recBlobs, 'rec.webm', { type: 'video/webm' })
      const wave = await computeWaveform(file)
      if (!wave) return -1
      return Math.max(...peaksForRange(wave, 0, 1_500_000, 16))
    })
    assert(peak > 0.01, `recorded sound is silent or has no waveform (peak ${peak})`)
  })
  await check('screen: the switch choice is remembered', async () => {
    await page.getByRole('button', { name: 'Record again', exact: true }).click()
    await micSwitch(page).uncheck()
    await page.reload()
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    assert(!(await micSwitch(page).isChecked()), 'switch is on again after reload')
    await micSwitch(page).check()
  })
  await context.close()
}
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('screen with the voice switched off: no microphone is requested and the file has no audio', async () => {
    const before = await assetIds(page)
    await micSwitch(page).uncheck()
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => ({
      audio: window.__recStreams.at(-1).getAudioTracks().length,
      gum: window.__gumCalls
    }))
    assert(info.audio === 0 && info.gum === 0, `audio tracks ${info.audio}, getUserMedia calls ${info.gum}`)
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.hasAudio !== true, 'clip has audio although the switch was off')
  })
  await context.close()
}
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('screen with a refused microphone: records anyway and shows a calm notice', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__mode = 'deny'))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    const notice = page.locator('[data-role="mic-notice"]')
    await notice.waitFor()
    assert(/Recorded without microphone: access was not allowed/.test(await notice.textContent()), 'notice text')
    assert((await page.getByRole('alert').count()) === 0, 'an alert blocks the recording')
    await page.waitForTimeout(1500)
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.kind === 'video', 'no video asset')
    assert((await page.locator('[data-role="mic-notice"]').count()) === 1, 'notice vanished after recording')
  })
  await context.close()
}

// ---------- diagnostics after a failed recording ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('an empty/failed screen recording offers collapsed technical details with a copy button', async () => {
    await page.evaluate(() => (window.__garbage = true))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1200)
    await stopButton(page).click()
    await page.getByRole('alert').waitFor({ timeout: 20000 })
    const details = page.locator('[data-role="record-details"]')
    assert((await details.count()) === 1, 'no details box')
    assert(!(await details.evaluate((d) => d.open)), 'details are not collapsed')
    await details.locator('summary').click()
    const text = await details.locator('textarea').inputValue()
    assert(/Chunks:/.test(text) && /Events:/.test(text) && /timer=/.test(text), `details text: ${text.slice(0, 200)}`)
    assert(!/localhost|http/.test(text.replace(/Mozilla[^\n]*/, '')), 'details contain an address')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` }).catch(() => undefined)
    await details.getByRole('button', { name: 'Copy', exact: true }).click()
    await details.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 3000 })
  })
  await context.close()
}

// ---------- Firefox-like failures: recorder without 'stop' event, duration-less files, unreadable output ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('screen: a recorder that never fires stop still ends the share at once and yields the clip', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__silentStop = true))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(2000)
    await stopButton(page).click()
    // Tracks are stopped after the bounded wait for the recorder (4 s), never before its last data.
    await waitUntil(() => tracksEnded(page), 8000, 'tracks were not stopped after the wait for the recorder')
    await addButton(page).waitFor({ timeout: 20000 })
    const proj = await project(page)
    const asset = proj.assets.find((a) => !before.includes(a.id) && NAME_PATTERN.screen.test(a.name))
    assert(asset && asset.kind === 'video', 'no screen asset')
    assert(near(asset.duration / 1e6, 2, 1), `duration ${(asset.duration / 1e6).toFixed(2)} s`)
    await page.evaluate(() => (window.__silentStop = false))
  })
  await context.close()
}
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('screen: unreadable recorder output ends in an error with a raw download, tracks ended', async () => {
    await page.evaluate(() => (window.__garbage = true))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1500)
    await stopButton(page).click()
    const alert = page.getByRole('alert')
    await alert.waitFor({ timeout: 20000 })
    assert(await tracksEnded(page), 'screen tracks are still live after a failed import')
    const save = page.getByRole('button', { name: 'Save recording as a file', exact: true })
    await save.waitFor()
    const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
    assert(/^Screen .*\.webm$/.test(download.suggestedFilename()), `download name ${download.suggestedFilename()}`)
    assert((await recState(page)).phase === 'error', 'phase is not error')
  })
  await context.close()
}
{
  const dir = join(SHOT_DIR, 'record-fixtures')
  mkdirSync(dir, { recursive: true })
  // -live 1 writes WebM like a browser's MediaRecorder: no Duration, no Cues. liveVfr drops frames (variable timing).
  const live = join(dir, 'live.webm')
  const liveVideo = join(dir, 'live-video.webm')
  const liveVfr = join(dir, 'live-vfr.webm')
  const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' })
  const src = ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15']
  ff(...src, '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libvpx', '-c:a', 'libopus', '-f', 'webm', '-live', '1', live)
  ff(...src, '-t', '2', '-c:v', 'libvpx', '-f', 'webm', '-live', '1', liveVideo)
  ff(...src, '-vf', "select='not(mod(n,3))+gt(random(0),0.6)'", '-fps_mode', 'vfr', '-t', '2', '-c:v', 'libvpx', '-f', 'webm', '-live', '1', liveVfr)
  const { page, context } = await freshPage({ scheme: 'light' })
  for (const [label, path] of [['audio+video', live], ['video only', liveVideo], ['variable frame timing', liveVfr]]) {
    await check(`import of a duration-less WebM (${label}) finishes with a computed duration and a thumbnail`, async () => {
      const bytes = readFileSync(path).toString('base64')
      const t0 = Date.now()
      const result = await page.evaluate(async ([b64, name]) => {
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const file = new File([raw], name, { type: 'video/webm' })
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        await pinia._s.get('media').importFiles([file])
        const asset = pinia.state.value.editor.history.present.assets.find((a) => a.name === name)
        return {
          asset,
          status: asset && pinia.state.value.media.status[asset.id],
          thumb: !!(asset && pinia.state.value.media.thumbnails[asset.id])
        }
      }, [bytes, `${label}.webm`])
      assert(Date.now() - t0 < 10000, `import took ${Date.now() - t0} ms`)
      assert(result.asset && result.status === 'ready', `status ${result.status}`)
      assert(near(result.asset.duration / 1e6, 2, 0.5), `duration ${result.asset.duration / 1e6}`)
      assert(result.thumb, 'no thumbnail')
    })
  }
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
