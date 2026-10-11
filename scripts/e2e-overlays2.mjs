// Real-browser check of the overlay extensions: opacity, entrance / exit / loop animations, blur and pixelate
// areas, and pictures or videos in the picture (picture-in-picture). Pixels are measured in the preview and in
// one exported MP4 frame; undo, save/load and light/dark screenshots are checked too.
// Usage: node scripts/e2e-overlays2.mjs   (exit code 1 when a check fails). Port 5250.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5250
const SHOTS = process.env.OVERLAY_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const VIEW = { width: 1440, height: 900 }
const FIXTURES = ['overlays2-checker.png', 'overlays2-green.webm', 'overlays2-magenta.png']

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
const settle = (ms = 350) => page.waitForTimeout(ms)
const S = 1_000_000

/** Runs fn(editorStore, mediaStore, arg) in the page and returns its value. */
const st = (fn, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = pinia._s.get('editor')
      const me = pinia._s.get('media')
      return new Function('ed', 'me', 'a', `return (${src})(ed, me, a)`)(ed, me, a)
    },
    [fn, arg]
  )

/** Sets a range slider by its accessible name, the way a drag ends: input, then change. */
async function setRange(name, value) {
  await page.getByLabel(name, { exact: true }).evaluate((el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await settle(150)
}

/** Preview picture without the DOM overlay layer (handles and boxes), so only drawn pixels are seen. Base64 PNG. */
async function canvasShot() {
  await page.addStyleTag({ content: '[data-player-overlay]{display:none!important}' })
  await page.waitForTimeout(120)
  const buf = await page.locator('canvas').first().screenshot()
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('data-player-overlay') && s.remove()))
  return buf.toString('base64')
}

/**
 * The picture as it is before the overlays of the playhead's time appear (0.5 s, every overlay here starts at 1 s),
 * in the same side-panel layout as the shot that follows. Comparing shots of different sizes is not meaningful.
 */
async function referenceShot() {
  const t = await st('(ed) => ed.playheadMicros')
  await st('(ed, me, t) => ed.setPlayhead(t)', 500_000)
  await settle(260)
  const shot = await canvasShot()
  await st('(ed, me, t) => ed.setPlayhead(t)', t)
  await settle(260)
  return shot
}

/**
 * Pixel analysis in the page. kinds: 'stats' (count, luminance spread, mean colour, neighbour equality, pixels
 * matching a predicate), 'magnitude' (summed colour change between shots a and b), 'changed' (pixels that changed
 * between a and b). Rectangles are fractions of the picture: [x0, x1, y0, y1].
 */
function analyze(job) {
  return page.evaluate(async (j) => {
    const decode = async (b64, size = null) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const w = size ? size.w : bmp.width
      const h = size ? size.h : bmp.height
      const c = new OffscreenCanvas(w, h)
      const ctx = c.getContext('2d', { willReadFrequently: true })
      // A shot taken with another side panel open can have another size: it is scaled to the first one.
      ctx.drawImage(bmp, 0, 0, w, h)
      return { w, h, d: ctx.getImageData(0, 0, w, h).data }
    }
    const A = await decode(j.a)
    const B = j.b ? await decode(j.b, { w: A.w, h: A.h }) : null
    const [x0, x1, y0, y1] = j.rect
      ? [Math.floor(j.rect[0] * A.w), Math.ceil(j.rect[1] * A.w), Math.floor(j.rect[2] * A.h), Math.ceil(j.rect[3] * A.h)]
      : [0, A.w, 0, A.h]
    const lum = (i) => 0.299 * A.d[i] + 0.587 * A.d[i + 1] + 0.114 * A.d[i + 2]
    if (j.kind === 'pixel') {
      const x = Math.round(j.fx * A.w)
      const y = Math.round(j.fy * A.h)
      let r = 0, g = 0, b = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const i = ((y + dy) * A.w + (x + dx)) * 4
        r += A.d[i]; g += A.d[i + 1]; b += A.d[i + 2]; n++
      }
      return { rgb: [r / n, g / n, b / n] }
    }
    let n = 0, sum = 0, sum2 = 0, sr = 0, sg = 0, sb = 0, same = 0, pairs = 0, matched = 0, mx = 0, my = 0
    let magnitude = 0, changed = 0
    const test = j.predicate ? new Function(`return (${j.predicate})`)() : null
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * A.w + x) * 4
        if (B) {
          const d = Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2])
          magnitude += d
          if (d > 30) changed++
          n++
          continue
        }
        n++
        const L = lum(i)
        sum += L; sum2 += L * L
        sr += A.d[i]; sg += A.d[i + 1]; sb += A.d[i + 2]
        if (x + 1 < x1) {
          const k = i + 4
          pairs++
          if (Math.abs(A.d[i] - A.d[k]) + Math.abs(A.d[i + 1] - A.d[k + 1]) + Math.abs(A.d[i + 2] - A.d[k + 2]) <= 12) same++
        }
        if (test && test(A.d[i], A.d[i + 1], A.d[i + 2])) { matched++; mx += x; my += y }
      }
    }
    if (B) return { n, magnitude, changed }
    const mean = sum / n
    return {
      n,
      lumStd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
      mean: [sr / n, sg / n, sb / n],
      sameNeighbour: pairs ? same / pairs : 0,
      matched,
      cx: matched ? mx / matched / A.w : null,
      cy: matched ? my / matched / A.h : null
    }
  }, job)
}

