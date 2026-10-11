// Real-browser check of the picture and text overlays on the player canvas: geometry against the drawn pixels,
// gestures (move, scale, snap, one undo step), keyboard, selection by clicking, the project-wide fit switch and the
// text panel layout. Usage: node scripts/e2e-canvas.mjs   (exit code 1 when a check fails)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5181
const SHOTS = process.env.CANVAS_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const VIEW = { width: 1440, height: 900 }
const BG = '#0000ff'

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
const page = await browser.newPage({ viewport: VIEW, locale: 'en', colorScheme: 'light' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}

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

/** Rectangle of the first matching element in CSS pixels, or null. */
const rectOf = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }, selector)

/** Screenshot of the canvas with the overlay hidden (so only the drawn pixels are seen). */
async function canvasPixels() {
  await page.addStyleTag({ content: '[data-player-overlay], .right-2\\.5.top-2\\.5 {display:none!important}' })
  await page.waitForTimeout(120)
  const buf = await page.locator('canvas').first().screenshot()
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('data-player-overlay') && s.remove()))
  return buf.toString('base64')
}

/** Finds the bounding box (CSS px relative to the canvas) of pixels matching a predicate, in the page. */
function boundsOf(b64, predicate) {
  return page.evaluate(
    async ([data, pred]) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob()
      const bmp = await createImageBitmap(blob)
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d')
      ctx.drawImage(bmp, 0, 0)
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      const test = new Function('r', 'g', 'b', `return (${pred})(r, g, b)`)
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
      for (let y = 0; y < bmp.height; y++) {
        for (let x = 0; x < bmp.width; x++) {
          const i = (y * bmp.width + x) * 4
          if (test(img[i], img[i + 1], img[i + 2])) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
        }
      }
      return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
    },
    [b64, predicate]
  )
}

// The frame is pure black and white, the background is a flat colour (blue) and the page around the canvas is not grey.
const PICTURE = '(r, g, b) => Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12'
const MAGENTA = '(r, g, b) => r > 200 && g < 80 && b > 200'

/** Rect of the picture in canvas CSS px, from the pixels. */
async function pictureBounds() {
  const canvasRect = await rectOf('canvas')
  const b64 = await canvasPixels()
  const bounds = await boundsOf(b64, PICTURE)
  if (!bounds) return null
  const shot = await page.evaluate((d) => { const img = new Image(); return new Promise((res) => { img.onload = () => res({ w: img.width, h: img.height }); img.src = `data:image/png;base64,${d}` }) }, b64)
  const k = canvasRect.w / shot.w
  return { x: bounds.x0 * k, y: bounds.y0 * k, w: (bounds.x1 - bounds.x0) * k, h: (bounds.y1 - bounds.y0) * k, canvas: canvasRect, scale: k }
}

/** Overlay box of the given selector, relative to the canvas CSS box. */
async function boxRelativeToCanvas(selector) {
  const canvas = await rectOf('canvas')
  const box = await rectOf(selector)
  if (!box || !canvas) return null
  return { x: box.x - canvas.x, y: box.y - canvas.y, w: box.w, h: box.h }
}

const near = (a, b, tol) => Math.abs(a - b) <= tol

// ---------------------------------------------------------------- setup
await page.goto(`http://localhost:${PORT}/app/`)
await page.waitForSelector('header')
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/frames.webm'))
await page.waitForFunction(() => document.body.innerText.includes('frames.webm'))
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.waitForTimeout(400)
await st('(ed) => { ed.setRatio("9:16"); ed.setBackground({ type: "color", color: "#0000ff" }); ed.setPlayhead(300000) }')
await page.waitForTimeout(500)

const clipId = await st('(ed) => ed.project.clips[0].id')
await st('(ed, me, id) => ed.select({ kind: "clip", id })', clipId)
await page.waitForSelector('[data-role=clip-box]')
await page.waitForTimeout(400)

// (1) Clip overlay equals the picture drawn on the canvas.
async function checkPicture(label, transform) {
  await st('(ed, me, t) => { ed.setSelectedClipProps({ transform: t }) }', transform)
  await page.waitForTimeout(500)
  const bounds = await pictureBounds()
  const box = await boxRelativeToCanvas('[data-role=clip-box]')
  if (!bounds || !box) return check(`clip overlay matches picture (${label})`, false, 'no picture or box found')
  const clip = {
    x0: Math.max(0, box.x), y0: Math.max(0, box.y),
    x1: Math.min(bounds.canvas.w, box.x + box.w), y1: Math.min(bounds.canvas.h, box.y + box.h)
  }
  const ok =
    near(bounds.x, clip.x0, 3) && near(bounds.y, clip.y0, 3) &&
    near(bounds.x + bounds.w, clip.x1, 3) && near(bounds.y + bounds.h, clip.y1, 3)
  check(`clip overlay matches picture (${label})`, ok, JSON.stringify({ pixels: bounds, box, clip }))
}

