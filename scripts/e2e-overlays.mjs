// Real-browser check of stickers, shapes and pen strokes (overlays): add, move, rotate, draw with mouse and touch,
// the pixels in the preview, one exported MP4 frame, undo/redo, and light and dark screenshots.
// Usage: node scripts/e2e-overlays.mjs   (exit code 1 when a check fails). Port 5230.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

const PORT = 5230
const SHOTS = process.env.OVERLAY_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const VIEW = { width: 1440, height: 900 }

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
// hasTouch lets the CDP touch events below reach the pointer handlers like a real touch screen.
const context = await browser.newContext({ viewport: VIEW, locale: 'en', colorScheme: 'light', hasTouch: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}
const settle = () => page.waitForTimeout(350)

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

const overlayState = () =>
  st(`(ed) => ({
    overlays: ed.project.overlays,
    selection: ed.selection,
    drawing: ed.drawing,
    color: ed.overlayColor,
    past: ed.history.past.length,
    future: ed.history.future.length
  })`)

/** Rectangle of the first matching element in CSS pixels. */
const rectOf = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }, selector)

/** Screenshot of the player canvas with the overlay layer hidden, so only the drawn pixels are seen (PNG, base64). */
async function canvasShot() {
  await page.addStyleTag({ content: '[data-player-overlay]{display:none!important}' })
  await page.waitForTimeout(120)
  const buf = await page.locator('canvas').first().screenshot()
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('data-player-overlay') && s.remove()))
  return buf.toString('base64')
}

/**
 * Pixel analysis in the page. `mode` is 'diff' (changed pixels between two shots) or 'match' (pixels passing a
 * predicate, optionally inside a rectangle [x0, x1, y0, y1] given as canvas fractions). Positions are fractions of the canvas.
 */
function analyze(mode, a, b = null, predicate = null, rect = null) {
  return page.evaluate(
    async ([m, shotA, shotB, pred, box]) => {
      const decode = async (data) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0)
        return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data }
      }
      const A = await decode(shotA)
      const test = pred ? new Function('r', 'g', 'b', `return (${pred})(r, g, b)`) : null
      const inside = (x, y) => !box || (x >= box[0] * A.w && x < box[1] * A.w && y >= box[2] * A.h && y < box[3] * A.h)
      let n = 0
      let sx = 0
      let sy = 0
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -1
      let y1 = -1
      const B = m === 'diff' ? await decode(shotB) : null
      for (let y = 0; y < A.h; y++) {
        for (let x = 0; x < A.w; x++) {
          if (!inside(x, y)) continue
          const i = (y * A.w + x) * 4
          let hit
          if (m === 'diff') {
            hit = Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2]) > 60
          } else {
            hit = test(A.d[i], A.d[i + 1], A.d[i + 2])
          }
          if (!hit) continue
          n++
          sx += x
          sy += y
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
        }
      }
      return { count: n, cx: n ? sx / n / A.w : null, cy: n ? sy / n / A.h : null, box: n ? [x0 / A.w, y0 / A.h, (x1 + 1) / A.w, (y1 + 1) / A.h] : null }
    },
    [mode, a, b, predicate, rect]
  )
}

const isYellow = '(r, g, b) => r > 220 && g > 170 && b < 140 && r - b > 110'
const isPink = '(r, g, b) => r > 200 && g < 150 && b > 120 && b < 220 && r - g > 80'
const isLime = '(r, g, b) => g > 215 && r > 160 && r < 225 && b < 120'

/** Pixels of one colour around a point (canvas fractions); the window is 4 % of the canvas height. */
function nearColour(shot, x, y, predicate) {
  const r = 0.04
  return analyze('match', shot, null, predicate, [x - r, x + r, y - r, y + r])
}

// --- 1. start: the demo project, empty preview background ---
await page.goto(`http://localhost:${PORT}/app/?demo=1`)
await page.waitForSelector('[data-player-overlay]')
await settle()
const base = await canvasShot()

