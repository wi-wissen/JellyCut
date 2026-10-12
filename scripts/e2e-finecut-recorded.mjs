// Fine cut and recording optimisation for a LONG recorded clip (MediaRecorder WebM: no cues, one cluster per second,
// a single keyframe at the start). The clip is recorded at test time in the page from a canvas stream with a 1 s
// timeslice (the structure that made the fine cut slow) and cached outside the repository.
// Checks: fine cut usable fast, bounded caches, optimisation (dense keyframes, same length and picture, progress, skip).
// Usage: node scripts/e2e-finecut-recorded.mjs     (Chromium; REGEN=1 records the clip again; SECONDS=30)
// Port 5440. Exit code 1 when a check fails.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5440
const BASE = `http://localhost:${PORT}`
const SECONDS = Number(process.env.SECONDS ?? 30)
const LONG_FILE = join(tmpdir(), `jellycut-long-sparse-${process.env.CODEC ?? 'vp8'}-${SECONDS}s.webm`)
const USABLE_MS = 3000

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' :: ' + detail}`)
  if (!ok) failed++
}
const info = (text) => console.log(`INFO ${text}`)

const server = await createServer({ server: { port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const errors = []
let context = null
let page = null

async function freshPage(url) {
  await context?.close()
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en' })
  // The picker would open a native dialog; without it the download path is used.
  await context.addInitScript(() => {
    delete window.showSaveFilePicker
    delete window.showOpenFilePicker
    delete window.showDirectoryPicker
  })
  page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text())
    if (process.env.E2E_VERBOSE) console.log('[page]', m.type(), m.text())
  })
  await page.goto(url)
}

/** Records the long clip: a 1280 x 720 canvas with a brightness ramp (for picture checks) and a tone, 1 s timeslice. */
async function recordLongClip() {
  await freshPage("about:blank")
  const base64 = await page.evaluate(async ({ seconds, codecs }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    const started = performance.now()
    const draw = () => {
      const t = (performance.now() - started) / 1000
      const grey = Math.round(60 + (t / seconds) * 140)
      ctx.fillStyle = `rgb(${grey},${grey},${grey})`
      ctx.fillRect(0, 0, 1280, 720)
      ctx.fillStyle = '#e03a3a'
      ctx.fillRect(((t * 160) % 1100) + 20, 200, 120, 120)
      ctx.fillStyle = '#2a7fd4'
      ctx.fillRect(40, ((t * 90) % 560) + 20, 90, 90)
      ctx.fillStyle = '#000'
      ctx.font = '64px sans-serif'
      ctx.fillText(t.toFixed(2), 500, 600)
    }
    const stream = canvas.captureStream(0)
    const videoTrack = stream.getVideoTracks()[0]
    // One drawn and pushed picture per 1/30 s; the recorder gets a steady 30 fps like a real screen share.
    const push = () => {
      draw()
      videoTrack.requestFrame()
    }
    push()
    const timer = setInterval(push, 1000 / 30)
    const audio = new AudioContext()
    const osc = audio.createOscillator()
    const dest = audio.createMediaStreamDestination()
    osc.frequency.value = 330
    osc.connect(dest)
    osc.start()
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track)
    const mime = codecs.find((m) => MediaRecorder.isTypeSupported(m))
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
    const chunks = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise((resolve) => (recorder.onstop = resolve))
    recorder.start(1000)
    await new Promise((r) => setTimeout(r, seconds * 1000))
    recorder.stop()
    await done
    clearInterval(timer)
    osc.stop()
    await audio.close()
    const blob = new Blob(chunks, { type: 'video/webm' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  }, { seconds: SECONDS, codecs: [`video/webm;codecs=${process.env.CODEC ?? 'vp8'},opus`, 'video/webm'] })
  const { bytes, cleared } = keepFirstKeyframeOnly(Buffer.from(base64, 'base64'))
  info(`turned ${cleared} later keyframes into delta frames`)
  writeFileSync(LONG_FILE, bytes)
}

/**
 * Chromium's encoder adds a keyframe about every 3.3 s; Firefox writes a single one. Chromium writes every frame as a
 * BlockGroup and marks a delta frame with a ReferenceBlock, so this adds one to every video key group but the first.
 * The pictures stay decodable: forward decoding from the first keyframe never needed the others. Returns the new
 * file and how many keyframes were turned into delta frames.
 */
function keepFirstKeyframeOnly(buffer) {
  const enter = new Set([0x18538067, 0x1f43b675])
  const groups = []
  let pos = 0
  const vint = (keepMarker) => {
    const first = buffer[pos]
    let length = 1
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
    let value = keepMarker ? first : first & (0xff >> length)
    for (let i = 1; i < length; i++) value = value * 256 + buffer[pos + i]
    pos += length
    return { value, length }
  }
  while (pos < buffer.length) {
    const id = vint(true).value
    const sizeAt = pos
    const size = vint(false)
    if (enter.has(id)) continue
    if (id === 0xa0 && size.value < 2 ** (7 * size.length) - 1) {
      const end = pos + size.value
      let track = 0
      let delta = false
      const body = pos
      while (pos < end) {
        const child = vint(true).value
        const childSize = vint(false)
        if (child === 0xa1) {
          const save = pos
          track = vint(false).value
          pos = save
        }
        if (child === 0xfb) delta = true
        pos += childSize.value
      }
      groups.push({ sizeAt, sizeLength: size.length, size: size.value, body, end, track, delta })
      pos = end
      continue
    }
    pos += size.value
  }
  const videoTrack = groups.find((g) => g.delta)?.track
  const keys = groups.filter((g) => g.track === videoTrack && !g.delta)
  const pieces = []
  let copied = 0
  let cleared = 0
  for (const g of keys.slice(1)) {
    if (g.size + 3 >= 2 ** (7 * g.sizeLength) - 1) continue
    cleared++
    pieces.push(buffer.subarray(copied, g.sizeAt))
    pieces.push(Buffer.from(encodeSize(g.size + 3, g.sizeLength)))
    pieces.push(buffer.subarray(g.sizeAt + g.sizeLength, g.end))
    pieces.push(Buffer.from([0xfb, 0x81, 0xff]))
    copied = g.end
  }
  pieces.push(buffer.subarray(copied))
  return { bytes: Buffer.concat(pieces), cleared }
}

/** EBML size field of a fixed width. */
function encodeSize(value, width) {
  const out = []
  for (let i = width - 1; i >= 0; i--) out.push(Math.floor(value / 256 ** i) % 256)
  out[0] |= 0x80 >> (width - 1)
  return out
}

if (!existsSync(LONG_FILE) || process.env.REGEN) {
  info(`recording a ${SECONDS} s clip (takes ${SECONDS} s) ...`)
  await recordLongClip()
}
info(`long clip: ${LONG_FILE}, ${(readFileSync(LONG_FILE).length / 1e6).toFixed(1)} MB`)

const state = (fn, arg) =>
  page.evaluate(
    `(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; return (${fn})(p._s.get('editor'), p._s.get('media'), p._s.get('fineCut'), ${JSON.stringify(arg ?? null)}) })()`
  )

async function newProjectWith(path) {
  await freshPage(`${BASE}/app/`)
  await page.waitForSelector('header')
  await page.locator('header button[aria-haspopup]').first().click()
  await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await page.locator('input[type=file]').first().setInputFiles(path)
  const name = path.split('/').pop()
  await page.waitForFunction(
    (n) => {
      const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const asset = p._s.get('editor').project.assets.find((a) => a.name === n)
      return !!asset && p._s.get('media').status[asset.id] === 'ready'
    },
    name,
    { timeout: 30000 }
  )
  await page.getByRole('button', { name: new RegExp(name.replace(/\./g, '\\.')) }).first().click()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').project.clips.length === 1)
}

/** Waits until the frame provider has stopped decoding for a moment (the paused preview shows its picture). */
async function previewSettled() {
  await page.evaluate(async () => {
    const { getFrameProvider } = await import('/src/ui/stores/media.ts')
    let last = -1
    let still = 0
    while (still < 6) {
      await new Promise((r) => setTimeout(r, 100))
      const now = getFrameProvider().cacheStats().decoded
      still = now === last ? still + 1 : 0
      last = now
    }
  })
}

/**
 * Moves the playhead to `seconds` and opens the fine cut. Returns the time from the click until both big frames show
 * the exact picture and the strip is filled, and the time from setting the playhead (the preview decoding included).
 */
async function fineCutUsable(seconds, { settle }) {
  const t0 = await page.evaluate((s) => {
    const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    p._s.get('editor').setPlayhead(Math.round(s * 1e6))
    return performance.now()
  }, seconds)
  if (settle) await previewSettled()
  const clickAt = await page.evaluate(() => performance.now())
  await page.locator('#fine-cut-button').click()
  await page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForFunction(
    () => {
      // A few single pixels only: reading whole canvases every poll would slow the page being measured.
      const lumaOf = (c) => {
        if (!c.width) return 0
        const ctx = c.getContext('2d')
        let sum = 0
        for (const [fx, fy] of [[0.2, 0.3], [0.5, 0.5], [0.8, 0.7], [0.3, 0.8], [0.7, 0.2]]) {
          const d = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
          sum += (d[0] + d[1] + d[2]) / 3
        }
        return sum / 5
      }
      const frames = [...document.querySelectorAll('[data-testid="fine-frame"]')]
      if (frames.length < 2 || !frames.every((c) => lumaOf(c) > 20 && c.dataset.preview !== 'thumb')) return false
      const tiles = [...document.querySelectorAll('[data-testid="fine-tile"] canvas')]
      if (tiles.length < 16 || !tiles.every((c) => c.width > 0 && lumaOf(c) > 20)) return false
      window.__usableAt = performance.now()
      return true
    },
    null,
    { timeout: 120000, polling: 50 }
  )
  const done = await page.evaluate(() => window.__usableAt)
  return { fromClick: Math.round(done - clickAt), fromPlayhead: Math.round(done - t0) }
}

async function closeFineCut() {
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'hidden', timeout: 5000 })
}

const stats = () => page.evaluate(async () => (await import('/src/ui/stores/media.ts')).getFrameProvider().cacheStats())

// --- fine cut on the long clip, each position in a fresh page (nothing cached)
const MB = 1024 * 1024
for (const at of [0.5, 15, 28]) {
  await newProjectWith(LONG_FILE)
  const settled = await fineCutUsable(at, { settle: true })
  info(`fine cut at ${at} s: usable ${settled.fromClick} ms after the click (picture of the playhead already shown); ${settled.fromPlayhead} ms counted from the playhead move`)
  check(`fine cut at ${at} s is usable in under ${USABLE_MS} ms after the click`, settled.fromClick < USABLE_MS, JSON.stringify(settled))
  const after = await stats()
  check(`fine cut at ${at} s: caches stay under their budgets`, after.fullBytes <= 96 * MB && after.thumbBytes <= 40 * MB, JSON.stringify(after))
}

await newProjectWith(LONG_FILE)
const cold = await fineCutUsable(15, { settle: false })
info(`fine cut at 15 s without waiting for the preview: ${cold.fromPlayhead} ms from the playhead move`)
check(`fine cut at 15 s is usable in under ${USABLE_MS} ms even counted from the playhead move`, cold.fromPlayhead < USABLE_MS, JSON.stringify(cold))


// --- stepping around the cut: frames next to the cut come from the cache, a long jump back may decode again
await newProjectWith(LONG_FILE)
await fineCutUsable(15, { settle: true })
/** Presses a key and returns how long until the cut moved and both big pictures are exact again. */
async function stepAndWait(key) {
  const before = await state('(ed, me, fc) => fc.cutTime')
  const t0 = await page.evaluate(() => performance.now())
  await page.keyboard.press(key)
  await page.waitForFunction(
    (b) => {
      const fc = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('fineCut')
      if (fc.cutTime === b || fc.pendingJobs > 0) return false
      const frames = [...document.querySelectorAll('[data-testid="fine-frame"]')]
      return frames.length === 2 && frames.every((c) => c.dataset.preview !== 'thumb') && !document.querySelector('[data-testid="fine-frame"] ~ [role="status"]')
    },
    before,
    { timeout: 60000, polling: 25 }
  )
  return Math.round((await page.evaluate(() => performance.now())) - t0)
}
const steps = []
for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) steps.push(await stepAndWait(key))
info(`single steps (3 forward, 5 back): ${steps.join(' ')} ms`)
check('single frame steps around the cut stay under 1 s each', steps.every((ms) => ms < 1000), steps.join(' '))
const jump = await stepAndWait('Shift+ArrowLeft')
info(`jump of 10 frames back: ${jump} ms`)
// Ten pictures back can be a long way where the recording slowed down; leaving the kept pictures costs one new pass.
check('a jump of 10 frames back costs at most a new pass (under 8 s)', jump < 8000, String(jump))
const forwardJump = await stepAndWait('Shift+ArrowRight')
check(`a jump of 10 frames forward is under ${USABLE_MS} ms`, forwardJump < USABLE_MS, String(forwardJump))
const afterSteps = await stats()
info(`caches after stepping: ${JSON.stringify(afterSteps)}`)
check('caches stay inside their budgets after stepping', afterSteps.fullBytes <= 96 * MB && afterSteps.thumbBytes <= 40 * MB, JSON.stringify(afterSteps))
check('at most three decoder positions are kept', afterSteps.runs <= 3, JSON.stringify(afterSteps))
await closeFineCut()

// --- the short recorded fixtures
for (const name of ['recorded-firefox-vp8.webm', 'recorded-chromium-vp8.webm', 'recorded-chromium-vp9.webm', 'recorded-offset-vfr.webm']) {
  await newProjectWith(join(root, 'tests/fixtures', name))
  const t = await fineCutUsable(1.7, { settle: true })
  check(`${name}: fine cut in the second cluster is usable in under ${USABLE_MS} ms`, t.fromClick < USABLE_MS, JSON.stringify(t))
}

// --- optimisation of a recording: the engine
const longBase64 = readFileSync(LONG_FILE).toString('base64')
await freshPage(`${BASE}/app/`)
await page.waitForSelector('header')
const engine = await page.evaluate(async (b64) => {
  const { optimizeRecording, scanPackets } = await import('/src/engine/record/optimize.ts')
  const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
  const raw = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'long.webm', { type: 'video/webm' })
  const progress = []
  const t0 = performance.now()
  const result = await optimizeRecording(raw, { onProgress: (f) => progress.push(f) })
  const ms = Math.round(performance.now() - t0)
  if (!result.file) return { reason: result.reason, ms, measured: result.measured }
  const keysOf = async (file) => {
    const scan = await scanPackets(file)
    return { keys: scan.keys, times: scan.times, duration: scan.durationSeconds }
  }
  const rawInfo = await keysOf(raw)
  const outInfo = await keysOf(result.file)
  const gaps = outInfo.keys.map((k, i) => (i === 0 ? 0 : k - outInfo.keys[i - 1])).concat(outInfo.duration - outInfo.keys[outInfo.keys.length - 1])
  const frameGap = (t, at) => {
    // distance between the pictures around the second keyframe boundary: a slow stretch may delay a keyframe by that much
    const i = t.findIndex((x) => x >= at)
    return i > 0 ? t[i] - t[i - 1] : 0
  }
  const strict = gaps.filter((g, i) => g > 1.05 && g - frameGap(outInfo.times, outInfo.keys[i] ?? 0) > 1.05).length
  // Mean grey of the picture at fractions of the whole length, read with the exact provider (the raw file needs its keyframe list).
  const luma = async (file, t) => {
    const provider = new ExactFrameProvider()
    provider.setFile('a', file, false)
    const out = []
    const probe = new OffscreenCanvas(32, 18)
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    for (const f of t) {
      const frame = await provider.getFrame('a', Math.round(f * 1e6))
      ctx.drawImage(frame, 0, 0, 32, 18)
      const d = ctx.getImageData(0, 0, 32, 18).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
      out.push(Math.round(sum / (d.length / 4) / 3))
    }
    await provider.dispose()
    return out
  }
  const at = [0.1, 0.5, 0.9].map((x) => x * rawInfo.duration)
  return {
    reason: result.reason,
    ms,
    progress,
    rawSize: raw.size,
    outSize: result.file.size,
    rawFrames: rawInfo.times.length,
    outFrames: outInfo.times.length,
    rawDuration: rawInfo.duration,
    outDuration: outInfo.duration,
    keys: outInfo.keys.length,
    maxKeyGap: Math.max(...gaps),
    unexplainedGaps: strict,
    monotonic: outInfo.times.every((t, i) => i === 0 || t >= outInfo.times[i - 1]),
    rawLuma: await luma(raw, at),
    outLuma: await luma(result.file, at),
    measured: result.measured
  }
}, longBase64)
info(`optimisation: ${engine.reason} in ${engine.ms} ms, ${((engine.rawSize ?? 0) / 1e6).toFixed(1)} -> ${((engine.outSize ?? 0) / 1e6).toFixed(1)} MB, keys ${engine.keys}, longest key gap ${engine.maxKeyGap?.toFixed(2)} s`)
check('the recording is optimised', engine.reason === 'optimized', JSON.stringify(engine))
if (engine.reason === 'optimized') {
  check('keyframes at least every 1.05 s (a gap longer than that only where the pictures themselves are that far apart)', engine.unexplainedGaps === 0, `${engine.unexplainedGaps} gaps, longest ${engine.maxKeyGap}`)
  check('the raw file has one keyframe, the new one many', engine.keys >= SECONDS - 2, String(engine.keys))
  check('duration within 50 ms', Math.abs(engine.rawDuration - engine.outDuration) <= 0.05, `${engine.rawDuration} vs ${engine.outDuration}`)
  check('the number of pictures is equal', engine.rawFrames === engine.outFrames, `${engine.rawFrames} vs ${engine.outFrames}`)
  check('timestamps never go back', engine.monotonic)
  check('mean grey at 10 %, 50 % and 90 % is the same', engine.rawLuma.every((l, i) => Math.abs(l - engine.outLuma[i]) <= 8), `${engine.rawLuma} vs ${engine.outLuma}`)
  check('progress rises step by step up to 100 %', engine.progress.length > 5 && engine.progress.every((p, i) => i === 0 || p >= engine.progress[i - 1]) && engine.progress.at(-1) === 1, JSON.stringify(engine.progress.slice(-4)))
}

// --- optimisation of a recording: the Record tab (progress, Skip, replacement, rescue copy)
async function importAsRecording(name) {
  await state(
    `(ed, me, fc, arg) => { window.__rawSize = 0; return 0 }`
  )
  await page.evaluate(
    async ({ b64, name }) => {
      const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'video/webm' })
      window.__rawSize = file.size
      void p._s.get('record').importRecording(file)
    },
    { b64: longBase64, name }
  )
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('record').phase === 'done', null, { timeout: 60000 })
}
const assetFileSize = (name) =>
  page.evaluate(async (n) => {
    const { getAssetFile } = await import('/src/ui/stores/media.ts')
    const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const asset = p._s.get('editor').project.assets.find((a) => a.name === n)
    return asset ? getAssetFile(asset.id)?.size : null
  }, name)

await freshPage(`${BASE}/app/`)
await page.waitForSelector('header')
await page.getByRole('button', { name: 'Record', exact: true }).click()
await importAsRecording('Screen skip.webm')
const optimizeRow = page.locator('[data-role="optimize"]')
await optimizeRow.waitFor({ state: 'visible', timeout: 10000 })
const rowText = await optimizeRow.locator('[data-role="optimize-text"]').innerText()
check('the panel shows "Optimizing the recording … N %" with a Skip button', /Optimizing the recording … \d+ %/.test(rowText), rowText)
check('the clip is usable with the raw file while it runs', (await assetFileSize('Screen skip.webm')) === (await page.evaluate(() => window.__rawSize)))
await page.waitForTimeout(1500)
const percentLater = Number((await optimizeRow.locator('[data-role="optimize-text"]').innerText()).match(/(\d+) %/)?.[1] ?? -1)
check('the percentage moves', percentLater > 0, String(percentLater))
await optimizeRow.locator('[data-role="optimize-skip"]').click()
await optimizeRow.waitFor({ state: 'hidden', timeout: 5000 })
await page.waitForTimeout(500)
check('Skip keeps the raw file', (await assetFileSize('Screen skip.webm')) === (await page.evaluate(() => window.__rawSize)))
check('Skip leaves no half-finished work behind', (await state('(ed, me, fc, a) => 0')) === 0 && (await page.locator('[data-role="optimize"]').count()) === 0)

await importAsRecording('Screen full.webm')
await optimizeRow.waitFor({ state: 'visible', timeout: 10000 })
await optimizeRow.waitFor({ state: 'hidden', timeout: 120000 })
const replaced = await assetFileSize('Screen full.webm')
const rawSize = await page.evaluate(() => window.__rawSize)
check('when it finishes the library file is the optimised one, under the same asset', replaced !== null && replaced !== rawSize, `${replaced} vs ${rawSize}`)
const kept = await page.evaluate(async () => {
  const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const media = p._s.get('media')
  const asset = p._s.get('editor').project.assets.find((a) => a.name === 'Screen full.webm')
  return { size: asset.size, stored: media.storedSizes[asset.storeKey], status: media.statusOf(asset.id) }
})
check('the project keeps the original size; the browser keeps the optimised copy', kept.size === rawSize && kept.stored === replaced && kept.status === 'ready', JSON.stringify(kept))
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator('[data-role="save-file"]').first().click()])
const savedPath = await download.path()
check('"Save a copy as a file" still gives the original recording', savedPath && readFileSync(savedPath).length === rawSize, `${savedPath && readFileSync(savedPath).length} vs ${rawSize}`)

// The optimised clip opens fast in the fine cut and does not need the sparse path any more.
await page.getByRole('button', { name: /Add to timeline/ }).click()
const fast = await fineCutUsable(15, { settle: true })
const sparse = await page.evaluate(async () => {
  const { getFrameProvider } = await import('/src/ui/stores/media.ts')
  const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const asset = p._s.get('editor').project.assets.find((a) => a.name === 'Screen full.webm')
  return getFrameProvider().isSparseAsset(asset.id)
})
info(`fine cut at 15 s of the optimised clip: ${fast.fromClick} ms after the click, ${fast.fromPlayhead} ms from the playhead move`)
check('the optimised clip needs no sparse reading', sparse === false)
check('the optimised clip opens the fine cut within 3 s of the playhead move', fast.fromPlayhead < USABLE_MS, JSON.stringify(fast))

check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '))

await context.close()
await browser.close()
await server.close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
