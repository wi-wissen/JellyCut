// End-to-end check of the Record tab in a real browser with fake devices: microphone, camera and screen
// recordings land in the library, pause/resume, cancel, permission and device errors, hidden screen button,
// the level meter, the microphone picker and test, track cleanup, shortcut guard, beforeunload, the self-healing
// decisions (silent microphone, black screen, suspended audio context, remembered fallback), and checks on the FINAL
// file (sound level and picture brightness decoded in the page), its playback flags and its export mix.
// Usage: node scripts/e2e-record.mjs            (Chromium; env SHOT_DIR overrides the screenshot folder)
//        BROWSER=firefox node scripts/e2e-record.mjs   (Firefox with fake devices, if installed)
// Browsers cannot show the screen picker headless, so the screen source is a stub stream (see mediaStubs).
import { chromium, firefox } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 5183)
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'

const BROWSER = process.env.BROWSER === 'firefox' ? 'firefox' : 'chromium'
const outcomes = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  try {
    await fn()
    outcomes.push(true)
    console.log(`PASS ${name}`)
  } catch (e) {
    outcomes.push(false)
    console.log(`FAIL ${name}: ${process.env.E2E_VERBOSE ? e.message : String(e.message).split('\n')[0]}`)
  }
}

/** The recording alert; Firefox without WebGL2 (CI sandboxes) also shows the preview's own alert. */
const alertOf = (page) => page.locator('[role="alert"]').filter({ hasNotText: 'WebGL is missing' })

function skip(name, reason) {
  outcomes.push(true)
  console.log(`SKIP ${name} (${reason})`)
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
  window.__gumConstraints = []
  md.getUserMedia = async (constraints) => {
    window.__gumCalls++
    window.__gumConstraints.push(JSON.parse(JSON.stringify(constraints)))
    if (window.__mode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError')
    if (window.__mode === 'missing') throw new DOMException('Requested device not found', 'NotFoundError')
    let stream = await realGetUserMedia(constraints)
    if (window.__silentMic && constraints.audio && !constraints.video) {
      // A microphone that delivers digital silence (muted or wrong device).
      stream.getTracks().forEach((track) => track.stop())
      const ctx = new RealAudioContext()
      const dest = ctx.createMediaStreamDestination()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.connect(gain).connect(dest)
      osc.start()
      stream = dest.stream
    }
    window.__streams.push(stream)
    return stream
  }

  // Media elements the preview creates are detached from the page; keep a list so the test can look at them.
  window.__mediaEls = []
  const realCreate = document.createElement.bind(document)
  document.createElement = (name, ...rest) => {
    const el = realCreate(name, ...rest)
    if (name === 'video' || name === 'audio') window.__mediaEls.push(el)
    return el
  }

  // The app's AudioContext can be made to stay suspended, like Firefox does when no click started it.
  const RealAudioContext = window.AudioContext
  window.__realAudioContext = RealAudioContext
  window.AudioContext = class extends RealAudioContext {
    get state() {
      return window.__suspendApp ? 'suspended' : super.state
    }
    resume() {
      return window.__suspendApp ? new Promise(() => undefined) : super.resume()
    }
  }

  if (opts.noDisplay) {
    Object.defineProperty(md, 'getDisplayMedia', { value: undefined, configurable: true })
  } else {
    md.getDisplayMedia = async () => {
      const mode = window.__displayMode ?? 'moving'
      let stream
      if (mode === 'still') {
        // A window that does not change: one frame at the start, then nothing.
        const still = document.createElement('canvas')
        still.width = 800
        still.height = 450
        const sctx = still.getContext('2d')
        sctx.fillStyle = '#2d6a4f'
        sctx.fillRect(0, 0, 800, 450)
        stream = still.captureStream(0)
        const track = stream.getVideoTracks()[0]
        ;(track.requestFrame ? track : stream).requestFrame()
      } else if (mode === 'frozen') {
        // A share that never delivers a picture.
        const dead = document.createElement('canvas')
        dead.width = 640
        dead.height = 360
        dead.getContext('2d')
        stream = dead.captureStream(0)
      } else {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        const ctx = canvas.getContext('2d')
        let frame = 0
        setInterval(() => {
          ctx.fillStyle = mode === 'black' ? '#000' : `hsl(${(frame++ * 12) % 360} 70% 45%)`
          ctx.fillRect(0, 0, 640, 360)
        }, 67)
        stream = canvas.captureStream(15)
      }
      if (window.__systemAudio) {
        const ctx = new RealAudioContext()
        const dest = ctx.createMediaStreamDestination()
        const osc = ctx.createOscillator()
        osc.frequency.value = 330
        osc.connect(dest)
        osc.start()
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))])
        stream.addTrack(dest.stream.getAudioTracks()[0])
      }
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
const browser =
  BROWSER === 'firefox'
    ? await firefox.launch({
        firefoxUserPrefs: {
          'media.navigator.streams.fake': true,
          'media.navigator.permission.disabled': true,
          'media.autoplay.default': 0,
          'media.autoplay.blocking_policy': 0
        }
      })
    : await chromium.launch({
        executablePath: findChromium(),
        args: [
          '--no-sandbox',
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          '--autoplay-policy=no-user-gesture-required'
        ]
      })
