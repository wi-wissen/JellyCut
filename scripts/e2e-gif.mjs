// Animated GIF export (X-02): engine output decoded by the browser and by an independent parser, the dialog
// flow (options, estimate, start, save, cancel), the size refusal for a long project, and a 2-clip project
// with a text and a transition. Usage: node scripts/e2e-gif.mjs   (env SHOT_DIR for screenshots and downloads)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const PORT = 5173
const APP_URL = `http://localhost:${PORT}/app/`
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const FRAMES = join(root, 'tests/fixtures/frames.webm')
const CLIP_A = join(root, 'tests/fixtures/clip-a.webm')
mkdirSync(SHOT_DIR, { recursive: true })

const PICKER_OFF = `Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true });`

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

// Independent GIF reader in Node: header size, loop extension, frame delays and frame count (no pixels).
function parseGif(buf) {
  const info = { signature: buf.toString('latin1', 0, 6), width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), loop: null, delays: [], frames: 0, trailer: buf[buf.length - 1] }
  let p = 13
  if (buf[10] & 0x80) p += 3 * (1 << ((buf[10] & 7) + 1))
  const subBlocks = () => {
    const parts = []
    for (;;) {
      const n = buf[p++]
      if (n === 0) break
      parts.push(buf.subarray(p, p + n))
      p += n
    }
    return Buffer.concat(parts)
  }
  while (p < buf.length) {
    const marker = buf[p++]
    if (marker === 0x3b) break
    if (marker === 0x21) {
      const label = buf[p++]
      if (label === 0xf9) {
        info.delays.push(buf.readUInt16LE(p + 2))
        p += 6
      } else if (label === 0xff) {
        const size = buf[p]
        const id = buf.toString('latin1', p + 1, p + 1 + size)
        p += 1 + size
        const data = subBlocks()
        if (id === 'NETSCAPE2.0' && data[0] === 1) info.loop = data[1] | (data[2] << 8)
      } else subBlocks()
    } else if (marker === 0x2c) {
      info.frames++
      p += 9 + 1
      subBlocks()
    } else {
      throw new Error(`unexpected block 0x${marker.toString(16)} at ${p - 1}`)
    }
  }
  return info
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

const dialog = (page) => page.getByRole('dialog', { name: /Export video/ })
const startButton = (page) => page.getByRole('button', { name: 'Start export', exact: true })
const estimateText = (page) => page.locator('[role=dialog] p', { hasText: /size about/ }).first().innerText()
const waitPhase = (page, phase, timeout) => waitFor(async () => (await state(page, '(ed, ex) => ex.phase')) === phase, timeout, 200)

async function setupProject(page) {
  await page.goto(APP_URL)
  await page.locator('#project-menu-trigger').waitFor()
  await page.locator('#project-menu-trigger').click()
  await page.getByRole('menuitem', { name: /New project/ }).click()
  await page.locator('input[type=file]').first().setInputFiles([FRAMES, CLIP_A])
  const frames = page.getByRole('button', { name: /frames\.webm/ }).first()
  const clip = page.getByRole('button', { name: /clip-a\.webm/ }).first()
  await frames.waitFor({ timeout: 30_000 })
  await clip.waitFor({ timeout: 30_000 })
  await frames.click()
  await clip.click()
  await waitFor(async () => (await state(page, '(ed) => ed.project.clips.length')) === 2, 10_000)
}

async function shotGif(page, name) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    await page.waitForTimeout(150)
    await dialog(page).screenshot({ path: join(SHOT_DIR, `gif-${name}-${theme}.png`) })
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
}

const TEXT = (id, start, duration) => ({ id, start, duration, text: 'GIF', style: { font: 'Sora', size: 120, color: '#ffffff', outline: null }, pos: { x: 0.5, y: 0.5 }, animIn: null, animOut: null })