const isYellow = '(r, g, b) => r > 220 && g > 170 && b < 140 && r - b > 110'
const isGreen = '(r, g, b) => g > 200 && r < 90 && b < 90'
const isMagenta = '(r, g, b) => r > 220 && g < 60 && b > 220'
const isWhite = '(r, g, b) => r > 230 && g > 230 && b > 230'

/** Fraction rectangle of an overlay box (height units to fractions of the picture). */
function boxFrac(item, format, shrink = 0) {
  const aspect = format.width / format.height
  const hw = item.width / (2 * aspect)
  const hh = item.height / 2
  return [item.pos.x - hw + shrink, item.pos.x + hw - shrink, item.pos.y - hh + shrink, item.pos.y + hh - shrink]
}

const overlayNamed = (kind, extra = {}) => (st(`(ed) => ed.project.overlays.filter((o) => o.kind === '${kind}')`)).then((list) => list.filter((o) => Object.entries(extra).every(([k, v]) => o[k] === v)))
const formatNow = () => st('(ed) => ed.project.format')
const itemById = (id) => st('(ed, me, id) => ed.project.overlays.find((o) => o.id === id) ?? null', id)

// --- setup: new project with the test pattern clip, the video and the image in the library
await page.goto(`http://localhost:${PORT}/app/`)
await page.waitForSelector('header')
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
for (const name of FIXTURES) {
  await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures', name))
  await page.waitForFunction((n) => document.body.innerText.includes(n), name)
  await settle(250)
}
await page.getByRole('button', { name: /overlays2-checker\.png/ }).first().click()
await settle(500)
await st('(ed) => { ed.setPlayhead(1000000) }')
await page.waitForSelector('[data-player-overlay]')
await settle(400)

const base = await canvasShot()
const fmt = await formatNow()
const rectAll = [0, 1, 0, 1]
const baseStats = await analyze({ a: base, kind: 'stats', rect: rectAll })
check('setup: the test pattern is drawn (high detail picture)', baseStats.lumStd > 40, JSON.stringify(baseStats.lumStd))

// --- 1. blur area from the quick action, changed by its settings
await page.getByRole('tab', { name: 'Design' }).click()
await page.getByRole('button', { name: 'Stickers', exact: true }).click()
await page.getByRole('button', { name: 'Hide', exact: true }).click()
await page.getByRole('button', { name: 'Blur an area', exact: true }).click()
await settle()
let regions = await overlayNamed('region')
check('blur area: the quick action adds one blur region at the playhead', regions.length === 1 && regions[0].effect === 'blur' && regions[0].start === S && regions[0].shape === 'rect', JSON.stringify(regions))
await st('(ed) => ed.updateSelectedOverlay({ pos: { x: 0.3, y: 0.5 }, width: 0.4, height: 0.5 })')
await settle()
regions = await overlayNamed('region')
const region = regions[0]
const inside = boxFrac(region, fmt, 0.03)
const refBlur = await referenceShot()
const blurShot = await canvasShot()
const blurIn = await analyze({ a: blurShot, kind: 'stats', rect: inside })
const baseIn = await analyze({ a: refBlur, kind: 'stats', rect: inside })
check('blur area: the picture inside is blurred (luminance spread at most 60 % of before)', blurIn.lumStd < 0.6 * baseIn.lumStd, `${blurIn.lumStd} vs ${baseIn.lumStd}`)
const outsideChanged = await analyze({ a: blurShot, b: refBlur, kind: 'changed', rect: [0.0, 1, 0.0, 1] })
const outsideOnly = await analyze({ a: blurShot, b: refBlur, kind: 'changed', rect: [0.0, 0.1, 0.0, 1] })
check('blur area: the picture outside the area is untouched', outsideOnly.changed === 0 && outsideChanged.changed > 1000, JSON.stringify({ outsideOnly, outsideChanged }))