mkdirSync(SHOT_DIR, { recursive: true })

// A sandbox without a sound device leaves every AudioContext suspended (seen in headless Firefox): the checks that
// need a running context are skipped there, the self-healing path for exactly that case is tested everywhere.
const CTX_RUNS = await (async () => {
  const probe = await browser.newPage()
  try {
    await probe.goto(`http://localhost:${PORT}/`)
    return await probe.evaluate(async () => {
      const ctx = new AudioContext()
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1500))])
      return ctx.state === 'running'
    })
  } finally {
    await probe.close()
  }
})()
console.log(`AudioContext can run in this browser: ${CTX_RUNS}`)
const checkWithContext = (name, fn) => (CTX_RUNS ? check(name, fn) : skip(name, 'AudioContext stays suspended in this environment'))

const pageErrors = []

async function freshPage({ scheme = 'light', stubs = {}, init = null } = {}) {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1120, height: 700 },
    colorScheme: scheme
  })
  await context.addInitScript(mediaStubs, stubs)
  if (init) await context.addInitScript(init)
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
    const alert = await alertOf(page).textContent().catch(() => '')
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
    if (CTX_RUNS) assert(peak > 0.01, `level meter did not move (peak ${peak.toFixed(4)})`)

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
    const alert = alertOf(page)
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
    const alert = alertOf(page)
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
  await (BROWSER === 'chromium' ? check : (n) => skip(n, 'Firefox ignores a synthetic ended event on a track'))('screen: the browser stop-sharing button finishes the recording as a normal asset', async () => {
    const before = await assetIds(page)
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1200)
    await page.evaluate(() => {
      const track = window.__streams.findLast((s) => s.getVideoTracks().length > 0).getVideoTracks()[0]
      track.dispatchEvent(new Event('ended'))
    })
    await addButton(page).waitFor({ timeout: 15000 }).catch(async () => {
      const s = await page.evaluate(() => { const r = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.record; return `${r.phase} ${r.errorKey} ${r.diagnosticsText}` })
      throw new Error(`no "Add to timeline"; alert: "${await alertOf(page).textContent().catch(() => '')}"; state: ${s}`)
    })
    const proj = await project(page)
    const asset = proj.assets.find((a) => !before.includes(a.id) && NAME_PATTERN.screen.test(a.name))
    assert(asset, `no screen asset; names: ${proj.assets.map((a) => a.name).join(', ')}`)
    assert(asset.kind === 'video' && asset.width > 0, `screen asset ${asset.kind} ${asset.width}`)
    assert(await tracksEnded(page), 'screen tracks are still live after the browser ended the share')
  })
  await context.close()
}

// ---------- helpers for the checks on the final file ----------
/** Measures the last recording the way the editor reads it: decodes sound and pictures of the recorded file. */
const fileCheck = (page) =>
  page.evaluate(async () => {
    const { checkRecording } = await import('/src/engine/record/postCheck.ts')
    return checkRecording(new File(window.__recBlobs, 'rec.webm', { type: 'video/webm' }))
  })