// ---------- A: engine output, checked by the browser's GIF decoder and by the Node reader ----------
const engine = await (async () => {
  const { page, context, pageErrors } = await newPage()
  await page.goto(APP_URL)
  await page.locator('#project-menu-trigger').waitFor()
  const out = await page.evaluate(async () => {
    const mod = (p) => import(p)
    const { runGifExport } = await mod('/src/engine/export/gifExporter.ts')
    const { probeFile } = await mod('/src/engine/media/probe.ts')
    const { createProject } = await mod('/src/core/project/schema.ts')
    const { planTimeline } = await mod('/src/core/render/scene.ts')
    const S = 1_000_000
    const load = async (name, type) => new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type })
    const files = { frames: await load('frames.webm', 'video/webm'), clipa: await load('clip-a.webm', 'video/webm') }
    const infos = {}
    for (const [id, f] of Object.entries(files)) infos[id] = await probeFile(f)
    const mkProject = () => {
      const p = createProject('frames')
      for (const [id, info] of Object.entries(infos)) {
        p.assets.push({ id, kind: info.kind, name: info.name, relPath: info.name, size: info.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio })
      }
      return p
    }
    const clip = (id, assetId, srcIn, srcOut, start, extra = {}) => ({
      id, track: 'video', assetId, srcIn, srcOut, start, speed: 1,
      transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
      volume: 1, muted: false, filter: null, transitionIn: null, ...extra
    })
    const toBase64 = async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192))
      return btoa(s)
    }
    const readBits = (ctx, w, h) => {
      const sx = w / 160, sy = h / 90
      let n = 0
      for (let b = 0; b < 8; b++) {
        const d = ctx.getImageData(Math.round((b * 20 + 10) * sx), Math.round(45 * sy), 1, 1).data
        if (d[0] > 127) n |= 1 << b
      }
      return n
    }
    const decodeInBrowser = async (blob) => {
      const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: 'image/gif' })
      await decoder.tracks.ready
      const frameCount = decoder.tracks.selectedTrack.frameCount
      const numbers = []
      const durations = []
      let width = 0, height = 0
      for (let k = 0; k < frameCount; k++) {
        const { image } = await decoder.decode({ frameIndex: k })
        width = image.displayWidth
        height = image.displayHeight
        durations.push(image.duration)
        const c = new OffscreenCanvas(width, height)
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(image, 0, 0)
        numbers.push(readBits(ctx, width, height))
        image.close()
      }
      decoder.close()
      return { frameCount, width, height, numbers, durations }
    }

    const result = {}
    // A: 3 s of frame-number blocks at 320 px and 10 fps.
    {
      const p = mkProject()
      p.clips = [clip('c1', 'frames', 0, 3 * S, 0)]
      const planned = planTimeline(p)
      result.plannedDuration = planned.duration
      const res = await runGifExport({ kind: 'gif', project: p, files, options: { format: 'gif', width: 320, fps: 10, loop: true } }, () => undefined, new AbortController().signal)
      result.size = res.blob.size
      result.frames = res.frames
      result.resultWidth = res.width
      result.resultHeight = res.height
      result.base64 = await toBase64(res.blob)
      result.browser = await decodeInBrowser(res.blob)
    }
    // C: 2 clips with a fade transition and a text, from the same engine call.
    {
      const p = mkProject()
      p.clips = [clip('c1', 'frames', 0, 2 * S, 0), clip('c2', 'clipa', 0, 2 * S, 2 * S, { transitionIn: { type: 'fade', duration: S } })]
      p.texts = [{ id: 't1', start: 0, duration: 3 * S, text: 'HELLO', style: { font: 'Sora', size: 90, color: '#ff00ff', outline: null }, pos: { x: 0.5, y: 0.2 }, animIn: null, animOut: null }]
      const planned = planTimeline(p)
      const duration = Math.max(planned.duration, 3 * S)
      result.mixedPlanned = duration
      try {
        const res = await runGifExport({ kind: 'gif', project: p, files, options: { format: 'gif', width: 480, fps: 15, loop: false } }, () => undefined, new AbortController().signal)
        result.mixed = { frames: res.frames, expected: Math.ceil((duration * 15) / S), decoded: (await decodeInBrowser(res.blob)).frameCount }
      } catch (e) {
        result.mixed = { error: e?.message ?? String(e) }
      }
    }
    return result
  })
  const a = out
  const nodeInfo = parseGif(Buffer.from(a.base64, 'base64'))
  writeFileSync(join(SHOT_DIR, 'gif-engine.gif'), Buffer.from(a.base64, 'base64'))
  check('engine: GIF89a signature and 320 px wide, 180 px high', nodeInfo.signature === 'GIF89a' && nodeInfo.width === 320 && nodeInfo.height === 180 && a.resultWidth === 320 && a.resultHeight === 180, JSON.stringify([nodeInfo.signature, nodeInfo.width, nodeInfo.height]))
  check('engine: frame count is ceil(3 s x 10 fps) = 30', nodeInfo.frames === 30 && a.frames === 30 && a.browser.frameCount === 30, JSON.stringify([nodeInfo.frames, a.frames, a.browser.frameCount]))
  check('engine: loop extension says forever (0)', nodeInfo.loop === 0, String(nodeInfo.loop))
  check('engine: file ends with the trailer 0x3B', nodeInfo.trailer === 0x3b)
  const totalMs = nodeInfo.delays.reduce((n, cs) => n + cs * 10, 0)
  const projectMs = a.plannedDuration / 1000
  check('engine: sum of delays is within 3 % of the project length', Math.abs(totalMs - projectMs) <= projectMs * 0.03, `${totalMs} ms vs ${projectMs} ms`)
  check('engine: browser decoder gives the same frame delays as the Node reader', a.browser.durations.length === nodeInfo.delays.length && a.browser.durations.every((us, i) => Math.abs(us / 10_000 - nodeInfo.delays[i]) <= 1), JSON.stringify(a.browser.durations.slice(0, 4)))
  const wrong = []
  for (let k = 0; k < 30; k++) {
    const want = Math.round((k * 3)) // 10 fps over 30 fps material: frame k shows source frame 3k
    if (a.browser.numbers[k] !== want) wrong.push(`${k}:${a.browser.numbers[k]}!=${want}`)
  }
  check('engine: frame k shows source frame number 3k (all 30 frames, read by the browser decoder)', wrong.length === 0, wrong.slice(0, 6).join(' '))
  check('engine: the browser decodes 320x180 frames', a.browser.width === 320 && a.browser.height === 180, `${a.browser.width}x${a.browser.height}`)
  check('engine: two clips with a fade and a text export without error', a.mixed && a.mixed.error === undefined && a.mixed.frames === a.mixed.expected && a.mixed.decoded === a.mixed.expected, JSON.stringify(a.mixed))
  check('engine: no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
  await context.close()
  return { nodeInfo, a }
})()

