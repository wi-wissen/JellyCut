// End-to-end check of the WebGL2 compositor in a real Chromium: pixel assertions on readPixels().
// Usage: node scripts/e2e-render.mjs   (env SHOT_DIR=<dir> overrides where the PNG screenshots go)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'

const PORT = 5194
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${root}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return `${root}/${dir}/chrome-linux/chrome`
}

// Everything that touches pixels runs in the page; it returns plain results to be printed here.
const pageScenario = async () => {
  const { Compositor } = await import('/src/engine/render/compositor.ts')
  const checks = []
  const glErrors = []
  const shots = {}

  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail: String(detail) })
  const makeCanvas = (w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  const solid = (w, h, [r, g, b]) => {
    const c = makeCanvas(w, h)
    const ctx = c.getContext('2d')
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, w, h)
    return c
  }
  // Left half red, right half blue, thin white diagonal from top-left to bottom-right.
  const splitFrame = (w, h) => {
    const c = makeCanvas(w, h)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, w / 2, h)
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(w / 2, 0, w / 2, h)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(w, h)
    ctx.stroke()
    return c
  }
  const px = (data, w, x, y) => {
    const i = (y * w + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }
  const near = (c, e, tol) => Math.abs(c[0] - e[0]) <= tol && Math.abs(c[1] - e[1]) <= tol && Math.abs(c[2] - e[2]) <= tol
  const isRed = (c) => c[0] > 200 && c[1] < 60 && c[2] < 60
  const isBlue = (c) => c[2] > 200 && c[0] < 60 && c[1] < 60
  const isBlack = (c) => c[0] < 6 && c[1] < 6 && c[2] < 6
  const maxDiff = (a, b) => {
    let m = 0
    for (let i = 0; i < a.length; i++) {
      if (i % 4 === 3) continue
      m = Math.max(m, Math.abs(a[i] - b[i]))
    }
    return m
  }
  const fmt = (w, h, background = { type: 'blur' }) => ({ ratio: '16:9', width: w, height: h, fps: 30, background })
  const T = (over = {}) => ({ fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false, ...over })
  const L = (clipId, transform = T(), transition = null) => ({ clipId, assetId: clipId, srcTime: 0, transform, transition })
  const scene = (format, videos, texts = []) => ({ time: 0, format, videos, overlays: [], texts })
  const frames = (...pairs) => new Map(pairs)

  const canvas = makeCanvas(10, 10)
  const comp = new Compositor(canvas)
  const render = (sc, fr) => {
    comp.draw(sc, fr)
    glErrors.push(comp.lastGlError())
    return comp.readPixels()
  }
  const bboxWhite = (data, w, h) => {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = px(data, w, x, y)
        if (c[0] > 200 && c[1] > 200 && c[2] > 200) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
        }
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }

  // (a) fit, 16:9 frame in a 9:16 output: blurred background bars
  const W_A = 180, H_A = 320
  const green = solid(320, 180, [0, 200, 0])
  let d = render(scene(fmt(W_A, H_A), [L('g')]), frames(['g', green]))
  check('(a) fit: centre pixel is the frame colour', near(px(d, W_A, 90, 160), [0, 200, 0], 12), px(d, W_A, 90, 160))
  const tl = px(d, W_A, 2, 2)
  check('(a) fit: top-left bar is not black and in the frame colour family', tl[1] > 100 && tl[0] < 40 && tl[2] < 40, tl)
  const bottomBar = px(d, W_A, 2, H_A - 3)
  check('(a) fit: bottom bar is also blurred frame colour', bottomBar[1] > 100 && bottomBar[0] < 40, bottomBar)
  const split = splitFrame(320, 180)
  d = render(scene(fmt(W_A, H_A), [L('s')]), frames(['s', split]))
  const barA = px(d, W_A, 88, 20)
  const barB = px(d, W_A, 92, 20)
  check('(a) fit: bar over the colour boundary is a blend, not red or blue', barA[0] > 40 && barA[2] > 40 && !isRed(barA) && !isBlue(barA), barA)
  check('(a) fit: bar pixels next to each other differ little (blurred)', maxDiff(barA, barB) <= 60, `diff ${maxDiff(barA, barB)}`)
  check('(a) fit: picture pixel is sharp (red/blue split at centre-left)', isRed(px(d, W_A, 45, 160)) && isBlue(px(d, W_A, 135, 160)), px(d, W_A, 45, 160))
  const picture = makeCanvas(1280, 720)
  {
    const ctx = picture.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, 720)
    g.addColorStop(0, '#2b6cb0')
    g.addColorStop(1, '#f6ad55')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1280, 720)
    ctx.fillStyle = '#fefcbf'
    ctx.beginPath(); ctx.arc(900, 260, 110, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#22543d'
    ctx.beginPath(); ctx.moveTo(0, 720); ctx.lineTo(300, 380); ctx.lineTo(620, 720); ctx.fill()
    ctx.fillStyle = '#1a202c'
    ctx.beginPath(); ctx.moveTo(420, 720); ctx.lineTo(820, 300); ctx.lineTo(1280, 720); ctx.fill()
  }
  // Screenshot: landscape picture in a portrait output, blurred bars
  render(scene(fmt(360, 640), [L('pic')]), frames(['pic', picture]))
  shots['fit-blur'] = canvas.toDataURL('image/png')

  // (b) colour background: bars exactly that colour
  d = render(scene(fmt(W_A, H_A, { type: 'color', color: '#204080' }), [L('g')]), frames(['g', green]))
  check('(b) colour background: top-left bar exact', near(px(d, W_A, 2, 2), [32, 64, 128], 2), px(d, W_A, 2, 2))
  check('(b) colour background: bottom-right bar exact', near(px(d, W_A, W_A - 3, H_A - 3), [32, 64, 128], 2), px(d, W_A, W_A - 3, H_A - 3))

  // (c) fill: frame covers everything
  d = render(scene(fmt(W_A, H_A), [L('s', T({ fit: 'fill' }))]), frames(['s', split]))
  const fillTL = px(d, W_A, 2, 2)
  const fillBR = px(d, W_A, W_A - 3, H_A - 3)
  check('(c) fill: top-left corner is frame red', isRed(fillTL), fillTL)
  check('(c) fill: bottom-right corner is frame blue', isBlue(fillBR), fillBR)
  check('(c) fill: left middle is not a bar', isRed(px(d, W_A, 2, 160)), px(d, W_A, 2, 160))

  // (d) geometry on black background, so the picture edge is unambiguous
  const black = fmt(W_A, H_A, { type: 'color', color: '#000000' })
  d = render(scene(black, [L('s')]), frames(['s', split]))
  check('(d) baseline: left picture pixel is red', isRed(px(d, W_A, 20, 160)), px(d, W_A, 20, 160))
  d = render(scene(black, [L('s', T({ flipX: true }))]), frames(['s', split]))
  check('(d) flipX: left and right colours swap (left is blue)', isBlue(px(d, W_A, 20, 160)), px(d, W_A, 20, 160))
  check('(d) flipX: right is red', isRed(px(d, W_A, 160, 160)), px(d, W_A, 160, 160))
  d = render(scene(black, [L('s', T({ rotation: 90 }))]), frames(['s', split]))
  check('(d) rotation 90: picture top (90,74) is red (left half moved to the top)', isRed(px(d, W_A, 90, 74)), px(d, W_A, 90, 74))
  check('(d) rotation 90: picture bottom (90,246) is blue', isBlue(px(d, W_A, 90, 246)), px(d, W_A, 90, 246))
  check('(d) rotation 90: visual height is 180 px (no picture above y=70)', isBlack(px(d, W_A, 90, 66)), px(d, W_A, 90, 66))
  check('(d) rotation 90: outside visual width (x=30) is black', isBlack(px(d, W_A, 30, 160)), px(d, W_A, 30, 160))
  d = render(scene(black, [L('s', T({ scale: 0.5 }))]), frames(['s', split]))
  check('(d) scale 0.5: inside the smaller picture is picture', isRed(px(d, W_A, 60, 160)) && isBlue(px(d, W_A, 120, 160)), `${px(d, W_A, 60, 160)} ${px(d, W_A, 120, 160)}`)
  check('(d) scale 0.5: above the smaller picture is black', isBlack(px(d, W_A, 90, 120)), px(d, W_A, 90, 120))
  d = render(scene(black, [L('s', T({ scale: 0.5, x: 0.25 }))]), frames(['s', split]))
  check('(d) x +0.25: picture moves right (x=100 red, x=85 black)', isRed(px(d, W_A, 100, 160)) && isBlack(px(d, W_A, 85, 160)), `${px(d, W_A, 100, 160)} ${px(d, W_A, 85, 160)}`)
  d = render(scene(black, [L('s', T({ scale: 0.5, y: 0.25 }))]), frames(['s', split]))
  check('(d) y +0.25: positive y moves DOWN (60,240 red, 60,160 black)', isRed(px(d, W_A, 60, 240)) && isBlack(px(d, W_A, 60, 160)), `${px(d, W_A, 60, 240)} ${px(d, W_A, 60, 160)}`)
  d = render(scene(black, [L('s', T({ scale: 0.5, y: -0.25 }))]), frames(['s', split]))
  check('(d) y -0.25: moves UP (60,80 red, 60,240 black)', isRed(px(d, W_A, 60, 80)) && isBlack(px(d, W_A, 60, 240)), `${px(d, W_A, 60, 80)} ${px(d, W_A, 60, 240)}`)

  // (e) transitions, 320x180 frames into a 160x90 output
  const W_T = 160, H_T = 90
  const red = solid(320, 180, [255, 0, 0])
  const blue = solid(320, 180, [0, 0, 255])
  const green2 = solid(320, 180, [0, 255, 0])
  const trFrames = frames(['A', red], ['B', blue])
  const tr = (type, progress, role = 'from') => ({ type, progress, role })
  const pair = (type, progress, a = red, b = blue) => {
    const sc = scene(fmt(W_T, H_T), [L('A', T(), tr(type, progress, 'from')), L('B', T(), tr(type, progress, 'to'))])
    return render(sc, frames(['A', a], ['B', b]))
  }
  let f0 = pair('fade', 0)
  check('(e) fade p=0 is A (red)', isRed(px(f0, W_T, 80, 45)), px(f0, W_T, 80, 45))
  let f5 = pair('fade', 0.5)
  const mid = px(f5, W_T, 80, 45)
  check('(e) fade p=0.5 is the mix (about 50/50, +-3%)', near(mid, [128, 0, 128], 8), mid)
  let f1 = pair('fade', 1)
  check('(e) fade p=1 is B (blue)', isBlue(px(f1, W_T, 80, 45)), px(f1, W_T, 80, 45))
  const wl = pair('wipeLeft', 0.5)
  check('(e) wipeLeft p=0.5: right half is B, left half is A', isRed(px(wl, W_T, 20, 45)) && isBlue(px(wl, W_T, 140, 45)), `${px(wl, W_T, 20, 45)} ${px(wl, W_T, 140, 45)}`)
  const wr = pair('wipeRight', 0.5)
  check('(e) wipeRight p=0.5: B enters from the left', isBlue(px(wr, W_T, 20, 45)) && isRed(px(wr, W_T, 140, 45)), `${px(wr, W_T, 20, 45)} ${px(wr, W_T, 140, 45)}`)
  const wu = pair('wipeUp', 0.5)
  check('(e) wipeUp p=0.5: B enters from the bottom', isRed(px(wu, W_T, 80, 10)) && isBlue(px(wu, W_T, 80, 80)), `${px(wu, W_T, 80, 10)} ${px(wu, W_T, 80, 80)}`)
  const wd = pair('wipeDown', 0.5)
  check('(e) wipeDown p=0.5: B enters from the top', isBlue(px(wd, W_T, 80, 10)) && isRed(px(wd, W_T, 80, 80)), `${px(wd, W_T, 80, 10)} ${px(wd, W_T, 80, 80)}`)
  const pushA = split
  const slL = pair('slideLeft', 0.5, pushA, green2)
  check('(e) slideLeft p=0.5: A moved left (left shows A right half, blue)', isBlue(px(slL, W_T, 20, 45)), px(slL, W_T, 20, 45))
  check('(e) slideLeft p=0.5: B occupies the right half (green)', near(px(slL, W_T, 140, 45), [0, 255, 0], 2), px(slL, W_T, 140, 45))
  const slR = pair('slideRight', 0.5, pushA, green2)
  check('(e) slideRight p=0.5: B occupies the left half (green)', near(px(slR, W_T, 20, 45), [0, 255, 0], 2), px(slR, W_T, 20, 45))
  check('(e) slideRight p=0.5: A moved right (right shows A left half, red)', isRed(px(slR, W_T, 140, 45)), px(slR, W_T, 140, 45))
  const single = (clip, fr) => render(scene(fmt(W_T, H_T), [L(clip)]), frames([clip, fr]))
  const singleSplit = single('A', pushA)
  const singleGreen = single('B', green2)
  check('(e) slideLeft p=0 equals A alone', maxDiff(pair('slideLeft', 0, pushA, green2), singleSplit) <= 2, maxDiff(pair('slideLeft', 0, pushA, green2), singleSplit))
  check('(e) slideLeft p=1 equals B alone', maxDiff(pair('slideLeft', 1, pushA, green2), singleGreen) <= 2, '')
  const zIn0 = pair('zoomIn', 0, pushA, green2)
  check('(e) zoomIn p=0 equals A alone', maxDiff(zIn0, singleSplit) <= 2, maxDiff(zIn0, singleSplit))
  const zIn1 = pair('zoomIn', 1, pushA, green2)
  check('(e) zoomIn p=1 equals B alone', maxDiff(zIn1, singleGreen) <= 2, maxDiff(zIn1, singleGreen))
  check('(e) zoomIn p=0.5 differs from A', maxDiff(pair('zoomIn', 0.5, pushA, green2), singleSplit) > 30, '')
  const zOut0 = pair('zoomOut', 0, pushA, green2)
  check('(e) zoomOut p=0 equals A alone', maxDiff(zOut0, singleSplit) <= 2, maxDiff(zOut0, singleSplit))
  const zOut1 = pair('zoomOut', 1, pushA, green2)
  check('(e) zoomOut p=1 equals B alone', maxDiff(zOut1, singleGreen) <= 2, maxDiff(zOut1, singleGreen))
  const bl0 = pair('blur', 0, pushA, green2)
  check('(e) blur p=0 equals A alone', maxDiff(bl0, singleSplit) <= 2, maxDiff(bl0, singleSplit))
  const bl1 = pair('blur', 1, pushA, green2)
  check('(e) blur p=1 equals B alone', maxDiff(bl1, singleGreen) <= 2, maxDiff(bl1, singleGreen))
  check('(e) unknown transition type behaves like fade', maxDiff(pair('nope', 0.5), pair('fade', 0.5)) <= 1, maxDiff(pair('nope', 0.5), pair('fade', 0.5)))

  // (f) text
  const W_X = 320, H_X = 180
  const textStyle = (over = {}) => ({ font: 'Sora', size: 216, color: '#ffffff', outline: null, ...over })
  const textScene = (texts, bg = '#000000', w = W_X, h = H_X) =>
    scene(fmt(w, h, { type: 'color', color: bg }), [], texts)
  const txt = (over = {}) => ({ id: 't', text: 'Hello', style: textStyle(), pos: { x: 0.5, y: 0.5 }, alpha: 1, scale: 1, offsetY: 0, ...over })
  d = render(textScene([txt()]), new Map())
  const hello = bboxWhite(d, W_X, H_X)
  check('(f) text: white text changes pixels in the centre', hello.w > 10 && hello.h > 5, JSON.stringify(hello))
  check('(f) text: centred at pos (0.5, 0.5)', Math.abs((hello.x0 + hello.x1) / 2 - W_X / 2) <= 4 && Math.abs((hello.y0 + hello.y1) / 2 - H_X / 2) <= 4, JSON.stringify(hello))
  check('(f) text: corners stay background', [[2, 2], [W_X - 3, 2], [2, H_X - 3], [W_X - 3, H_X - 3]].every(([x, y]) => isBlack(px(d, W_X, x, y))), '')
  d = render(textScene([txt({ alpha: 0.5 })], '#646464'), new Map())
  let lo = 255, hi = 0
  for (let y = hello.y0; y <= hello.y1; y++) for (let x = hello.x0; x <= hello.x1; x++) {
    const v = px(d, W_X, x, y)[0]
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  check('(f) alpha 0.5: text blends with the grey background (max about 177)', hi >= 168 && hi <= 186, `max ${hi}`)
  check('(f) alpha 0.5: no dark fringe (min not below background 100)', lo >= 98, `min ${lo}`)
  d = render(textScene([txt({ style: textStyle({ outline: '#ff0000' }) })], '#646464'), new Map())
  let greyFringe = 0
  let reddish = 0
  let whiteish = 0
  for (let y = 0; y < H_X; y++) for (let x = 0; x < W_X; x++) {
    const c = px(d, W_X, x, y)
    if (c[0] > 200 && c[1] < 90 && c[2] < 90) reddish++
    if (c[0] > 200 && c[1] > 200 && c[2] > 200) whiteish++
    if (c[0] < 98 && c[0] > 6) greyFringe++
  }
  check('(f) outline: a red outline is drawn', reddish > 20, `red pixels ${reddish}`)
  check('(f) outline: the white fill is still drawn', whiteish > 20, `white pixels ${whiteish}`)
  check('(f) outline: no dark fringe below the grey background', greyFringe === 0, `dark pixels ${greyFringe}`)
  const big = (() => {
    comp.resize(640, 360)
    const data = render(textScene([txt()], '#000000', 640, 360), new Map())
    return bboxWhite(data, 640, 360)
  })()
  comp.resize(W_X, H_X)
  check('(f) size scales with output height (2x height gives about 2x text)', big.w / hello.w > 1.85 && big.w / hello.w < 2.15 && big.h / hello.h > 1.85 && big.h / hello.h < 2.15, `w ${hello.w}->${big.w} h ${hello.h}->${big.h}`)
  d = render(textScene([txt({ text: 'Hello\nHello' })]), new Map())
  const two = bboxWhite(d, W_X, H_X)
  check('(f) multi-line text stacks lines (taller than one line)', two.h > hello.h * 1.5, `${hello.h} -> ${two.h}`)
  d = render(textScene([txt({ alpha: 0.5, offsetY: 0.25 })]), new Map())
  const moved = bboxWhite(d, W_X, H_X)
  check('(f) offsetY moves the text down by a fraction of the height', (moved.y0 + moved.y1) / 2 - H_X / 2 > 35, `centre y ${(moved.y0 + moved.y1) / 2}`)
  // Screenshots: text over the blurred background, and a slide transition mid-way
  comp.resize(640, 360)
  render(scene(fmt(640, 360), [L('pic')], [txt({ text: 'Hello\nJellyCut', style: textStyle({ size: 150, outline: '#1a202c' }) })]), frames(['pic', picture]))
  shots.text = canvas.toDataURL('image/png')
  render(scene(fmt(640, 360), [L('A', T(), tr('slideLeft', 0.4, 'from')), L('B', T(), tr('slideLeft', 0.4, 'to'))]), frames(['A', picture], ['B', green2]))
  shots.transition = canvas.toDataURL('image/png')
  comp.resize(W_X, H_X)

  // (g) resize
  comp.resize(200, 100)
  d = render(scene(fmt(W_X, H_X), [L('g')]), frames(['g', green]))
  check('(g) resize: output buffer has the resized length', d.length === 200 * 100 * 4, `length ${d.length}`)
  check('(g) resize: resized picture still fills the output', near(px(d, 200, 100, 50), [0, 200, 0], 12), px(d, 200, 100, 50))

  // Robustness
  comp.resize(W_X, H_X)
  const defaultFit = render(scene(fmt(W_X, H_X, { type: 'color', color: '#000000' }), [L('g')]), frames(['g', green]))
  const nanT = render(scene(fmt(W_X, H_X, { type: 'color', color: '#000000' }), [L('g', { fit: 'fit', scale: NaN, x: NaN, y: Infinity, rotation: NaN, flipX: false })]), frames(['g', green]))
  check('(robust) NaN and Infinity transform values fall back to defaults', maxDiff(defaultFit, nanT) === 0, `diff ${maxDiff(defaultFit, nanT)}`)
  const emptyFrame = makeCanvas(0, 0)
  d = render(scene(fmt(W_X, H_X, { type: 'color', color: '#204080' }), [L('e')]), frames(['e', emptyFrame]))
  check('(robust) zero-sized frame draws only the background', near(px(d, W_X, 2, 2), [32, 64, 128], 2), px(d, W_X, 2, 2))
  d = render(scene(fmt(W_X, H_X, { type: 'color', color: '#204080' }), [L('missing')]), frames())
  check('(robust) missing frame draws only the background', near(px(d, W_X, 160, 90), [32, 64, 128], 2), px(d, W_X, 160, 90))
  d = render(scene(fmt(W_X, H_X), [L('missing')]), frames())
  check('(robust) missing frame with blur background is black', isBlack(px(d, W_X, 160, 90)), px(d, W_X, 160, 90))
  d = render(scene(fmt(W_X, H_X), []), frames())
  check('(robust) scene without videos is black and opaque', isBlack(px(d, W_X, 5, 5)) && px(d, W_X, 5, 5)[3] === 255, px(d, W_X, 5, 5))
  d = render(scene(fmt(W_X, H_X), [L('g')]), frames(['g', green]))
  check('(robust) output alpha is opaque (255 everywhere sampled)', px(d, W_X, 0, 0)[3] === 255 && px(d, W_X, 159, 89)[3] === 255, '')

  // (i) colour grade: filters and adjustments, in the picture and in the blurred background
  const { resolveGrade, applyGrade } = await import('/src/core/filters/filters.ts')
  const { clipGrade } = await import('/src/core/filters/ops.ts')
  const grade = (filter, filterAmount, adjust) => resolveGrade(filter, filterAmount, adjust)
  const G = (over = {}) => ({ clipId: 'g', assetId: 'g', srcTime: 0, transform: T(), transition: null, grade: null, ...over })
  const gradedScene = (g, w = W_X, h = H_X, videos = null) => scene(fmt(w, h, { type: 'color', color: '#000000' }), videos ?? [G({ grade: g })])
  const renderSized = (w, h, sc, fr) => {
    comp.resize(w, h)
    const data = render(sc, fr)
    comp.resize(W_X, H_X)
    return data
  }
  const rgbOf = (c) => [c[0], c[1], c[2]]
  const expectPx = (g, rgb) => applyGrade(g, rgb.map((v) => v / 255)).map((v) => v * 255)
  const within = (c, e, tol) => c.every((v, i) => Math.abs(v - e[i]) <= tol)
  const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const coloured = solid(W_X, H_X, [200, 60, 30])
  const greyFrame = solid(W_X, H_X, [128, 128, 128])
  const greyScene = frames(["g", greyFrame])

  d = render(gradedScene(grade('blackWhite', 1, undefined)), frames(['g', coloured]))
  const bw = px(d, W_X, 160, 90)
  check('(i) black & white: a coloured frame is grey (r=g=b within 2)', Math.abs(bw[0] - bw[1]) <= 2 && Math.abs(bw[1] - bw[2]) <= 2, bw)
  check('(i) black & white: value equals the luma of the source', Math.abs(bw[0] - lumaOf([200, 60, 30])) <= 2, `${bw[0]} vs ${lumaOf([200, 60, 30]).toFixed(1)}`)

  d = render(gradedScene(grade('sepia', 1, undefined)), greyScene)
  const sep = px(d, W_X, 160, 90)
  check('(i) sepia: r > g > b on a grey frame', sep[0] > sep[1] && sep[1] > sep[2] + 5, sep)

  d = render(gradedScene(grade(null, 1, { brightness: 0.4, contrast: 0, saturation: 0 })), greyScene)
  const bright = px(d, W_X, 160, 90)
  const brightExpected = expectPx(grade(null, 1, { brightness: 0.4, contrast: 0, saturation: 0 }), [128, 128, 128])
  check('(i) brightness +0.4 raises mid grey by about 25 (+-3)', within(rgbOf(bright), brightExpected, 3) && bright[0] - 128 > 22 && bright[0] - 128 < 29, `${bright[0]} expected ${brightExpected[0].toFixed(1)}`)

  d = render(gradedScene(grade(null, 1, { brightness: 0, contrast: 0.5, saturation: 0 })), frames(['g', coloured]))
  const con = px(d, W_X, 160, 90)
  const conExpected = expectPx(grade(null, 1, { brightness: 0, contrast: 0.5, saturation: 0 }), [200, 60, 30])
  check('(i) contrast +0.5 matches the model (+-3)', within(rgbOf(con), conExpected, 3), `${con} expected ${conExpected.map((v) => v.toFixed(1))}`)
  d = render(gradedScene(grade(null, 1, { brightness: 0, contrast: 0, saturation: 0 })), greyScene)
  check('(i) contrast 0 leaves mid grey exact', maxDiff(d, render(scene(fmt(W_X, H_X, { type: 'color', color: '#000000' }), [G()]), greyScene)) === 0 && px(d, W_X, 160, 90)[0] === 128, px(d, W_X, 160, 90))

  d = render(gradedScene(grade(null, 1, { brightness: 0, contrast: 0, saturation: -1 })), frames(['g', coloured]))
  const desat = px(d, W_X, 160, 90)
  check('(i) saturation -1 gives a grey (r=g=b within 2)', Math.abs(desat[0] - desat[1]) <= 2 && Math.abs(desat[1] - desat[2]) <= 2, desat)

  const full = render(gradedScene(grade('vivid', 1, undefined)), frames(['g', coloured]))
  const orig = render(scene(fmt(W_X, H_X, { type: 'color', color: '#000000' }), [G()]), frames(['g', coloured]))
  const half = render(gradedScene(grade('vivid', 0.5, undefined)), frames(['g', coloured]))
  const halfErr = Math.max(...[0, 1, 2].map((i) => Math.abs(px(half, W_X, 160, 90)[i] - (px(orig, W_X, 160, 90)[i] + px(full, W_X, 160, 90)[i]) / 2)))
  check('(i) amount 0.5 is halfway between original and filtered (+-4)', halfErr <= 4, `max error ${halfErr}`)

  const identities = [
    ['no filter', grade(null, 1, undefined)],
    ['amount 0', grade('sepia', 0, undefined)],
    ['neutral adjust', grade(null, 1, { brightness: 0, contrast: 0, saturation: 0 })],
    ['unknown filter', grade('polaroid', 1, undefined)]
  ]
  const plain = render(scene(fmt(W_X, H_X, { type: 'color', color: '#000000' }), [G()]), frames(['g', coloured]))
  for (const [name, g] of identities) {
    const out = render(gradedScene(g), frames(['g', coloured]))
    check(`(i) identity (${name}) leaves pixels unchanged (exact)`, maxDiff(out, plain) === 0, `diff ${maxDiff(out, plain)}`)
  }
  check('(i) clipGrade of an ungraded clip is null (no shader work)', clipGrade({ filter: null, transitionIn: null, adjust: undefined, filterAmount: 1 }) === null)

  // Blurred background carries the grade: a 16:9 coloured frame in a 9:16 output, bars must be grey
  const bars = renderSized(180, 320, scene(fmt(180, 320), [G({ grade: grade('blackWhite', 1, undefined) })]), frames(['g', solid(320, 180, [200, 60, 30])]))
  const barPx = px(bars, 180, 2, 2)
  const barBottom = px(bars, 180, 2, 317)
  check('(i) background bars are graded too (top bar grey, r=g=b within 2)', Math.abs(barPx[0] - barPx[1]) <= 2 && Math.abs(barPx[1] - barPx[2]) <= 2 && barPx[0] > 20, barPx)
  check('(i) background bars are graded too (bottom bar grey)', Math.abs(barBottom[0] - barBottom[2]) <= 2 && barBottom[0] > 20, barBottom)
  const picPx = px(bars, 180, 90, 160)
  check('(i) picture is graded (centre grey)', Math.abs(picPx[0] - picPx[2]) <= 2 && picPx[0] > 20, picPx)

  // Text is not graded: white text over a sepia picture stays white, the picture behind it is sepia
  const textOn = render(
    { time: 0, format: fmt(W_X, H_X, { type: 'color', color: '#000000' }), videos: [G({ grade: grade('sepia', 1, undefined) })], overlays: [], texts: [txt({ text: 'Hi', style: textStyle({ size: 200 }) })] },
    frames(['g', solid(W_X, H_X, [128, 128, 128])])
  )
  let whiteText = 0
  for (let y = 0; y < H_X; y++) for (let x = 0; x < W_X; x++) {
    const c = px(textOn, W_X, x, y)
    if (c[0] > 245 && c[1] > 245 && c[2] > 245) whiteText++
  }
  check('(i) text is not graded: white text stays white', whiteText > 50, `white pixels ${whiteText}`)
  const sepiaBg = px(textOn, W_X, 3, 3)
  check('(i) the picture behind the text is graded (sepia)', sepiaBg[0] > sepiaBg[2] + 5, sepiaBg)

  // Transitions: each side uses its own clip grade
  const gA = grade('blackWhite', 1, undefined)
  const transitionScene = (type, progress) =>
    scene(fmt(W_T, H_T), [
      G({ clipId: 'A', assetId: 'A', grade: gA, transition: tr(type, progress, 'from') }),
      G({ clipId: 'B', assetId: 'B', grade: null, transition: tr(type, progress, 'to') })
    ])
  const trA = solid(320, 180, [255, 0, 0])
  const trB = solid(320, 180, [0, 0, 255])
  const gradedOnly = render(scene(fmt(W_T, H_T), [G({ clipId: 'A', assetId: 'A', grade: gA })]), frames(['A', trA]))
  const plainB = render(scene(fmt(W_T, H_T), [G({ clipId: 'B', assetId: 'B' })]), frames(['B', trB]))
  const t0 = render(transitionScene('fade', 0), frames(['A', trA], ['B', trB]))
  check('(i) transition p=0 shows clip A with its own grade', maxDiff(t0, gradedOnly) <= 2, maxDiff(t0, gradedOnly))
  const t1 = render(transitionScene('fade', 1), frames(['A', trA], ['B', trB]))
  check('(i) transition p=1 shows clip B without the grade of A', maxDiff(t1, plainB) <= 2, maxDiff(t1, plainB))
  const tw = render(transitionScene('wipeLeft', 0.5), frames(['A', trA], ['B', trB]))
  check('(i) wipe: the graded side is grey, the other side stays blue', Math.abs(px(tw, W_T, 20, 45)[0] - px(tw, W_T, 20, 45)[1]) <= 2 && px(tw, W_T, 140, 45)[2] > 200, `${px(tw, W_T, 20, 45)} ${px(tw, W_T, 140, 45)}`)

  // Context-level state
  check('(h) no GL error after any draw', glErrors.every((e) => e === 0), `errors ${glErrors.join(',')}`)

  // Dispose: second dispose and draw-after-dispose
  const canvas2 = makeCanvas(160, 90)
  const comp2 = new Compositor(canvas2)
  comp2.draw(scene(fmt(160, 90, { type: 'color', color: '#000000' }), [L('A', T(), null)]), frames(['A', red]))
  comp2.dispose()
  let threw = null
  try {
    comp2.dispose()
    comp2.draw(scene(fmt(160, 90), [L('B')]), frames(['B', blue]))
    comp2.resize(40, 40)
    comp2.readPixels()
  } catch (e) {
    threw = e
  }
  check('(h) dispose twice and draw after dispose do not throw', threw === null, threw ? String(threw) : '')
  const gl2 = canvas2.getContext('webgl2')
  const afterDispose = new Uint8Array(4)
  gl2.bindFramebuffer(gl2.FRAMEBUFFER, null)
  gl2.readPixels(80, 45, 1, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, afterDispose)
  check('(h) draw after dispose is a no-op (canvas still shows the red frame)', afterDispose[0] > 200 && afterDispose[2] < 60, Array.from(afterDispose).join(','))

  return { checks, glErrors, shots, dims: { w: canvas.width, h: canvas.height } }
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

let exitCode = 1
try {
  await page.goto(APP_URL)
  const result = await page.evaluate(pageScenario)
  let failed = 0
  let total = 0
  for (const c of result.checks) {
    total++
    if (c.ok) console.log(`PASS ${c.name}`)
    else {
      failed++
      console.log(`FAIL ${c.name}${c.detail ? ` (${c.detail})` : ''}`)
    }
  }
  total++
  if (pageErrors.length === 0) console.log('PASS no uncaught page errors')
  else {
    failed++
    console.log(`FAIL no uncaught page errors: ${pageErrors.join(' | ')}`)
  }
  mkdirSync(SHOT_DIR, { recursive: true })
  for (const [name, dataUrl] of Object.entries(result.shots)) {
    if (!dataUrl) continue
    const file = `${SHOT_DIR}/render-${name}.png`
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log(`screenshot ${file}`)
  }
  console.log(failed === 0 ? `ALL ${total} CHECKS PASSED` : `${failed} of ${total} CHECKS FAILED`)
  exitCode = failed === 0 ? 0 : 1
} finally {
  await browser.close()
  await server.close()
}
process.exit(exitCode)
