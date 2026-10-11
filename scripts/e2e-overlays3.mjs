// Real-browser check of the overlay step 3: vector stickers, animation directions, stacking order, the marker
// pen (uniform alpha on one stroke) and picture timing. Pixels are measured in the preview and in one exported
// MP4 frame; legacy saved values (slideUp, emoji stickers) load. Usage: node scripts/e2e-overlays3.mjs
// (exit code 1 when a check fails). Port 5250, like the other overlay checks (run them one after another).
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5250
const SHOTS = process.env.OVERLAY_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const VIEW = { width: 1440, height: 900 }
const S = 1_000_000

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
const context = await browser.newContext({ viewport: VIEW, locale: 'en', colorScheme: 'light' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}
const settle = (ms = 300) => page.waitForTimeout(ms)

/** Runs fn(editor, arg) in the page and returns its value (the editor store is reached through Pinia). */
const st = (fn, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = pinia._s.get('editor')
      return new Function('ed', 'a', `return (${src})(ed, a)`)(ed, a)
    },
    [fn, arg]
  )

/** Preview picture without the DOM overlay layer, as a base64 PNG. */
async function canvasShot() {
  await page.addStyleTag({ content: '[data-player-overlay]{display:none!important}' })
  await page.waitForTimeout(120)
  const buf = await page.locator('canvas').first().screenshot()
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('data-player-overlay') && s.remove()))
  return buf.toString('base64')
}

/**
 * Difference between two shots of the same picture, inside a fraction rectangle [x0, x1, y0, y1]: the sum of the
 * absolute colour change per pixel, and the weighted centre of the change. A shot with the item at opacity 0 is
 * the background, so this isolates the item whatever the picture behind it. Linear in the item's alpha.
 */
function diff(a, b, rect = [0, 1, 0, 1]) {
  return page.evaluate(
    async ([A, B, r]) => {
      const load = async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0)
        return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data }
      }
      const pa = await load(A)
      const pb = await load(B)
      const { w, h } = pa
      const x0 = Math.floor(r[0] * w), x1 = Math.ceil(r[1] * w), y0 = Math.floor(r[2] * h), y1 = Math.ceil(r[3] * h)
      let sum = 0, mx = 0, my = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          const v = Math.abs(pa.d[i] - pb.d[i]) + Math.abs(pa.d[i + 1] - pb.d[i + 1]) + Math.abs(pa.d[i + 2] - pb.d[i + 2])
          sum += v
          mx += v * x
          my += v * y
        }
      }
      return { sum, count: (x1 - x0) * (y1 - y0), cx: sum > 0 ? mx / sum / w : null, cy: sum > 0 ? my / sum / h : null }
    },
    [a, b, rect]
  )
}

/** Number of pixels in a fraction rectangle whose colour satisfies a predicate (source text, evaluated in the page). */
function countColour(png, predicate, rect = [0, 1, 0, 1]) {
  return page.evaluate(
    async ([b64, pred, r]) => {
      const test = new Function(`return (${pred})`)()
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0)
      const { width: w, height: h } = bmp
      const d = ctx.getImageData(0, 0, w, h).data
      let n = 0
      for (let y = Math.floor(r[2] * h); y < Math.ceil(r[3] * h); y++) {
        for (let x = Math.floor(r[0] * w); x < Math.ceil(r[1] * w); x++) {
          const i = (y * w + x) * 4
          if (test(d[i], d[i + 1], d[i + 2])) n++
        }
      }
      return n
    },
    [png, predicate, rect]
  )
}

const isGreen = '(r, g, b) => g > 200 && r < 90 && b < 90'

/** Mean colour of a 3 x 3 pixel neighbourhood at a fraction point. */
function pixelAt(png, fx, fy) {
  return page.evaluate(
    async ([b64, x, y]) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0)
      const cx = Math.round(x * bmp.width), cy = Math.round(y * bmp.height)
      let r = 0, g = 0, b = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const d = ctx.getImageData(cx + dx, cy + dy, 1, 1).data
        r += d[0]; g += d[1]; b += d[2]; n++
      }
      return [r / n, g / n, b / n]
    },
    [png, fx, fy]
  )
}

// --- setup: a new project with the checker picture as the clip, playhead at 1 s
await page.goto(`http://localhost:${PORT}/app/`)
await page.waitForSelector('header')
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/overlays2-checker.png'))
await page.waitForFunction(() => document.body.innerText.includes('overlays2-checker.png'))
await settle(250)
await page.getByRole('button', { name: /overlays2-checker\.png/ }).first().click()
await settle(500)
await st('(ed) => ed.setPlayhead(1000000)')
await page.waitForSelector('[data-player-overlay]')
await settle(400)