// --- 2. pixelate with the effect select and the strength slider
await page.getByRole('button', { name: 'Pixelate', exact: true }).click()
await setRange('Strength', 100)
await settle()
const pixShot = await canvasShot()
const pixIn = await analyze({ a: pixShot, kind: 'stats', rect: inside })
const basePixIn = await analyze({ a: refBlur, kind: 'stats', rect: inside })
check('pixelate area: the picture inside becomes blocks (neighbours equal)', pixIn.sameNeighbour > 0.85 && basePixIn.sameNeighbour < 0.7, `${pixIn.sameNeighbour} vs ${basePixIn.sameNeighbour}`)
const pixOutside = await analyze({ a: pixShot, b: refBlur, kind: 'changed', rect: [0, 0.1, 0, 1] })
check('pixelate area: outside is untouched', pixOutside.changed === 0, JSON.stringify(pixOutside))

// An ellipse leaves the corners of its box alone; a rectangle is restored for the checks below.
await page.getByRole('button', { name: 'Oval', exact: true }).click()
await settle(300)
const ellipseShot = await canvasShot()
// The very corner of the box lies well outside the ellipse.
const boxCorner = [inside[0], inside[0] + 0.004, inside[2], inside[2] + 0.004]
const ellipseCorner = await analyze({ a: ellipseShot, b: refBlur, kind: 'changed', rect: boxCorner })
const ellipseCentre = await analyze({ a: ellipseShot, kind: 'stats', rect: [0.3 - 0.02, 0.3 + 0.02, 0.5 - 0.02, 0.5 + 0.02] })
check('area shape: an ellipse leaves the corners of its box untouched and pixelates its centre', ellipseCorner.changed === 0 && ellipseCentre.sameNeighbour > 0.85, JSON.stringify({ corner: ellipseCorner.changed, centre: ellipseCentre.sameNeighbour }))
await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
await settle(300)

// --- 3. opacity of the area: 0 shows the picture unchanged; undo brings the setting back
await setRange('Opacity', 0)
await settle()
const hidden = await canvasShot()
const hiddenDiff = await analyze({ a: hidden, b: refBlur, kind: 'changed', rect: rectAll })
check('opacity: an area at 0 % shows the picture unchanged', hiddenDiff.changed === 0, JSON.stringify(hiddenDiff))
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await settle()
const afterUndo = await itemById(region.id)
check('opacity: one undo step restores the opacity of the area', afterUndo.opacity === undefined || afterUndo.opacity === 1, JSON.stringify(afterUndo.opacity))
await setRange('Opacity', 50)
await settle()
await page.evaluate(() => document.activeElement?.blur())

await st('(ed) => ed.setPlayhead(1000000)')
await settle(300)
// Save the area again at full opacity for the rest of the checks.
await st('(ed, me, id) => ed.updateSelectedOverlay({ opacity: 1 })', region.id)
await settle(200)