// --- 2. sticker from the Stickers panel ---
await page.getByRole('tab', { name: 'Design' }).click()
await page.getByRole('button', { name: 'Stickers', exact: true }).click()
await page.getByRole('button', { name: 'Star', exact: true }).click()
await settle()
let s = await overlayState()
check('sticker: one overlay is added at the playhead and selected', s.overlays.length === 1 && s.overlays[0].kind === 'sticker' && s.selection?.kind === 'overlay', JSON.stringify(s.selection))
const starId = s.overlays[0]?.id
const withStar = await canvasShot()
const starDiff = await analyze('diff', withStar, base)
check('sticker: the preview draws it at the centre', starDiff.count > 200 && Math.abs(starDiff.cx - 0.5) < 0.04 && Math.abs(starDiff.cy - 0.5) < 0.06, JSON.stringify(starDiff))
const starYellow = await analyze('match', withStar, null, isYellow)
check('sticker: emoji pixels come from the system emoji font (yellow star)', starYellow.count > 150, JSON.stringify(starYellow.count))

// --- 3. move the sticker with its handle (drag by 150 x 80 screen pixels) ---
const moveHandle = await rectOf('[data-role="overlay-box"] button[aria-label="Move"]')
const root = await rectOf('[data-player-overlay]')
await page.mouse.move(moveHandle.cx, moveHandle.cy)
await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(moveHandle.cx + 15 * i, moveHandle.cy + 8 * i)
await page.mouse.up()
await settle()
s = await overlayState()
const moved = s.overlays.find((o) => o.id === starId)
const expectX = 0.5 + 150 / root.w
const expectY = 0.5 + 80 / root.h
check('move: the drag changes the anchor by the pointer distance', moved && Math.abs(moved.pos.x - expectX) < 0.02 && Math.abs(moved.pos.y - expectY) < 0.02, JSON.stringify(moved?.pos))
const movedShot = await canvasShot()
const movedYellow = await analyze('match', movedShot, null, isYellow)
check('move: the star is drawn at its new place', movedYellow.cx !== null && movedYellow.cx > 0.5 + 0.05 && movedYellow.cy > 0.5 + 0.03, JSON.stringify(movedYellow))

// --- 4. rotate with the top handle: pointer to the right of the anchor is +90 degrees ---
const pivot = { x: root.x + moved.pos.x * root.w, y: root.y + moved.pos.y * root.h }
const rotateHandle = await rectOf('[data-role="overlay-rotate"]')
const radius = pivot.y - rotateHandle.cy
await page.mouse.move(rotateHandle.cx, rotateHandle.cy)
await page.mouse.down()
for (let i = 1; i <= 12; i++) {
  // The handle starts straight up from the anchor; sweeping clockwise by t ends at 'right' (+90 degrees).
  const t = (i / 12) * (Math.PI / 2)
  await page.mouse.move(pivot.x + radius * Math.sin(t), pivot.y - radius * Math.cos(t))
}
await page.mouse.up()
await settle()
s = await overlayState()
const rotated = s.overlays.find((o) => o.id === starId)
check('rotate: the handle turns the item by about 90 degrees', rotated && Math.abs(rotated.rotation - 90) < 8, JSON.stringify(rotated?.rotation))

// --- 5. a shape: arrow from the Stickers panel (the selected sticker's panel first goes back to the library) ---
await page.getByRole('button', { name: 'Back to library' }).click()
await page.getByRole('button', { name: 'Arrow', exact: true }).click()
await settle()
s = await overlayState()
check('shape: an arrow is added and selected', s.overlays.length === 2 && s.overlays[1].kind === 'shape' && s.overlays[1].shape === 'arrow', JSON.stringify(s.overlays.map((o) => o.kind)))
const arrowShot = await canvasShot()
const arrowPink = await analyze('match', arrowShot, null, isPink)
check('shape: arrow pixels use the pen colour (default pink)', arrowPink.count > 40, JSON.stringify(arrowPink.count))

// --- 6. drawing: pen tab, thick width, mouse stroke ---
await page.getByRole('button', { name: 'Draw', exact: true }).click()
await page.getByRole('button', { name: 'Thick', exact: true }).click()
await page.getByRole('switch', { name: 'Draw on the preview' }).click()
await settle()
s = await overlayState()
check('draw: drawing mode is on and the drawing surface covers the picture', s.drawing && (await rectOf('[data-role="draw-surface"]')) !== null)