await checkPicture('fit, scale 1', { fit: 'fit', scale: 1, x: 0, y: 0 })
await checkPicture('fit, scale 0.5', { fit: 'fit', scale: 0.5, x: 0, y: 0 })
await checkPicture('fit, scale 0.5, x offset', { fit: 'fit', scale: 0.5, x: 0.2, y: 0 })
await st('(ed) => ed.setProjectFit("fill")')
await checkPicture('fill, scale 1', { fit: 'fill', scale: 1, x: 0, y: 0 })
await checkPicture('fill, scale 0.5', { fit: 'fill', scale: 0.5, x: 0, y: 0 })
await checkPicture('fill, scale 0.5, y offset', { fit: 'fill', scale: 0.5, x: 0, y: 0.2 })
await st('(ed) => ed.setProjectFit("fit")')
await checkPicture('fit, back to default', { fit: 'fit', scale: 1, x: 0, y: 0 })

// (2) Text: add via the Text tab, colour it magenta and compare the selection box with the drawn pixels.
await page.getByRole('tab', { name: 'Design' }).click()
await page.getByRole('button', { name: /^Text$/ }).first().click()
await page.getByRole('button', { name: /^Add text$/ }).click()
await page.waitForSelector('[data-role=text-box]')
await st('(ed) => { ed.updateSelectedText({ style: { color: "#ff00ff", outline: null, size: 120 } }); ed.setPlayhead(300000) }')
await page.waitForTimeout(600)
const textBoxBefore = await rectOf('[data-role=text-box]')
const canvasRect = await rectOf('canvas')
const magentaShot = await canvasPixels()
const magenta = await boundsOf(magentaShot, MAGENTA)
{
  const k = canvasRect.w / (await page.evaluate((d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i.width); i.src = `data:image/png;base64,${d}` }), magentaShot))
  const pixels = magenta && { x: magenta.x0 * k, y: magenta.y0 * k, w: (magenta.x1 - magenta.x0) * k, h: (magenta.y1 - magenta.y0) * k }
  const boxCss = { x: textBoxBefore.x - canvasRect.x, y: textBoxBefore.y - canvasRect.y, w: textBoxBefore.w, h: textBoxBefore.h }
  const tol = 0.04 * boxCss.w
  const ok = !!pixels && near(pixels.x, boxCss.x, tol + 2) && near(pixels.x + pixels.w, boxCss.x + boxCss.w, tol + 2) &&
    near(pixels.y, boxCss.y, tol + 2) && near(pixels.y + pixels.h, boxCss.y + boxCss.h, tol + 2)
  check('text selection box matches the rendered text pixels (4 % tolerance)', ok, JSON.stringify({ pixels, boxCss, tol }))
}