// --- 1. vector stickers: no emoji, drawn in the chosen colour, outline optional
await st('(ed) => { ed.setOverlayColor("#ff0000"); ed.addVectorStickerAtPlayhead("heart") }')
await settle()
let heart = await st('(ed) => ed.project.overlays[0]')
check('sticker: a vector heart is added with its colour and no emoji', heart?.kind === 'sticker' && heart.shape === 'heart' && heart.color === '#ff0000' && heart.emoji === undefined, JSON.stringify(heart))
await st('(ed, id) => ed.updateSelectedOverlay({ size: 0.3 })', heart.id)
await settle(300)
let shot = await canvasShot()
const centreRed = await pixelAt(shot, 0.5, 0.5)
check('sticker: the heart is drawn in red at the centre of the picture', centreRed[0] > 200 && centreRed[1] < 80 && centreRed[2] < 80, JSON.stringify(centreRed))

// --- 2. stacking: a later item is on top; bringToFront / sendToBack change the order (and undo does)
await st('(ed) => { ed.setOverlayColor("#0000ff"); ed.addVectorStickerAtPlayhead("star") }')
await settle()
let star = await st('(ed) => ed.project.overlays[1]')
await st('(ed, id) => ed.updateSelectedOverlay({ size: 0.3 })', star.id)
await settle(300)
shot = await canvasShot()
let centre = await pixelAt(shot, 0.5, 0.5)
check('stacking: the later star is drawn on top of the heart', centre[2] > 200 && centre[0] < 80, JSON.stringify(centre))
await st('(ed) => ed.stackSelectedOverlay("back")')
await settle(300)
const orderBack = await st('(ed) => ed.project.overlays.map((o) => o.id)')
check('stacking: sendToBack moves the star to the start of the list', orderBack[0] === star.id, JSON.stringify(orderBack))
shot = await canvasShot()
centre = await pixelAt(shot, 0.5, 0.5)
check('stacking: after sendToBack the heart covers the star at the centre', centre[0] > 200 && centre[2] < 80, JSON.stringify(centre))
await st('(ed) => ed.commitProject ? null : null')
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await settle(300)
const orderUndo = await st('(ed) => ed.project.overlays.map((o) => o.id)')
check('stacking: undo restores the previous order in one step', orderUndo[1] === star.id, JSON.stringify(orderUndo))
await st('(ed, id) => ed.select({ kind: "overlay", id })', star.id)

// Only the star stays from here on, so the heart cannot cover what is measured.
await st('(ed, id) => ed.commitProject({ ...ed.project, overlays: ed.project.overlays.filter((o) => o.id === id) })', star.id)
await st('(ed, id) => ed.select({ kind: "overlay", id })', star.id)
await st('(ed, id) => ed.updateSelectedOverlay({ opacity: 0 })', star.id)
await settle(500)
const bgShot = await canvasShot()
await st('(ed, id) => ed.updateSelectedOverlay({ opacity: 1 })', star.id)
await settle(500)

// --- 3. outline: a green outline shows around the star when set
await st('(ed) => ed.updateSelectedOverlay({ outline: "#00ff00" })')
await settle(500)
const greenPixels = await countColour(await canvasShot(), isGreen, [0.2, 0.8, 0.1, 0.9])
check('outline: a green outline is drawn around the star', greenPixels > 30, JSON.stringify(greenPixels))
await st('(ed) => ed.updateSelectedOverlay({ outline: null })')
await settle(500)