const surface = await rectOf('[data-role="draw-surface"]')
const at = (fx, fy) => [surface.x + fx * surface.w, surface.y + fy * surface.h]
let [x0, y0] = at(0.2, 0.3)
await page.mouse.move(x0, y0)
await page.mouse.down()
for (let i = 1; i <= 25; i++) {
  const [x, y] = at(0.2 + (0.6 * i) / 25, 0.3 + (0.4 * i) / 25)
  await page.mouse.move(x, y)
}
await page.mouse.up()
await settle()
s = await overlayState()
let stroke = s.overlays.at(-1)
check('draw: a mouse stroke becomes one stroke item with the thick width', s.overlays.length === 3 && stroke.kind === 'stroke' && Math.abs(stroke.lineWidth - 0.016) < 1e-9 && stroke.points.length >= 2, JSON.stringify(stroke?.kind))
const strokeShot = await canvasShot()
const onStroke = await nearColour(strokeShot, 0.3, 0.3667, isPink)
check('draw: the preview shows the stroke where it was drawn', onStroke.count > 10, JSON.stringify(onStroke.count))

// --- 7. colour from the inline swatches, then a second stroke ---
await page.getByRole('button', { name: 'Colour #c6f432', exact: true }).click()
await settle()
s = await overlayState()
check('colour: the swatch sets the pen colour', s.color === '#c6f432', s.color)
await page.mouse.move(...at(0.2, 0.8))
await page.mouse.down()
for (let i = 1; i <= 20; i++) await page.mouse.move(...at(0.2 + (0.6 * i) / 20, 0.8))
await page.mouse.up()
await settle()
s = await overlayState()
check('colour: the second stroke uses the new colour', s.overlays.length === 4 && s.overlays[3].color === '#c6f432', JSON.stringify(s.overlays.at(-1)?.color))

// --- 8. touch: one stroke with CDP touch events ---
const cdp = await context.newCDPSession(page)
const touchY = 0.2
const [tx0, ty0] = at(0.1, touchY)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx0, y: ty0, id: 1 }] })
for (let i = 1; i <= 20; i++) {
  const [tx, ty] = at(0.1 + (0.8 * i) / 20, touchY)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx, y: ty, id: 1 }] })
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await settle()
s = await overlayState()
check('touch: a finger stroke also becomes a stroke item', s.overlays.length === 5 && s.overlays[4].kind === 'stroke', `count ${s.overlays.length}`)
const touchShot = await canvasShot()
const onTouch = await nearColour(touchShot, 0.5, touchY, isLime)
check('touch: the preview shows the finger stroke', onTouch.count > 10, JSON.stringify(onTouch.count))

// --- 9. undo, redo, and the undo-last-stroke button ---
await page.keyboard.press('Control+z')
await settle()
s = await overlayState()
check('undo: Ctrl+Z removes the last stroke', s.overlays.length === 4, `count ${s.overlays.length}`)
await page.keyboard.press('Control+y')
await settle()
s = await overlayState()
check('redo: Ctrl+Y brings it back', s.overlays.length === 5, `count ${s.overlays.length}`)
await page.getByRole('button', { name: 'Undo last stroke' }).click()
await settle()
s = await overlayState()
check('undo last stroke: the button removes the most recent stroke only', s.overlays.length === 4 && s.overlays.filter((o) => o.kind === 'stroke').length === 2, `count ${s.overlays.length}`)
await page.keyboard.press('Control+z')
await settle()
s = await overlayState()
check('undo last stroke: one undo step brings the stroke back', s.overlays.length === 5, `count ${s.overlays.length}`)
// Drawing off; one more undo removes the finger stroke from the picture, redo puts it back for the export.
await page.getByRole('switch', { name: 'Draw on the preview' }).click()
await settle()
check('draw: switching drawing off returns the player to normal pointer use', !(await overlayState()).drawing)
await page.keyboard.press('Control+z')
await settle()
const afterUndo = await canvasShot()
check('undo: the picture forgets the undone stroke', (await nearColour(afterUndo, 0.5, touchY, isLime)).count < 3)
await page.keyboard.press('Control+y')
await settle()
s = await overlayState()
check('redo: the finger stroke is back', s.overlays.length === 5)

// --- 10. timeline lane shows every item ---
const laneItems = await page.locator('[data-lane="overlay"] [data-kind="overlay"]').count()
s = await overlayState()
check('timeline: the overlay lane shows one bar per item', laneItems === s.overlays.length, `${laneItems} vs ${s.overlays.length}`)