/** Which source tracks reached the MediaRecorder: the display / microphone tracks themselves, or something else. */
const recordedSources = (page) =>
  page.evaluate(() => {
    const rec = window.__recStreams.at(-1)
    const ids = (streams) => streams.flatMap((s) => s.getTracks().map((t) => t.id))
    const displayVideo = ids(window.__streams.filter((s) => s.getVideoTracks().length > 0))
    const micAudio = ids(window.__streams.filter((s) => s.getVideoTracks().length === 0))
    const video = rec.getVideoTracks().map((t) => t.id)
    const audio = rec.getAudioTracks().map((t) => t.id)
    return {
      video: video.length,
      audio: audio.length,
      videoIsDisplayTrack: video.length === 1 && displayVideo.includes(video[0]),
      audioIsMicTrack: audio.length === 1 && micAudio.includes(audio[0])
    }
  })

/** Strength of one frequency (Goertzel) in the first seconds of the last recording's sound. */
const toneStrength = (page, freq) =>
  page.evaluate(async (hz) => {
    const { ALL_FORMATS, Input, BlobSource, AudioSampleSink } = await import('/tests/helpers/mediabunny.ts')
    const input = new Input({ source: new BlobSource(new File(window.__recBlobs, 'rec.webm')), formats: ALL_FORMATS })
    const track = await input.getPrimaryAudioTrack()
    if (!track) return -1
    const chunks = []
    let rate = 48000
    for await (const s of new AudioSampleSink(track).samples(0.3, 2.3)) {
      const a = new Float32Array(s.numberOfFrames)
      s.copyTo(a, { planeIndex: 0, format: 'f32-planar' })
      chunks.push(a)
      rate = s.sampleRate
      s.close()
    }
    input.dispose()
    const n = chunks.reduce((sum, c) => sum + c.length, 0)
    const all = new Float32Array(n)
    let o = 0
    for (const c of chunks) {
      all.set(c, o)
      o += c.length
    }
    const w = (2 * Math.PI * hz) / rate
    const coeff = 2 * Math.cos(w)
    let s1 = 0
    let s2 = 0
    for (let i = 0; i < n; i++) {
      const s = all[i] + coeff * s1 - s2
      s2 = s1
      s1 = s
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (n / 2)
  }, freq)

const detailsText = async (page) => {
  const details = page.locator('[data-role="record-details"]')
  if (!(await details.evaluate((d) => d.open))) await details.locator('summary').click()
  return details.locator('textarea').inputValue()
}
/** The level test starts by itself where the permission is already granted; otherwise it needs the button. */
async function ensureMicTest(page) {
  await page.locator('[data-role="mic-test"]').waitFor()
  await page.waitForTimeout(600)
  const button = page.locator('[data-role="mic-test"]')
  if (/^Test microphone$/.test((await button.textContent()).trim())) await button.click()
  await page.getByText('Say something: the bar has to move.').waitFor({ timeout: 8000 })
}
const micPicker = (page) => page.locator('[data-role="mic-picker"]')
const memory = (page) => page.evaluate(() => localStorage.getItem('jellycut.record.strategy'))

// ---------- the microphone picker and the test before recording ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  await check('the voice switch is gone; a compact microphone picker with a test button is shown (44 px targets)', async () => {
    const text = await bodyText(page)
    assert(!/Record my voice/.test(text), 'the old voice switch text is still shown')
    assert((await page.locator('[data-role="mic-switch"]').count()) === 0, 'the voice switch still exists')
    await micPicker(page).waitFor()
    for (const selector of ['[data-role="mic-select"]', '[data-role="mic-test"]']) {
      const box = await page.locator(selector).boundingBox()
      assert(box && box.height >= 44, `${selector} height ${box?.height}`)
    }
    assert(await page.locator('label[for="record-mic-select"]').count() === 1, 'the select has no label')
  })
  await check('"Test microphone" shows a live level before recording, lists the devices and marks the default', async () => {
    await ensureMicTest(page)
    let peak = 0
    if (CTX_RUNS) {
      await waitUntil(
        async () => {
          const level = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.record.testLevel)
          peak = Math.max(peak, level)
          return peak > 0.01
        },
        9000,
        'the test level never moved'
      )
    }
    const options = await page.locator('[data-role="mic-select"] option').allTextContents()
    assert(options.length >= 1 && options.every((o) => o.trim() !== ''), `options ${JSON.stringify(options)}`)
    assert(options.filter((o) => /\(default\)/.test(o)).length === 1, `default marked ${options.filter((o) => /\(default\)/.test(o)).length} times: ${JSON.stringify(options)}`)
    assert(options.every((o) => !/^Default - /.test(o)), 'a browser "Default - " prefix is shown')
  })
  await check('the chosen microphone is remembered, survives a reload and is opened by its exact id', async () => {
    const select = page.locator('[data-role="mic-select"]')
    const values = await select.locator('option').evaluateAll((os) => os.map((o) => o.value))
    if (values.length < 2) return console.log(`  (only ${values.length} microphone in this browser: nothing to choose)`)
    const target = values[1]
    await select.selectOption(target)
    assert((await page.evaluate(() => localStorage.getItem('jellycut.record.microphoneDevice'))) === target, 'choice not stored')
    await page.reload()
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await waitUntil(async () => (await select.inputValue().catch(() => '')) === target, 6000, 'the choice was not restored after a reload')
    await page.evaluate(() => (window.__gumConstraints.length = 0))
    const before = await assetIds(page)
    await sourceButton(page, 'microphone').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(1200)
    await stopAndWaitForAsset(page, 'microphone', before)
    const used = await page.evaluate(() => window.__gumConstraints.map((c) => c.audio?.deviceId?.exact ?? null))
    assert(used.includes(target), `getUserMedia device ids ${JSON.stringify(used)}`)
  })
  await check('a remembered microphone that is no longer there falls back to the default', async () => {
    await page.evaluate(() => localStorage.setItem('jellycut.record.microphoneDevice', 'unplugged-device'))
    await page.reload()
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    const select = page.locator('[data-role="mic-select"]')
    const first = (await select.locator('option').evaluateAll((os) => os.map((o) => o.value)))[0]
    await waitUntil(async () => (await select.inputValue().catch(() => '')) === first, 6000, 'did not fall back to the default microphone')
  })
  await check('starting a recording closes the test and it records', async () => {
    await sourceButton(page, 'microphone').click()
    await stopButton(page).waitFor()
    assert((await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.record.micTest)) === 'off', 'test still on')
    await page.waitForTimeout(1200)
    await stopAndWaitForAsset(page, 'microphone', await assetIds(page))
  })
  await context.close()
}
{
  const { page, context } = await freshPage({ scheme: 'light', init: 'window.__silentMic = true' })
  await checkWithContext('a silent microphone shows the calm "no signal" warning in the test after 3 s', async () => {
    await ensureMicTest(page)
    await page.locator('[data-role="mic-warning"]').waitFor({ timeout: 8000 })
    const text = await page.locator('[data-role="mic-warning"]').textContent()
    assert(/No microphone signal: check the input device in the Windows or Mac settings/.test(text), text)
    await page.locator('[data-role="mic-test"]').click()
  })
  await checkWithContext('screen + silent microphone: warning while recording, "no sound" finding on the clip, details show the measurements', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    const warning = page.locator('[data-role="record-warning"]')
    await warning.waitFor({ timeout: 8000 })
    assert(/No microphone signal/.test(await warning.first().textContent()), 'warning text')
    await page.waitForTimeout(500)
    await stopAndWaitForAsset(page, 'screen', before)
    const check1 = page.locator('[data-role="record-check"]')
    await check1.waitFor()
    assert(/No sound can be heard in this recording/.test(await check1.first().textContent()), 'finding text')
    const text = await detailsText(page)
    assert(/Mic level: min=0\.0000 max=0\.0000/.test(text), `details: ${text.split('\n').filter((l) => /Mic level|File check/.test(l)).join(' | ')}`)
    assert(/no-signal warning=yes/.test(text) && /File check: audio track=yes peak=0\.0000/.test(text), 'details miss the file check')
  })
  await context.close()
}