// (3) Dragging the text moves it by the dragged fraction; one Ctrl+Z restores it.
await st('(ed) => ed.updateSelectedText({ pos: { x: 0.5, y: 0.5 } })')
await page.waitForTimeout(200)
const overlay = await rectOf('[data-player-overlay]')
const tb = await rectOf('[data-role=text-box]')
const startPos = await st('(ed) => ({ ...ed.selectedItem.pos })')
const pastBefore = await st('(ed) => ed.history.past.length')
const grab = { x: tb.cx - tb.w * 0.25, y: tb.cy }
await page.mouse.move(grab.x, grab.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(grab.x + (60 * i) / 8, grab.y + (30 * i) / 8)
await page.mouse.up()
await page.waitForTimeout(200)
const movedPos = await st('(ed) => ({ ...ed.selectedItem.pos })')
const expX = startPos.x + 60 / overlay.w
const expY = startPos.y + 30 / overlay.h
check('dragging the text moves its position by the dragged fraction (+-1 %)',
  near(movedPos.x, expX, 0.01) && near(movedPos.y, expY, 0.01), JSON.stringify({ startPos, movedPos, expX, expY }))
const pastAfter = await st('(ed) => ed.history.past.length')
check('one text drag is one undo step', pastAfter - pastBefore === 1, `${pastBefore} -> ${pastAfter}`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
const undonePos = await st('(ed) => ({ ...ed.selectedItem.pos })')
check('one Ctrl+Z restores the text position', near(undonePos.x, startPos.x, 1e-9) && near(undonePos.y, startPos.y, 1e-9), JSON.stringify(undonePos))

// (4) Corner handle scales the text and keeps its centre.
await st('(ed) => ed.updateSelectedText({ pos: { x: 0.5, y: 0.5 } })')
await page.waitForTimeout(200)
const before4 = await rectOf('[data-role=text-box]')
const sizeBefore = await st('(ed) => ed.selectedItem.style.size')
const handles = await page.locator('[data-role=text-box] button[aria-label=Scale]').all()
const tr = await handles[1].boundingBox()
await page.mouse.move(tr.x + tr.width / 2, tr.y + tr.height / 2)
await page.mouse.down()
for (let i = 1; i <= 6; i++) await page.mouse.move(tr.x + tr.width / 2 + (50 * i) / 6, tr.y + tr.height / 2 - (25 * i) / 6)
await page.mouse.up()
await page.waitForTimeout(200)
const after4 = await rectOf('[data-role=text-box]')
const sizeAfter = await st('(ed) => ed.selectedItem.style.size')
check('corner handle scales the text size',
  sizeAfter > sizeBefore && after4.w > before4.w * 1.05, JSON.stringify({ sizeBefore, sizeAfter, w0: before4.w, w1: after4.w }))
check('corner handle keeps the centre of the text', near(after4.cx, before4.cx, 1.5) && near(after4.cy, before4.cy, 1.5),
  JSON.stringify({ c0: [before4.cx, before4.cy], c1: [after4.cx, after4.cy] }))
await st('(ed) => ed.updateSelectedText({ style: { size: 120 } })')
await page.waitForTimeout(150)

// (5) Snapping to the centre line, with the guide shown while snapping.
await st('(ed) => ed.updateSelectedText({ pos: { x: 0.42, y: 0.3 } })')
await page.waitForTimeout(200)
const ov5 = await rectOf('[data-player-overlay]')
const tb5 = await rectOf('[data-role=text-box]')
const g5 = { x: tb5.cx - tb5.w * 0.25, y: tb5.cy }
const dx5 = (0.5 + 0.003 - 0.42) * ov5.w
await page.mouse.move(g5.x, g5.y)
await page.mouse.down()
for (let i = 1; i <= 6; i++) await page.mouse.move(g5.x + (dx5 * i) / 6, g5.y)
const guideShown = (await page.locator('[data-role=guide-x]').count()) === 1
await page.mouse.up()
await page.waitForTimeout(150)
const snapped = await st('(ed) => ed.selectedItem.pos.x')
check('dragging near the centre line snaps to it and shows the guide', near(snapped, 0.5, 1e-9) && guideShown, JSON.stringify({ snapped, guideShown }))
check('the guide disappears when the drag ends', (await page.locator('[data-role=guide-x]').count()) === 0)

// (5b) Snapping on both axes: vertical centre, quarters, thirds; Alt turns snapping off.
async function dragTextTo(fx, fy, alt = false) {
  // Moves the text so that its anchor ends at (fx, fy) (fractions), grabbing it left of its centre.
  const ov = await rectOf('[data-player-overlay]')
  const tbx = await rectOf('[data-role=text-box]')
  const cur = await st('(ed) => ({ ...ed.selectedItem.pos })')
  const from = { x: tbx.cx - tbx.w * 0.25, y: tbx.cy }
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(from.x + ((fx - cur.x) * ov.w * i) / 6, from.y + ((fy - cur.y) * ov.h * i) / 6)
  }
  const guides = { x: await page.locator('[data-role=guide-x]').count(), y: await page.locator('[data-role=guide-y]').count() }
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(120)
  return { pos: await st('(ed) => ({ ...ed.selectedItem.pos })'), guides }
}
for (const [name, target, axis] of [
  ['vertical centre line', [0.3, 0.5 + 0.003], 'y'],
  ['horizontal quarter line 3/4', [0.75 - 0.003, 0.3], 'x'],
  ['horizontal third line 1/3', [1 / 3 + 0.002, 0.3], 'x'],
  ['vertical quarter line 1/4', [0.3, 0.25 - 0.002], 'y']
]) {
  await st('(ed) => ed.updateSelectedText({ pos: { x: 0.3, y: 0.3 } })')
  await page.waitForTimeout(120)
  const r = await dragTextTo(target[0], target[1])
  const snappedValue = axis === 'x' ? r.pos.x : r.pos.y
  const expected = name.includes('3/4') ? 0.75 : name.includes('1/3') ? 1 / 3 : name.includes('1/4') ? 0.25 : 0.5
  const guideShown = axis === 'x' ? r.guides.x === 1 : r.guides.y === 1
  check(`snaps to the ${name} and shows its guide`, near(snappedValue, expected, 1e-9) && guideShown, JSON.stringify({ r, expected }))
}
await st('(ed) => ed.updateSelectedText({ pos: { x: 0.3, y: 0.3 } })')
await page.waitForTimeout(120)
const altRun = await dragTextTo(0.5 + 0.003, 0.3, true)
check('holding Alt disables snapping', near(altRun.pos.x, 0.503, 0.002) && altRun.guides.x === 0, JSON.stringify(altRun))

// (6) Clip drag and scale: transform changes and each gesture is one undo step.
await st('(ed, me, id) => { ed.select({ kind: "clip", id }); ed.setSelectedClipProps({ transform: { x: 0, y: 0, scale: 1 } }) }', clipId)
await page.waitForSelector('[data-role=clip-box]')
await page.waitForTimeout(200)
const ovc = await rectOf('[data-player-overlay]')
const cb = await rectOf('[data-role=clip-box]')
const pastC0 = await st('(ed) => ed.history.past.length')
const gc = { x: cb.cx - cb.w * 0.2, y: cb.cy - cb.h * 0.2 }
await page.mouse.move(gc.x, gc.y)
await page.mouse.down()
for (let i = 1; i <= 6; i++) await page.mouse.move(gc.x + (0.1 * ovc.w * i) / 6, gc.y + (0.05 * ovc.h * i) / 6)
await page.mouse.up()
await page.waitForTimeout(200)
const tr1 = await st('(ed, me, id) => ({ ...ed.project.clips.find((c) => c.id === id).transform })', clipId)
check('dragging the picture moves transform x/y by the dragged fraction (+-1 %)',
  near(tr1.x, 0.1, 0.01) && near(tr1.y, 0.05, 0.01), JSON.stringify(tr1))
const cbS = await rectOf('[data-role=clip-box]')
const hs = await page.locator('[data-role=clip-box] button[aria-label=Scale]').all()
const sb = await hs[0].boundingBox()
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
await page.mouse.down()
// The top left handle moves outwards (up and left) to enlarge the picture.
for (let i = 1; i <= 6; i++) await page.mouse.move(sb.x + sb.width / 2 - (40 * i) / 6, sb.y + sb.height / 2 - (20 * i) / 6)
await page.mouse.up()
await page.waitForTimeout(200)
const tr2 = await st('(ed, me, id) => ({ ...ed.project.clips.find((c) => c.id === id).transform })', clipId)
const cbE = await rectOf('[data-role=clip-box]')
check('dragging a picture corner scales the transform', tr2.scale > 1.05 && cbE.w > cbS.w * 1.05, JSON.stringify({ scale: tr2.scale, w0: cbS.w, w1: cbE.w }))
const pastC1 = await st('(ed) => ed.history.past.length')
check('each picture gesture is one undo step', pastC1 - pastC0 === 2, `${pastC0} -> ${pastC1}`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(150)
const tr3 = await st('(ed, me, id) => ({ ...ed.project.clips.find((c) => c.id === id).transform })', clipId)
check('one Ctrl+Z undoes the scale gesture only', near(tr3.scale, tr1.scale, 1e-9) && near(tr3.x, tr1.x, 1e-9), JSON.stringify(tr3))
await page.keyboard.press('Control+z')
await page.waitForTimeout(150)
const tr4 = await st('(ed, me, id) => ({ ...ed.project.clips.find((c) => c.id === id).transform })', clipId)
check('a second Ctrl+Z undoes the move', near(tr4.x, 0, 1e-9) && near(tr4.y, 0, 1e-9) && near(tr4.scale, 1, 1e-9), JSON.stringify(tr4))

// (6b) A picture snaps its centre to the centre line.
await st('(ed, me, t) => ed.setSelectedClipProps({ transform: t })', { x: 0.1, y: 0 })
await page.waitForTimeout(150)
{
  const ov = await rectOf('[data-player-overlay]')
  const cbc = await rectOf('[data-role=clip-box]')
  const from = { x: cbc.cx - cbc.w * 0.2, y: cbc.cy - cbc.h * 0.2 }
  const dx = (0.5 + 0.003 - 0.6) * ov.w
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + (dx * i) / 6, from.y)
  await page.mouse.up()
  await page.waitForTimeout(120)
  const tr = await st('(ed, me, id) => ({ ...ed.project.clips.find((c) => c.id === id).transform })', clipId)
  check('a picture snaps its centre to the centre line', near(tr.x, 0, 1e-9), JSON.stringify(tr))
  await st('(ed, me, t) => ed.setSelectedClipProps({ transform: t })', { x: 0, y: 0 })
}

// (7) Keyboard nudge of the text box.
await st('(ed, me, id) => ed.select({ kind: "text", id })', await st('(ed) => ed.project.texts[0].id'))
await page.waitForSelector('[data-role=text-box]')
await st('(ed) => ed.updateSelectedText({ pos: { x: 0.5, y: 0.5 } })')
await page.waitForTimeout(150)
await page.locator('[data-role=text-box]').focus()
await page.keyboard.press('ArrowRight')
const nudge1 = await st('(ed) => ed.selectedItem.pos.x')
await page.keyboard.press('Shift+ArrowRight')
const nudge2 = await st('(ed) => ed.selectedItem.pos.x')
check('arrow keys nudge the text by 1 % and Shift by 5 %', near(nudge1, 0.51, 1e-9) && near(nudge2, 0.56, 1e-9), JSON.stringify({ nudge1, nudge2 }))

// (8) Clicking selects the topmost text under the pointer; clicking elsewhere on the picture deselects it.
const textCenter = await rectOf('[data-role=text-box]')
await page.locator('[data-player-overlay] [data-role=pick]').click({ position: { x: 4, y: 4 } })
await page.waitForTimeout(150)
const selAfterEmpty = await st('(ed) => ed.selection')
check('clicking elsewhere on the picture clears the text selection', selAfterEmpty?.kind !== 'text', JSON.stringify(selAfterEmpty))
await page.mouse.click(textCenter.cx, textCenter.cy)
await page.waitForTimeout(150)
const selText = await st('(ed) => ed.selection')
check('clicking the text in the picture selects it', selText?.kind === 'text', JSON.stringify(selText))

// (9) Project-wide fit: the chip switches all clips and new clips; no per-clip control in ClipPanel.
await st('(ed, me, id) => ed.select({ kind: "clip", id })', clipId)
await page.waitForTimeout(150)
const perClip = await page.locator('aside button').filter({ hasText: /^(Fit|Fill|Einpassen|Füllen)$/ }).count()
check('no per-clip Fit/Fill control remains in the clip panel', perClip === 0, `found ${perClip}`)
await page.getByRole('button', { name: 'Aspect ratio', exact: true }).first().click()
await page.getByRole('radio', { name: /^Fill$/ }).first().click()
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
const fitState = await st('(ed) => ({ format: ed.project.format.fit, clips: ed.project.clips.map((c) => c.transform.fit) })')
check('the picture fit chip sets Fill for the project and all clips', fitState.format === 'fill' && fitState.clips.every((f) => f === 'fill'), JSON.stringify(fitState))
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.waitForTimeout(300)
const appended = await st('(ed) => ed.project.clips.at(-1).transform.fit')
check('a newly appended clip is Fill too', appended === 'fill', String(appended))

// (10) Text panel: content, swatches, font and position fit in the 1440x900 window without scrolling.
await st('(ed, me, id) => ed.select({ kind: "text", id })', await st('(ed) => ed.project.texts[0].id'))
await page.waitForSelector('textarea')
await page.waitForTimeout(200)
const layout = await page.evaluate(() => {
  const pick = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  }
  // The panel is the scrolling column around the textarea; (1)-(4) must be inside its visible part.
  const panel = document.querySelector('textarea').closest('.overflow-y-auto')
  const visibleBottom = Math.min(panel.getBoundingClientRect().bottom, window.innerHeight)
  return {
    content: pick(document.querySelector('textarea')),
    swatches: pick(document.querySelector('[role=group][aria-label="Colour"]')),
    font: pick(document.querySelector('[id^=text-font-]')),
    position: pick(document.querySelector('[role=group][aria-label="Position"]')),
    hint: pick([...document.querySelectorAll('p')].find((p) => /Drag the text/.test(p.textContent))),
    viewport: visibleBottom
  }
})
const inView = ['content', 'swatches', 'font', 'position', 'hint'].every((k) => layout[k] && layout[k].top >= 0 && layout[k].bottom <= layout.viewport)
check('content, colours, font, position buttons and their hint are visible at 1440x900 without scrolling', inView, JSON.stringify(layout))
await page.screenshot({ path: join(SHOTS, 'canvas-check-text-1440.png') })