// --- 4. sticker: fade in, then a wiggle loop
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => undefined)
await page.getByRole('button', { name: 'Stickers', exact: true }).click()
await page.getByRole('button', { name: 'Star', exact: true }).click()
await settle()
let star = (await overlayNamed('sticker'))[0]
check('sticker: a star is added at the playhead', star && star.start === S, JSON.stringify(star))
await page.getByLabel('Enter', { exact: true }).selectOption('fade')
await settle(150)
const refStar = await referenceShot()
// The star's box is about 0.46 to 0.54 of the width; the blur area reaches 0.41.
const starWindow = [0.44, 0.56, 0.38, 0.62]
const starAt = async (t) => {
  await st('(ed, me, t) => ed.setPlayhead(t)', t)
  await settle(260)
  return canvasShot()
}
const shotStart = await starAt(S)
const shotHalf = await starAt(S + 50_000)
const shotFull = await starAt(S + 1_200_000)
const mStart = await analyze({ a: shotStart, b: refStar, kind: 'magnitude', rect: starWindow })
const mHalf = await analyze({ a: shotHalf, b: refStar, kind: 'magnitude', rect: starWindow })
const mFull = await analyze({ a: shotFull, b: refStar, kind: 'magnitude', rect: starWindow })
check('animation: the entrance starts invisible', mStart.magnitude < 500, JSON.stringify(mStart))
check('animation: the entrance fades in over its length', mHalf.magnitude > mStart.magnitude && mHalf.magnitude < 0.4 * mFull.magnitude && mFull.magnitude > 20000, JSON.stringify({ mStart: mStart.magnitude, mHalf: mHalf.magnitude, mFull: mFull.magnitude }))

await page.getByLabel('Loop', { exact: true }).selectOption('wiggle')
await settle(150)
const wiggleA = await starAt(S + 1_500_000)
const wiggleA2 = await starAt(S + 1_500_000)
const wiggleB = await starAt(S + 1_725_000)
const still = await analyze({ a: wiggleA, b: wiggleA2, kind: 'magnitude', rect: starWindow })
const swung = await analyze({ a: wiggleA, b: wiggleB, kind: 'magnitude', rect: starWindow })
check('animation: a wiggle loop changes the picture over time, but not at the same instant', swung.magnitude > 20 * (still.magnitude + 1) && swung.magnitude > 30000, JSON.stringify({ still: still.magnitude, swung: swung.magnitude }))
star = (await overlayNamed('sticker'))[0]
check('animation: the anchor stays where it was placed', Math.abs(star.pos.x - 0.5) < 1e-9 && star.loop === 'wiggle' && star.animIn === 'fade', JSON.stringify(star))

// --- 5. a rectangle frame with opacity 50 %: the drawn line is half as strong as at 100 %
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => undefined)
await st('(ed, me) => ed.setPlayhead(1000000)')
await settle(300)
await page.getByRole('button', { name: 'Shapes', exact: true }).click()
await page.getByRole('button', { name: 'Frame', exact: true }).click()
await settle()
await st('(ed, me) => ed.setPlayhead(1000000)')
await settle(300)
const refFrame = await referenceShot()
const frameFull = await canvasShot()
const frameMagFull = await analyze({ a: frameFull, b: refFrame, kind: 'magnitude', rect: [0.55, 0.75, 0.37, 0.43] })
await setRange('Opacity', 50)
await settle()
const frameHalf = await canvasShot()
const frameMagHalf = await analyze({ a: frameHalf, b: refFrame, kind: 'magnitude', rect: [0.55, 0.75, 0.37, 0.43] })
const ratio = frameMagHalf.magnitude / frameMagFull.magnitude
check('opacity: the rectangle at 50 % changes the picture about half as much as at 100 %', frameMagFull.magnitude > 5000 && ratio > 0.4 && ratio < 0.6, JSON.stringify({ full: frameMagFull.magnitude, half: frameMagHalf.magnitude, ratio }))
await page.evaluate(() => document.activeElement?.blur())
await st('(ed) => ed.undo()')
await settle()
check('undo: undoing the opacity change restores the full rectangle', (await itemById((await overlayNamed('shape'))[0].id)).opacity === undefined)