// --- 11. export an MP4 with the same overlays and check one frame ---
const exported = await page.evaluate(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  const mod = (p) => import(p)
  const { runExport } = await mod('/src/engine/export/exporter.ts')
  const { probeFile } = await mod('/src/engine/media/probe.ts')
  const { createProject } = await mod('/src/core/project/schema.ts')
  const { ExactFrameProvider } = await mod('/src/engine/media/frames.ts')
  const { frameStart } = await mod('/src/core/time.ts')
  const S = 1_000_000
  const file = new File([await (await fetch('/tests/fixtures/clip-a.webm')).blob()], 'clip-a.webm', { type: 'video/webm' })
  const info = await probeFile(file)
  const p = createProject('overlays')
  p.assets.push({ id: 'clipa', kind: info.kind, name: info.name, relPath: info.name, size: info.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio })
  p.clips = [
    { id: 'c1', track: 'video', assetId: 'clipa', srcIn: 0, srcOut: 2 * S, start: 0, speed: 1, transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false }, volume: 1, muted: false, filter: null, transitionIn: null }
  ]
  // The overlays made in the editor, moved to the start of this 2 s clip.
  p.overlays = ed.project.overlays.map((o) => ({ ...o, start: 200_000, duration: 2 * S }))
  const res = await runExport({ project: p, files: { clipa: file }, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, () => undefined, new AbortController().signal)
  const provider = new ExactFrameProvider()
  provider.setFile('o', new File([res.blob], 'out.mp4'), false)
  const frame = await provider.getFrame('o', frameStart(30, 30))
  const w = frame.displayWidth ?? frame.width
  const h = frame.displayHeight ?? frame.height
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(frame, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data
  await provider.dispose()
  // Returns the pixels of one colour in a window around a fraction of the frame.
  const count = (fx, fy, radius, test) => {
    let n = 0
    const cx = Math.round(fx * w)
    const cy = Math.round(fy * h)
    const r = Math.round(radius * h)
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
        const i = (y * w + x) * 4
        if (test(data[i], data[i + 1], data[i + 2])) n++
      }
    }
    return n
  }
  const star = ed.project.overlays.find((o) => o.kind === 'sticker')
  return {
    frames: res.frames,
    size: [w, h],
    yellowAtStar: star ? count(star.pos.x, star.pos.y, 0.07, (r, g, b) => r > 220 && g > 170 && b < 140 && r - b > 110) : 0,
    pinkOnStroke: count(0.3, 0.3667, 0.02, (r, g, b) => r > 200 && g < 150 && b > 120 && b < 220 && r - g > 80),
    limeOnStroke: count(0.5, 0.8, 0.02, (r, g, b) => g > 215 && r > 160 && r < 225 && b < 120),
    limeOnTouch: count(0.5, 0.2, 0.02, (r, g, b) => g > 215 && r > 160 && r < 225 && b < 120)
  }
}, null)
check('export: an MP4 with frames is written', exported.frames > 30, JSON.stringify(exported))
check('export: the exported frame shows the sticker', exported.yellowAtStar > 15, JSON.stringify(exported))
check('export: the exported frame shows the pink stroke', exported.pinkOnStroke > 0, JSON.stringify(exported))
check('export: the exported frame shows the lime strokes (mouse and touch)', exported.limeOnStroke > 0 && exported.limeOnTouch > 0, JSON.stringify(exported))

// --- 12. screenshots, light and dark ---
await page.locator('[data-lane="overlay"] [data-kind="overlay"] button').first().click()
await settle()
await page.screenshot({ path: `${SHOTS}/overlay-light.png` })
await page.getByRole('tab', { name: 'Design' }).click()
await page.getByRole('button', { name: 'Stickers', exact: true }).click()
await settle()
await page.screenshot({ path: `${SHOTS}/overlay-panel-light.png` })
await page.emulateMedia({ colorScheme: 'dark' })
await settle()
await page.screenshot({ path: `${SHOTS}/overlay-dark.png` })
check('screenshots: light, panel and dark written', ['overlay-light.png', 'overlay-panel-light.png', 'overlay-dark.png'].every((f) => existsSync(`${SHOTS}/${f}`)))

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