// (12) Colour picker: palette cell, hex field (live and invalid), native input, arrow keys; font listbox.
await st('(ed, me, id) => ed.select({ kind: "text", id })', await st('(ed) => ed.project.texts[0].id'))
await page.waitForSelector('textarea')
await page.getByRole('button', { name: 'More colours' }).first().click()
await page.waitForTimeout(150)
await page.getByRole('gridcell', { name: 'Blue 500 #2b7fff' }).click()
let colour = await st('(ed) => ed.selectedItem.style.color')
check('a palette cell sets the text colour (Blue 500 #2b7fff)', colour === '#2b7fff', colour)
await page.getByRole('button', { name: 'More colours' }).first().click()
await page.getByRole('textbox', { name: 'Hex colour' }).fill('zzz')
await page.waitForTimeout(100)
colour = await st('(ed) => ed.selectedItem.style.color')
check('an invalid hex value shows an error and keeps the colour', colour === '#2b7fff' && (await page.getByRole('alert').count()) > 0, colour)
await page.getByRole('textbox', { name: 'Hex colour' }).fill('#f0a')
await page.waitForTimeout(100)
colour = await st('(ed) => ed.selectedItem.style.color')
check('a valid short hex value (#f0a) sets the colour as #ff00aa', colour === '#ff00aa', colour)
await page.getByRole('gridcell', { name: 'Blue 500 #2b7fff' }).focus().catch(() => {})
await page.getByRole('textbox', { name: 'Hex colour' }).focus()
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
await page.getByRole('button', { name: 'More colours' }).first().click()
await page.getByRole('gridcell', { name: 'Red 500 #fb2c36' }).focus()
await page.keyboard.press('ArrowRight')
const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
check('arrow keys move through the palette grid', focusedName === 'Red 600 #e7000b', String(focusedName))
await page.keyboard.press('Enter')
await page.waitForTimeout(100)
const enterColour = await st('(ed) => ed.selectedItem.style.color')
check('Enter selects the focused palette cell', enterColour === '#e7000b', enterColour)
await page.getByRole('button', { name: 'More colours' }).first().click()
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
check('Escape closes the colour popover and returns focus to its button',
  (await page.getByRole('dialog', { name: 'Colour' }).count()) === 0 &&
    (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'More colours')
await page.getByRole('button', { name: 'More colours' }).first().click()
const nativeCount = await page.locator('input[type=color][aria-label="Custom colour (system picker)"]').count()
check('the native colour input is offered as the third option', nativeCount >= 1)
await page.keyboard.press('Escape')

// Font listbox
await page.locator('[id^=text-font-]').click()
const options = await page.getByRole('listbox', { name: 'Font' }).getByRole('option').all()
const fontsRendered = []
for (const o of options) fontsRendered.push(await o.evaluate((el) => getComputedStyle(el.querySelector('span')).fontFamily))
check('font listbox lists every curated font in its own typeface', options.length === 8 && fontsRendered.every((f, i) => f.includes(['Sora','Inter','Lora','Bebas Neue','Pacifico','Caveat','Fredoka','DM Mono'][i])), JSON.stringify(fontsRendered))
await page.getByRole('option', { name: /Lora/ }).click()
const font = await st('(ed) => ed.selectedItem.style.font')
check('choosing a font in the listbox sets the font', font === 'Lora', font)
await page.locator('[id^=text-font-]').click()
await page.keyboard.press('Escape')
check('Escape closes the font listbox', (await page.getByRole('listbox').count()) === 0)

// (11) No uncaught page errors.
check('no uncaught page errors', errors.length === 0, errors.join(' | '))

await browser.close()
await server.close()
mkdirSync(SHOTS, { recursive: true })
console.log(failed === 0 ? 'ALL CANVAS CHECKS PASSED' : `${failed} CANVAS CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