// --- 6. picture: library image with rounded corners and a border
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => undefined)
await page.getByRole('button', { name: 'Picture in picture', exact: true }).click()
await page.getByRole('button', { name: 'Add overlays2-magenta.png at the playhead' }).click()
await settle()
const pic = (await overlayNamed('media'))[0]
check('picture: the image is added at the playhead with its own shape', pic && pic.start === S && Math.abs(pic.width / pic.height - 16 / 9) < 0.01, JSON.stringify(pic))
await st('(ed, me, id) => ed.updateSelectedOverlay({ pos: { x: 0.8, y: 0.75 }, width: 0.4, height: 0.3 })', pic.id)
await page.getByRole('button', { name: 'Rounded', exact: true }).click()
await st('(ed, me, id) => ed.updateSelectedOverlay({ width: 0.4, height: 0.3 })', pic.id)
await settle(150)
await setRange('Border width', 8)
await settle(250)
const refPic = await referenceShot()
const picShot = await canvasShot()
const picBox = boxFrac({ ...pic, pos: { x: 0.8, y: 0.75 }, width: 0.4, height: 0.3 }, fmt)
const centre = await analyze({ a: picShot, kind: 'stats', rect: [0.8 - 0.01, 0.8 + 0.01, 0.75 - 0.01, 0.75 + 0.01], predicate: isMagenta })
check('picture: the image shows in its box (magenta at the centre)', centre.matched > 100, JSON.stringify(centre.matched))
const corner = await analyze({ a: picShot, b: refPic, kind: 'changed', rect: [picBox[0] + 0.0003, picBox[0] + 0.002, picBox[2] + 0.0003, picBox[2] + 0.002] })
check('picture: rounded corners leave the corner of the box as it was', corner.changed === 0, JSON.stringify(corner))
const edge = await analyze({ a: picShot, kind: 'stats', rect: [picBox[0] + 0.0008, picBox[0] + 0.0034, 0.73, 0.77], predicate: isWhite })
check('picture: the border is drawn inside the edge', edge.matched > 5, JSON.stringify(edge.matched))

// --- 7. video in the picture: green video from the library, muted, plays in the preview
await st('(ed) => ed.setPlayhead(1500000)')
await settle(200)
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => undefined)
await page.getByRole('button', { name: 'Picture in picture', exact: true }).click()
await page.getByRole('button', { name: 'Add overlays2-green.webm at the playhead' }).click()
await settle(300)
const vid = (await overlayNamed('media')).find((o) => o.assetId !== pic.assetId)
check('video picture: the video is added and selected', !!vid && vid.start === 1500000, JSON.stringify(vid))
await st('(ed, me, id) => ed.updateSelectedOverlay({ pos: { x: 0.2, y: 0.75 }, width: 0.3, height: 0.2 })', vid.id)
await settle(400)
const vidShot = await canvasShot()
const vidGreen = await analyze({ a: vidShot, kind: 'stats', rect: [0.2 - 0.02, 0.2 + 0.02, 0.75 - 0.02, 0.75 + 0.02], predicate: isGreen })
check('video picture: the first frame of the video shows in its box', vidGreen.matched > 200, JSON.stringify(vidGreen.matched))
await st('(ed) => { ed.setPlayhead(1500000); ed.togglePlaying() }')
await page.waitForTimeout(500)
const playing = await page.evaluate(() => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  return pinia._s.get('editor').isPlaying
})
// Pause before the shot: taking it takes a while, and the picture only lasts from 1.5 s to 4 s.
await st('(ed) => ed.togglePlaying()')
await settle(300)
const playT = await st('(ed) => ed.playheadMicros')
const playShot = await canvasShot()
const playGreen = await analyze({ a: playShot, kind: 'stats', rect: [0.2 - 0.02, 0.2 + 0.02, 0.75 - 0.02, 0.75 + 0.02], predicate: isGreen })
check('video picture: it plays with the timeline (it was playing, and the picture is shown at the stopped time)', playing && playT > 1_500_000 && playT < 4_000_000 && playGreen.matched > 200, JSON.stringify({ playing, playT, matched: playGreen.matched }))