// ---------- screen + voice: the tracks are recorded directly, the final file is audible and bright ----------
{
  const { page, context } = await freshPage({ scheme: 'light' })
  let assetName = ''
  await check('screen + voice: the microphone is always requested, picture and sound tracks are recorded as they are', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(2500)
    assert((await page.locator('[data-role="mic-level"]').count()) === 1, 'no level meter for screen + voice')
    assert((await page.locator('[data-role="record-warning"]').count()) === 0, 'a warning is shown for a healthy recording')
    const constraints = await page.evaluate(() => window.__gumConstraints)
    assert(constraints.some((c) => c.audio && !c.video), 'the microphone was not requested')
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assetName = asset.name
    assert(asset.hasAudio === true, `hasAudio ${asset.hasAudio}`)
    assert(asset.duration / 1e6 >= 1.5, `duration ${(asset.duration / 1e6).toFixed(2)} s`)
    assert(await tracksEnded(page), 'tracks (screen and microphone) still live after stop')
    const src = await recordedSources(page)
    assert(src.video === 1 && src.audio === 1, `recorded tracks ${JSON.stringify(src)}`)
    assert(src.videoIsDisplayTrack, 'the screen picture was not recorded directly')
    assert(src.audioIsMicTrack, 'the sound is not the microphone track itself (Web Audio in between)')
  })
  await check('screen + voice: the FINAL FILE has audible sound and a bright picture; no warnings, no Web Audio mix', async () => {
    const c = await fileCheck(page)
    assert(c && c.hasAudioTrack && c.hasVideoTrack, `file check ${JSON.stringify(c)}`)
    assert(c.audioPeak > 0.05 && c.audioRms > 0.003, `sound peak ${c.audioPeak} rms ${c.audioRms}`)
    assert(c.frameLuma.length > 0 && Math.max(...c.frameLuma) > 20, `frame luma ${c.frameLuma}`)
    assert((await page.locator('[data-role="record-check"]').count()) === 0, 'a finding is shown for a healthy file')
    const text = await detailsText(page)
    assert(/Audio path: microphone/.test(text) && /Video path: raw \(default\), problem=none/.test(text), text.split('\n').filter((l) => /path/.test(l)).join(' | '))
    assert(/File check: audio track=yes/.test(text), 'details miss the file check')
    if (CTX_RUNS) assert(/Mic level: min=/.test(text), 'details miss the microphone level')
  })
  await (BROWSER === 'chromium' ? check : (n) => skip(n, 'the editor preview needs WebGL2, missing in this Firefox sandbox'))('playback: the clip is unmuted at full volume and its element decodes sound; the export mix contains it', async () => {
    await addButton(page).click()
    await waitUntil(async () => (await project(page)).clips.some((c) => c.assetId), 5000, 'no clip was added')
    const clip = (await project(page)).clips.at(-1)
    assert(clip.muted === false && clip.volume === 1, `clip muted=${clip.muted} volume=${clip.volume}`)
    await page.evaluate(() => {
      const editor = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor')
      editor.seek?.(0)
      if (!editor.isPlaying) editor.togglePlaying()
    })
    await waitUntil(
      () => page.evaluate(() => window.__mediaEls.some((el) => el.src.startsWith('blob:') && !el.paused && el.currentTime > 0.3)),
      8000,
      'no preview element is playing the clip'
    )
    const el = await page.evaluate(() => {
      const e = window.__mediaEls.find((x) => x.src.startsWith('blob:') && !x.paused)
      return { muted: e.muted, volume: e.volume, decoded: e.webkitAudioDecodedByteCount ?? null }
    })
    assert(el.muted === false && el.volume === 1, `element muted=${el.muted} volume=${el.volume}`)
    if (BROWSER === 'chromium') assert(el.decoded > 0, `the element decoded ${el.decoded} bytes of sound`)
    await page.evaluate(() => {
      const editor = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor')
      if (editor.isPlaying) editor.togglePlaying()
    })

    const exported = await page.evaluate(async (name) => {
      const { runExport } = await import('/src/engine/export/exporter.ts')
      const { ALL_FORMATS, Input, BlobSource, AudioSampleSink } = await import('/tests/helpers/mediabunny.ts')
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const proj = JSON.parse(JSON.stringify(pinia.state.value.editor.history.present))
      const asset = proj.assets.find((a) => a.name === name)
      const file = new File(window.__recBlobs, name, { type: 'video/webm' })
      const res = await runExport({ project: proj, files: { [asset.id]: file }, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, () => undefined, new AbortController().signal)
      const input = new Input({ source: new BlobSource(res.blob), formats: ALL_FORMATS })
      const track = await input.getPrimaryAudioTrack()
      let peak = 0
      if (track) {
        for await (const s of new AudioSampleSink(track).samples(0.2, 2)) {
          const a = new Float32Array(s.numberOfFrames)
          s.copyTo(a, { planeIndex: 0, format: 'f32-planar' })
          for (const v of a) peak = Math.max(peak, Math.abs(v))
          s.close()
        }
      }
      input.dispose()
      return { audio: !!track, peak }
    }, assetName)
    assert(exported.audio && exported.peak > 0.02, `exported sound ${JSON.stringify(exported)}`)
  })
  await context.close()
}