// ---------- B: dialog flow ----------
{
  const { context, page, pageErrors } = await newPage({ initScript: PICKER_OFF })
  await setupProject(page)
  await page.locator('#export-button').click()
  await dialog(page).waitFor()
  await waitPhase(page, 'ready', 15_000)
  await page.getByRole('radio', { name: 'GIF', exact: true }).click({ force: true })
  await waitFor(async () => (await state(page, '(ed, ex) => ex.format')) === 'gif', 3000)
  check('GIF format is enabled and selectable', await page.getByRole('radio', { name: 'GIF', exact: true }).isEnabled())
  const text = await dialog(page).innerText()
  check('GIF shows width, frames per second and the loop switch', text.includes('Width') && text.includes('Frames per second') && (await page.getByRole('switch', { name: 'Loop forever' }).isChecked()))
  check('the GIF estimate is marked as rough', (await dialog(page).innerText()).includes('Rough estimate'))
  check('the default GIF width is 480 px and frame rate 15', (await state(page, '(ed, ex) => ex.gif.width')) === 480 && (await state(page, '(ed, ex) => ex.gif.fps')) === 15)
  for (const [w, h] of [[1440, 900], [390, 800]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(300)
    await shotGif(page, `${w}`)
    const fit = await page.evaluate(() => {
      const panel = document.querySelector('[role=dialog]')
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: panel.scrollWidth - panel.clientWidth }
    })
    check(`GIF dialog fits ${w} px without horizontal overflow`, fit.page <= 0 && fit.panel <= 0, JSON.stringify(fit))
  }
  await page.setViewportSize({ width: 1120, height: 700 })
  await page.waitForTimeout(200)

  const est0 = await state(page, '(ed, ex) => ex.estimatedBytes')
  await page.getByRole('radio', { name: '320 px', exact: true }).click({ force: true })
  await waitFor(async () => (await state(page, '(ed, ex) => ex.estimatedBytes')) !== est0, 3000)
  const est1 = await state(page, '(ed, ex) => ex.estimatedBytes')
  check('the width change updates the size estimate', est1 !== est0, `${est0} -> ${est1}`)
  const seconds0 = await state(page, '(ed, ex) => ex.estimatedSeconds')
  await page.getByRole('radio', { name: '10', exact: true }).click({ force: true })
  await waitFor(async () => (await state(page, '(ed, ex) => ex.estimatedBytes')) !== est1, 3000)
  check('the frame rate change updates the size estimate', (await state(page, '(ed, ex) => ex.estimatedBytes')) !== est1)
  check('the frame rate change updates the time estimate', (await state(page, '(ed, ex) => ex.estimatedSeconds')) !== seconds0)
  check('Start is enabled for a normal GIF', await startButton(page).isEnabled())
  check('no size warning for a normal GIF', (await dialog(page).getByRole('alert').count()) === 0)

  const projectFrames = Math.ceil(((await state(page, '(ed) => ed.totalDuration')) * 10) / 1_000_000)
  // The file is saved automatically when the export is ready (no Save click).
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 }).catch(() => null)
  await startButton(page).click()
  const done = await waitPhase(page, 'done', 120_000)
  check('GIF export finishes in the done state', done, `phase=${await state(page, '(ed, ex) => ex.phase')} error=${JSON.stringify(await state(page, '(ed, ex) => ex.error'))}`)
  check('done state names the GIF file', done && (await dialog(page).innerText()).includes('New project.gif'))
  const storedGif = await page.evaluate(() => localStorage.getItem('jellycut.export.gif'))
  check('the first GIF export stores its size calibration under jellycut.export.gif', storedGif !== null && typeof JSON.parse(storedGif).bytesPerPixel === 'number', String(storedGif))
  const download = await downloadPromise
  check('the finished export downloads automatically as New project.gif', download !== null && download.suggestedFilename() === 'New project.gif', download?.suggestedFilename())
  if (download) {
    const path = join(SHOT_DIR, 'gif-download.gif')
    await download.saveAs(path)
    const bytes = readFileSync(path)
    check('the saved file starts with GIF89a', bytes.toString('latin1', 0, 6) === 'GIF89a', bytes.subarray(0, 6).toString('hex'))
    const parsed = parseGif(bytes)
    check(`the saved file is 320 px wide, has ${projectFrames} frames (project length at 10 fps) and loops`, parsed.width === 320 && parsed.frames === projectFrames && parsed.loop === 0, JSON.stringify({ w: parsed.width, f: parsed.frames, loop: parsed.loop, projectFrames }))

    // ffprobe is an extra, independent reader; optional.
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames,duration', '-of', 'json', path], { encoding: 'utf8' })
    if (probe.error || probe.status !== 0) {
      console.log(`SKIP ffprobe check (${probe.error ? probe.error.code : `exit ${probe.status}`})`)
    } else {
      const s = JSON.parse(probe.stdout).streams[0]
      const projectSeconds = projectFrames / 10
      check(`ffprobe: 320x180, ${projectFrames} frames, about ${projectSeconds.toFixed(1)} s`, s.width === 320 && s.height === 180 && Number(s.nb_read_frames) === projectFrames && Math.abs(Number(s.duration) - projectSeconds) < 0.2, JSON.stringify(s))
    }
  }
  check('no uncaught page errors in the GIF flow', pageErrors.length === 0, pageErrors.join(' | '))

  // Cancel: a 40 s text over the clips, so the export runs long enough to cancel.
  await page.getByRole('button', { name: 'Export again', exact: true }).click()
  await waitPhase(page, 'ready', 5000)
  await state(page, '(ed) => { ed.project.texts = [' + JSON.stringify(TEXT('long', 0, 40_000_000)) + ']; return 0 }')
  await waitFor(async () => (await state(page, '(ed) => ed.totalDuration')) === 40_000_000, 3000)
  await startButton(page).click()
  const midway = await waitFor(async () => ((await state(page, '(ed, ex) => ex.progress?.fraction ?? 0')) || 0) >= 0.05, 60_000, 50)
  check('GIF export is running before cancel', midway)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  check('cancel ends the GIF export in the cancelled state', await waitPhase(page, 'cancelled', 60_000), `phase=${await state(page, '(ed, ex) => ex.phase')}`)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await waitPhase(page, 'ready', 5000)
  check('after a cancelled GIF the dialog is usable again', await startButton(page).isEnabled())

  // Long project: a 90 s item. The GIF is refused before it starts.
  await state(page, '(ed) => { ed.project.texts = [' + JSON.stringify(TEXT('long90', 0, 90_000_000)) + ']; return 0 }')
  await waitFor(async () => (await state(page, '(ed) => ed.totalDuration')) === 90_000_000, 3000)
  await waitFor(async () => (await state(page, '(ed, ex) => ex.gifTooBig')) === true, 3000)
  const warning = dialog(page).getByRole('alert')
  check('a 90 s GIF shows the size warning', (await warning.count()) > 0 && (await warning.first().innerText()).includes('GIFs get huge: please pick a shorter section or a lower size'), (await warning.count()) ? await warning.first().innerText() : 'no alert')
  check('a 90 s GIF disables Start export', !(await startButton(page).isEnabled()))
  await shotGif(page, 'warning')
  await page.keyboard.press('Escape')
  await waitFor(async () => !(await dialog(page).isVisible().catch(() => false)), 3000)
  check('Escape closes the dialog after the warning', !(await dialog(page).isVisible().catch(() => false)))
  await context.close()
}

await browser.close()
await server.close()
if (failed) {
  console.log(`${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('ALL CHECKS PASSED')