// --- 4. animation direction: a star slides in from the left, and later leaves to the top
const starArea = [0.2, 0.8, 0.1, 0.9]
await st('(ed, id) => ed.updateSelectedOverlay({ animIn: "slideFromLeft", start: 2000000 })', star.id)
await st('(ed) => { ed.setPlayhead(2200000) }')
await settle(600)
const mid = await diff(await canvasShot(), bgShot, starArea)
await st('(ed) => { ed.setPlayhead(2900000) }')
await settle(600)
const rest = await diff(await canvasShot(), bgShot, starArea)
check('animation: a slide from the left comes in from the left (moves right while it arrives)', mid.sum > 0 && rest.sum > 0 && mid.cx < rest.cx - 0.002, JSON.stringify({ mid: mid.cx, rest: rest.cx }))
await st('(ed, id) => ed.updateSelectedOverlay({ animIn: null, animOut: "slideToTop" })', star.id)
await st('(ed) => { ed.setPlayhead(4900000) }')
await settle(600)
const leaving = await diff(await canvasShot(), bgShot, starArea)
await st('(ed) => { ed.setPlayhead(3500000) }')
await settle(600)
const settled = await diff(await canvasShot(), bgShot, starArea)
check('animation: a slide out to the top leaves upwards', leaving.sum > 0 && leaving.cy < settled.cy - 0.001, JSON.stringify({ leaving: leaving.cy, settled: settled.cy }))
const stored = await st('(ed, id) => ed.project.overlays.find((o) => o.id === id).animOut', star.id)
check('animation: the stored name is the direction name', stored === 'slideToTop', stored)
await st('(ed, id) => ed.updateSelectedOverlay({ animOut: null })', star.id)

// --- 5. marker: one stroke that crosses itself has the same strength at the crossing as elsewhere, and 40 % of full opacity
await st('(ed) => ed.commitProject({ ...ed.project, overlays: [] })')
await st('(ed) => { ed.setPlayhead(1000000) }')
await settle(500)
const markerBg = await canvasShot()
await st('(ed) => ed.applyMarkerPreset()')
await st('(ed) => { ed.addStrokeAtPlayhead([{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.4 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.6 }]) }')
await settle(500)
const marker = await st('(ed) => ed.project.overlays.filter((o) => o.kind === "stroke").at(-1)')
check('marker: the stroke is flat-ended at 40 % opacity and wide', marker?.cap === 'flat' && marker.opacity === 0.4 && marker.lineWidth === 0.016, JSON.stringify(marker))
const markerShot = await canvasShot()
const singleRect = [0.33, 0.37, 0.39, 0.41]
const crossRect = [0.48, 0.52, 0.39, 0.41]
const single = await diff(markerShot, markerBg, singleRect)
const crossing = await diff(markerShot, markerBg, crossRect)
const singleMean = single.sum / single.count
const crossMean = crossing.sum / crossing.count
check('marker: the crossing is not stronger than a single pass (one stroke, uniform alpha)', singleMean > 5 && Math.abs(crossMean - singleMean) < 0.1 * singleMean, JSON.stringify({ singleMean, crossMean }))
await st('(ed, id) => { ed.select({ kind: "overlay", id }) }', marker.id)
await st('(ed, id) => ed.updateSelectedOverlay({ opacity: 1 })', marker.id)
await settle(500)
const fullShot = await canvasShot()
const full = await diff(fullShot, markerBg, singleRect)
const ratio = single.sum / full.sum
console.log('marker ratio', JSON.stringify({ singleMean, crossMean, ratio }))
check('marker: the marker is 40 % as strong as the same stroke at full opacity', Math.abs(ratio - 0.4) < 0.05, JSON.stringify({ ratio }))
await st('(ed, id) => ed.updateSelectedOverlay({ opacity: 0.4 })', marker.id)
await st('(ed) => ed.select(null)')
await settle(300)

// --- 6. export: the marker stroke is in the exported frame, tinted yellow
const exported = await page.evaluate(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  const { runExport } = await import('/src/engine/export/exporter.ts')
  const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
  const { frameStart } = await import('/src/core/time.ts')
  const files = {}
  for (const asset of ed.project.assets) files[asset.id] = new File([await (await fetch(`/tests/fixtures/${asset.name}`)).blob()], asset.name)
  const res = await runExport({ project: JSON.parse(JSON.stringify(ed.project)), files, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, () => undefined, new AbortController().signal)
  const provider = new ExactFrameProvider()
  provider.setFile('out', new File([res.blob], 'out.mp4'), false)
  const frame = await provider.getFrame('out', frameStart(18, 30))
  const w = frame.displayWidth ?? frame.width
  const h = frame.displayHeight ?? frame.height
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d').drawImage(frame, 0, 0)
  const png = await c.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await png.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  await provider.dispose()
  return { frames: res.frames, png: btoa(bin) }
})
const yellowTint = '(r, g, b) => r - b > 50 && g - b > 40 && b < 200'
const expYellow = await countColour(exported.png, yellowTint, [0.28, 0.72, 0.28, 0.62])
check('export: the marker stroke is in the exported frame', expYellow > 30 && exported.frames > 30, JSON.stringify({ expYellow, frames: exported.frames }))