// ---------- screen with the share's own sound: mixed through Web Audio ----------
{
  const { page, context } = await freshPage({ scheme: 'light', init: 'window.__systemAudio = true' })
  await checkWithContext('screen with share sound: voice and share sound are mixed (running context), the file carries both', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(3000)
    await stopAndWaitForAsset(page, 'screen', before)
    const src = await recordedSources(page)
    assert(src.audio === 1 && !src.audioIsMicTrack, `audio track ${JSON.stringify(src)}`)
    const c = await fileCheck(page)
    assert(c.audioPeak > 0.05, `mixed sound peak ${c.audioPeak}`)
    const share = await toneStrength(page, 330)
    assert(share > 0.02, `the share's 330 Hz tone is missing in the file (${share})`)
    const text = await detailsText(page)
    assert(/Audio path: mix/.test(text) && /AudioContext: running@/.test(text), text.split('\n').filter((l) => /Audio/.test(l)).join(' | '))
  })
  await context.close()
}
{
  const { page, context } = await freshPage({ scheme: 'light', init: 'window.__systemAudio = true; window.__suspendApp = true' })
  await check('screen with share sound and a context that stays suspended (Firefox case): falls back to the voice alone, file still audible', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor({ timeout: 8000 })
    await page.waitForTimeout(4200)
    assert((await page.locator('[data-role="record-warning"]').count()) === 0, 'a suspended context raised a false "no microphone signal"')
    await stopAndWaitForAsset(page, 'screen', before)
    const src = await recordedSources(page)
    assert(src.audioIsMicTrack, `the voice was not recorded directly: ${JSON.stringify(src)}`)
    const c = await fileCheck(page)
    assert(c.audioPeak > 0.05, `sound peak ${c.audioPeak}`)
    const notice = page.locator('[data-role="record-notice"]')
    assert(/sound of the shared screen could not be recorded/.test(await notice.first().textContent()), 'no notice about the dropped share sound')
    assert(/suspended@0/.test(await detailsText(page)), 'context states missing in the details')
  })
  await context.close()
}

