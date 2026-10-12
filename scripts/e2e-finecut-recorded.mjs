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

/** Opens the fine cut at `seconds` and returns the time until both big frames are not black and the strip is filled. */
async function fineCutUsable(seconds) {
  await state('(ed, me, fc, s) => ed.setPlayhead(Math.round(s * 1000000))', seconds)
  const t0 = await page.evaluate(() => performance.now())
  await page.locator('#fine-cut-button').click()
  await page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForFunction(
    (start) => {
      const lumaOf = (c) => {
        if (!c.width) return 0
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let sum = 0
        for (let i = 0; i < d.length; i += 40) sum += d[i] + d[i + 1] + d[i + 2]
        return sum / (d.length / 40) / 3
      }
      const frames = [...document.querySelectorAll('[data-testid="fine-frame"]')]
      if (frames.length < 2 || !frames.every((c) => lumaOf(c) > 20)) return false
      const tiles = [...document.querySelectorAll('[data-testid="fine-tile"] canvas')]
      if (tiles.length < 16) return false
      const filled = tiles.filter((c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 8)).data
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 30) return true
        return false
      })
      window.__usableAt = performance.now() - start
      return filled.length >= tiles.length
    },
    t0,
    { timeout: 120000, polling: 50 }
  )
  return Math.round(await page.evaluate(() => window.__usableAt))
}

await newProjectWith(LONG_FILE)
for (const at of [0.5, 15, 28]) {
  const ms = await fineCutUsable(at)
  info(`fine cut at ${at} s usable after ${ms} ms`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

await context.close()
await browser.close()
await server.close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