// --- 8. export: one frame with all overlays, and the same project without overlays
const exported = await page.evaluate(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  const mod = (p) => import(p)
  const { runExport } = await mod('/src/engine/export/exporter.ts')
  const { ExactFrameProvider } = await mod('/src/engine/media/frames.ts')
  const { frameStart } = await mod('/src/core/time.ts')
  const files = {}
  for (const asset of ed.project.assets) {
    files[asset.id] = new File([await (await fetch(`/tests/fixtures/${asset.name}`)).blob()], asset.name)
  }
  const sample = async (overlays) => {
    const p = { ...JSON.parse(JSON.stringify(ed.project)), overlays }
    const res = await runExport({ project: p, files, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, () => undefined, new AbortController().signal)
    const provider = new ExactFrameProvider()
    provider.setFile('out', new File([res.blob], 'out.mp4'), false)
    const frame = await provider.getFrame('out', frameStart(48, 30))
    const w = frame.displayWidth ?? frame.width
    const h = frame.displayHeight ?? frame.height
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(frame, 0, 0)
    const data = ctx.getImageData(0, 0, w, h).data
    await provider.dispose()
    const png = await c.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await png.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { frames: res.frames, w, h, png: btoa(bin), data: Array.from(data) }
  }
  const withOverlays = ed.project.overlays.map((o) => ({ ...o, start: o.kind === 'media' && o.assetId !== ed.project.overlays.find((x) => x.kind === 'media')?.assetId ? 1500000 : Math.min(o.start, 1000000) }))
  const plain = await sample([])
  const full = await sample(withOverlays)
  return { plain: { frames: plain.frames, w: plain.w, h: plain.h, png: plain.png }, full: { frames: full.frames, w: full.w, h: full.h, png: full.png }, count: withOverlays.length }
})
check('export: the duration is the same with and without overlays', exported.full.frames === exported.plain.frames && exported.plain.frames > 60, JSON.stringify([exported.plain.frames, exported.full.frames]))
const expPlain = exported.plain.png
const expFull = exported.full.png
const expOutside = await analyze({ a: expFull, b: expPlain, kind: 'changed', rect: [0, 0.1, 0, 1] })
check('export: the picture outside the blur area is the same as without overlays', expOutside.changed < 0.01 * expOutside.n, JSON.stringify(expOutside))
const expPixIn = await analyze({ a: expFull, kind: 'stats', rect: inside })
const expPlainIn = await analyze({ a: expPlain, kind: 'stats', rect: inside })
check('export: the pixelate area is made of blocks in the exported frame', expPixIn.sameNeighbour > 0.85 && expPlainIn.sameNeighbour < 0.7, `${expPixIn.sameNeighbour} vs ${expPlainIn.sameNeighbour}`)
const expStar = await analyze({ a: expFull, b: expPlain, kind: 'magnitude', rect: starWindow })
check('export: the star is drawn in the exported frame', expStar.magnitude > 3000, JSON.stringify(expStar))
const expMagenta = await analyze({ a: expFull, kind: 'stats', rect: [0.8 - 0.04, 0.8 + 0.04, 0.75 - 0.04, 0.75 + 0.04], predicate: isMagenta })
check('export: the picture is in the exported frame', expMagenta.matched > 300, JSON.stringify(expMagenta.matched))
const expGreen = await analyze({ a: expFull, kind: 'stats', rect: [0.2 - 0.04, 0.2 + 0.04, 0.75 - 0.04, 0.75 + 0.04], predicate: isGreen })
check('export: the video picture is in the exported frame', expGreen.matched > 300, JSON.stringify(expGreen.matched))

// --- 9. document: the file keeps the new fields
const roundTrip = await page.evaluate(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  const { parseProjectJson, serializeProject } = await import('/src/core/project/schema.ts')
  const result = parseProjectJson(serializeProject(ed.project))
  return { ok: result.ok, kinds: ed.project.overlays.map((o) => o.kind) }
})
check('file: the project with the new fields saves and loads', roundTrip.ok === true, JSON.stringify(roundTrip))

// --- 10. screenshots, light and dark: the editor, the new panel sections and the settings of an area and a picture
await st('(ed, me, id) => ed.select({ kind: "overlay", id })', region.id)
await settle()
await page.screenshot({ path: `${SHOTS}/ov2-light.png` })
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => undefined)
await page.getByRole('button', { name: 'Hide', exact: true }).click()
await page.getByRole('button', { name: 'Blur an area', exact: true }).scrollIntoViewIfNeeded()
await settle()
await page.screenshot({ path: `${SHOTS}/ov2-panel-light.png` })
await st('(ed, me, id) => ed.select({ kind: "overlay", id })', pic.id)
await settle()
await page.getByRole('button', { name: 'Rounded', exact: true }).scrollIntoViewIfNeeded()
await page.screenshot({ path: `${SHOTS}/ov2-props-light.png` })
await page.emulateMedia({ colorScheme: 'dark' })
await settle()
await page.screenshot({ path: `${SHOTS}/ov2-dark.png` })
await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => undefined)
await page.getByRole('button', { name: 'Hide', exact: true }).click()
await page.getByRole('button', { name: 'Blur an area', exact: true }).scrollIntoViewIfNeeded()
await settle()
await page.screenshot({ path: `${SHOTS}/ov2-panel-dark.png` })

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