// ---------- still content: the direct way, and the canvas way as the remembered fallback ----------
{
  const { page, context } = await freshPage({ scheme: 'light', init: "window.__displayMode = 'still'" })
  await check('a still share recorded directly keeps its length and a visible picture', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(2500)
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.kind === 'video' && asset.width > 0, `screen asset ${asset.kind} ${asset.width}`)
    assert(asset.width % 2 === 0 && asset.height % 2 === 0, `odd size ${asset.width}x${asset.height}`)
    assert(asset.duration / 1e6 >= 1.5, `still screen clip lasts ${(asset.duration / 1e6).toFixed(2)} s, expected >= 1.5`)
    assert((await recordedSources(page)).videoIsDisplayTrack, 'the still share was not recorded directly')
    const c = await fileCheck(page)
    assert(c.frameLuma.length > 0 && Math.max(...c.frameLuma) > 20, `frame luma ${c.frameLuma}`)
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
{
  const remember = `localStorage.setItem('jellycut.record.strategy', JSON.stringify({ strategy: 'canvas', lastProblem: 'black' }))`
  const { page, context } = await freshPage({ scheme: 'light', init: `window.__displayMode = 'still'; ${remember}` })
  await check('the remembered canvas way records a still share through the canvas with a visible picture', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(2500)
    const asset = await stopAndWaitForAsset(page, 'screen', before)
    assert(asset.duration / 1e6 >= 1.5, `still screen clip lasts ${(asset.duration / 1e6).toFixed(2)} s`)
    const src = await recordedSources(page)
    assert(src.video === 1 && !src.videoIsDisplayTrack, 'the canvas way was not used')
    const c = await fileCheck(page)
    assert(c.frameLuma.length > 0 && Math.max(...c.frameLuma) > 20, `frame luma ${c.frameLuma}`)
    assert(/Video path: canvas \(remembered after black\)/.test(await detailsText(page)), 'details miss the canvas path')
  })
  await context.close()
}