// --- 7. saved files: legacy slideUp and emoji stickers load; the new names save and load
const legacy = await page.evaluate(async () => {
  const { parseProjectJson } = await import('/src/core/project/schema.ts')
  const doc = {
    version: 1, name: 'legacy', format: { ratio: '16:9', width: 1920, height: 1080, fps: 30, background: { type: 'blur' } },
    assets: [], clips: [], texts: [{ id: 't', start: 0, duration: 1000000, text: 'Hi', style: { font: 'Sora', size: 64, color: '#ffffff', outline: null }, pos: { x: 0.5, y: 0.5 }, animIn: 'slideUp', animOut: 'slideUp' }],
    stickers: [], drawings: [], music: [],
    overlays: [
      { id: 'e', kind: 'sticker', start: 0, duration: 1000000, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, emoji: '⭐', size: 0.12, animIn: 'slideUp', animOut: 'slideUp' },
      { id: 'r', kind: 'region', start: 0, duration: 1000000, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, shape: 'rect', effect: 'blur', strength: 0.5, width: 0.3, height: 0.2 }
    ],
    overlays2: undefined
  }
  delete doc.overlays2
  const r = parseProjectJson(JSON.stringify(doc))
  if (!r.ok) return { ok: false, errors: r.errors }
  return { ok: true, text: [r.project.texts[0].animIn, r.project.texts[0].animOut], sticker: [r.project.overlays[0].emoji, r.project.overlays[0].animIn, r.project.overlays[0].animOut] }
})
check('file: a legacy file with slideUp and an emoji sticker loads and maps slideUp to bottom', legacy.ok && legacy.text[0] === 'slideFromBottom' && legacy.text[1] === 'slideToBottom' && legacy.sticker[0] === '⭐' && legacy.sticker[1] === 'slideFromBottom' && legacy.sticker[2] === 'slideToBottom', JSON.stringify(legacy))
const roundTrip = await page.evaluate(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  const { parseProjectJson, serializeProject } = await import('/src/core/project/schema.ts')
  return parseProjectJson(serializeProject(ed.project)).ok
})
check('file: the current project with vector stickers saves and loads', roundTrip === true)

// --- 8a. gallery: every built-in shape drawn by the engine (half of them with an outline)
const shapeIds = await page.evaluate(async () => (await import('/src/core/render/stickerShapes.ts')).STICKER_SHAPE_IDS)
await st('(ed, ids) => { ed.commitProject({ ...ed.project, overlays: ids.map((shape, i) => ({ id: "g" + i, kind: "sticker", start: 0, duration: 9000000, pos: { x: 0.1 + (i % 5) * 0.2, y: 0.12 + Math.floor(i / 5) * 0.19 }, scale: 1, rotation: 0, size: 0.13, shape, color: ["#ff5ca8", "#ffe14d", "#3ab0ff"][i % 3], outline: i % 2 ? "#14121f" : null })) }) }', shapeIds)
await st('(ed) => { ed.setPlayhead(1000000); ed.select(null) }')
await settle(700)
const gallery = await canvasShot()
const { writeFileSync } = await import('node:fs')
writeFileSync(`${SHOTS}/ov3-shapes-light.png`, Buffer.from(gallery, 'base64'))
const drawn = await countColour(gallery, '(r, g, b) => r > 200 && g > 80 && g < 120 && b > 120 && b < 190', [0.05, 0.95, 0.05, 0.95])
check('gallery: the pink shapes are drawn in the preview', drawn > 500, JSON.stringify(drawn))

// --- 8. screenshots: the sticker panel, the draw panel with the marker, and the sticker on the picture
await st('(ed) => { ed.setPlayhead(1000000); ed.select(null) }')
await settle(300)
await page.screenshot({ path: `${SHOTS}/ov3-editor-light.png` })
await page.getByRole('tab', { name: 'Design' }).click()
await page.getByRole('button', { name: 'Stickers', exact: true }).click()
await settle(250)
await page.screenshot({ path: `${SHOTS}/ov3-stickers-light.png` })
await page.getByRole('tab', { name: 'Draw', exact: true }).click().catch(() => page.getByRole('button', { name: 'Draw', exact: true }).click())
await settle(250)
await page.getByRole('button', { name: 'Marker (highlighter)' }).click()
await settle(250)
await page.screenshot({ path: `${SHOTS}/ov3-draw-light.png` })
await page.emulateMedia({ colorScheme: 'dark' })
await settle(250)
await page.screenshot({ path: `${SHOTS}/ov3-stickers-dark.png` })

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