// ---------- a black share: warning, finding, and the next recording switches the way ----------
{
  const { page, context } = await freshPage({ scheme: 'light', init: "window.__displayMode = 'black'" })
  await check('black share: warns while recording, flags the clip, remembers the canvas way and tells the user', async () => {
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    const warning = page.locator('[data-role="record-warning"]')
    await warning.first().waitFor({ timeout: 9000 })
    const text = await warning.allTextContents()
    assert(text.some((x) => /The screen is recorded black/.test(x)), `warnings: ${text}`)
    await stopAndWaitForAsset(page, 'screen', before)
    assert(/The picture of this recording is black/.test(await page.locator('[data-role="record-check"]').first().textContent()), 'no black finding')
    assert(/another way to record the picture/.test(await page.locator('[data-role="record-notice"]').first().textContent()), 'no notice about the other way')
    const m = JSON.parse(await memory(page))
    assert(m.strategy === 'canvas' && m.lastProblem === 'black', `memory ${JSON.stringify(m)}`)
    const details = await detailsText(page)
    assert(/problem=black/.test(details) && /Picture luma: min=/.test(details) && /frame luma=\[/.test(details), 'details miss the black measurements')
  })
  await check('the next screen recording uses the canvas way; a second black result does not flip back', async () => {
    await page.getByRole('button', { name: 'Record again', exact: true }).click()
    const before = await assetIds(page)
    await page.evaluate(() => (window.__recBlobs.length = 0))
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    await page.waitForTimeout(4500)
    await stopAndWaitForAsset(page, 'screen', before)
    const src = await recordedSources(page)
    assert(!src.videoIsDisplayTrack, 'the direct way was used again')
    assert(/Video path: canvas/.test(await detailsText(page)), 'details miss the canvas path')
    const m = JSON.parse(await memory(page))
    assert(m.strategy === 'canvas', `memory flipped to ${m.strategy}`)
  })
  await context.close()
}
{
  const { page, context } = await freshPage({ scheme: 'light', init: "window.__displayMode = 'frozen'" })
  await check('a share that delivers no picture: warning after 3 s and the canvas way is remembered', async () => {
    await sourceButton(page, 'screen').click()
    await stopButton(page).waitFor()
    const warning = page.locator('[data-role="record-warning"]')
    await warning.first().waitFor({ timeout: 9000 })
    assert(/delivers no picture/.test(await warning.first().textContent()), 'warning text')
    await stopButton(page).click()
    await page.locator('[data-role="record-details"]').waitFor({ timeout: 20000 })
    const m = JSON.parse(await memory(page))
    assert(m.strategy === 'canvas' && m.lastProblem === 'noFrames', `memory ${JSON.stringify(m)}`)
  })
  await context.close()
}

// ---------- screen with a refused microphone ----------
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
    assert((await alertOf(page).count()) === 0, 'an alert blocks the recording')
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
    await alertOf(page).waitFor({ timeout: 20000 })
    const details = page.locator('[data-role="record-details"]')
    assert((await details.count()) === 1, 'no details box')
    assert(!(await details.evaluate((d) => d.open)), 'details are not collapsed')
    await details.locator('summary').click()
    const text = await details.locator('textarea').inputValue()
    assert(/Chunks:/.test(text) && /Events:/.test(text) && /Video path: raw/.test(text), `details text: ${text.slice(0, 200)}`)
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
    const alert = alertOf(page)
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
