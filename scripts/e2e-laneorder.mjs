// Real-browser check of the stacking order from the timeline: the context menu of an overlay bar (bring to front,
// forward, backward, to back, disabled at the ends), the keyboard shortcuts, and dragging a bar vertically across the
// overlay lanes (drop indicator, ghost, one undo step, Escape cancels, diagonal drags, horizontal drags unchanged,
// the video-end invariant) with a mouse and with a touch long press.
// Usage: node scripts/e2e-laneorder.mjs (exit code 1 when a check fails). Port 5410. Screenshots go to LANE_SHOTS.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

const PORT = 5410
const APP_URL = `http://localhost:${PORT}/app/?demo=1`
const SHOTS = process.env.LANE_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const S = 1_000_000

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}
const errors = []

/** Three overlapping stickers, back to front: A (back), B, C (front); they sit in rows 2, 1, 0. */
const LABELS = { a: '⭐', b: '🍎', c: '🔥' }
const OVERLAYS = ['a', 'b', 'c'].map((id, i) => ({
  id,
  kind: 'sticker',
  start: 2 * S + i * 0.2 * S,
  duration: 6 * S,
  pos: { x: 0.2 + i * 0.3, y: 0.5 },
  scale: 1,
  rotation: 0,
  size: 0.2,
  emoji: LABELS[id]
}))

async function openEditor(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en', colorScheme: 'light', ...options })
  await context.addInitScript("Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true, writable: true })")
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))
  await page.goto(APP_URL)
  await page.waitForSelector('[data-lane="overlay"]')
  const st = (fn, arg = null) =>
    page.evaluate(
      ([src, a]) => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        return new Function('ed', 'a', `return (${src})(ed, a)`)(pinia._s.get('editor'), a)
      },
      [fn, arg]
    )
  await st(`(ed) => { ed.commitProject({ ...ed.project, overlays: ${JSON.stringify(OVERLAYS)} }); ed.select(null) }`)
  await page.waitForTimeout(500)
  return { context, page, st }
}

const order = (st) => st('(ed) => ed.project.overlays.map((o) => o.id).join("")')
const past = (st) => st('(ed) => ed.history.past.length')
const startsOf = (st) => st('(ed) => Object.fromEntries(ed.project.overlays.map((o) => [o.id, o.start]))')
const bar = (page, id) => page.locator(`[data-lane="overlay"] [data-kind="overlay"] > button[aria-label*="${LABELS[id]}"]`)
/** Ids from the top lane to the bottom lane, read from the page. */
async function topDown(page) {
  const out = []
  for (const id of ['a', 'b', 'c']) out.push({ id, y: (await bar(page, id).boundingBox()).y })
  return out.sort((x, y) => x.y - y.y).map((e) => e.id).join('')
}
const centre = async (page, id) => {
  const b = await bar(page, id).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
/** Row height of the overlay lane in px (28 with a mouse). */
const rowHeight = async (page) => ((await page.locator('[data-lane="overlay"]').boundingBox()).height) / 3

async function dragBy(page, id, dx, dy, { hold = false } = {}) {
  const c = await centre(page, id)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  const steps = 10
  for (let i = 1; i <= steps; i++) await page.mouse.move(c.x + (dx * i) / steps, c.y + (dy * i) / steps)
  await page.waitForTimeout(120)
  if (!hold) await page.mouse.up()
  await page.waitForTimeout(200)
  return c
}

// ---------------------------------------------------------------------------------------------------------
// 1. context menu
{
  const { context, page, st } = await openEditor()
  check('setup: three stickers, front item in the top lane', (await order(st)) === 'abc' && (await topDown(page)) === 'cba', await topDown(page))

  await bar(page, 'a').click({ button: 'right' })
  const menu = page.getByRole('menu')
  const names = await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), off: e.getAttribute('aria-disabled') })))
  check('menu: an overlay bar offers the four stacking entries with their shortcuts', ['Bring to front', 'Bring forward', 'Send backward', 'Send to back'].every((n) => names.some((e) => e.t.startsWith(n))) && names.some((e) => e.t.includes('Ctrl+]')) && names.some((e) => e.t.includes('Ctrl+Shift+[')), JSON.stringify(names))
  check('menu: the back item cannot go further back (both back entries disabled), forward ones are enabled', names.filter((e) => /backward|to back/.test(e.t)).every((e) => e.off === 'true') && names.filter((e) => /front|forward/.test(e.t)).every((e) => e.off === 'false'), JSON.stringify(names))
  check('menu: stacking entries carry an icon', (await menu.getByRole('menuitem', { name: /Bring to front/ }).locator('svg').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/laneorder-menu-light.png` })
  await menu.getByRole('menuitem', { name: /Send to back/ }).click({ force: true })
  check('menu: a disabled entry does nothing', (await order(st)) === 'abc')
  await page.keyboard.press('Escape')

  const before = await past(st)
  await bar(page, 'a').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Bring to front/ }).click()
  await page.waitForTimeout(300)
  check('menu: Bring to front puts it in front and in the top lane, as one undo step', (await order(st)) === 'bca' && (await topDown(page)) === 'acb' && (await past(st)) === before + 1, `${await order(st)} ${await topDown(page)}`)
  await st('(ed) => ed.undo()')
  check('menu: undo restores the order', (await order(st)) === 'abc')

  await bar(page, 'a').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Bring forward/ }).click()
  check('menu: Bring forward moves one step', (await order(st)) === 'bac')
  await bar(page, 'a').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Send backward/ }).click()
  check('menu: Send backward moves one step back', (await order(st)) === 'abc')
  await bar(page, 'c').click({ button: 'right' })
  const front = await page.getByRole('menuitem').evaluateAll((els) => els.filter((e) => /front|forward/i.test(e.textContent)).map((e) => e.getAttribute('aria-disabled')))
  check('menu: the front item has the two forward entries disabled', front.length === 2 && front.every((x) => x === 'true'), JSON.stringify(front))
  await page.keyboard.press('Escape')

  // keyboard shortcuts act on the selected overlay
  await bar(page, 'a').click()
  await page.keyboard.press('Control+]')
  check('shortcut: Ctrl+] brings the selected overlay forward', (await order(st)) === 'bac')
  await page.keyboard.press('Control+Shift+}')
  check('shortcut: Ctrl+Shift+] brings it to the front', (await order(st)) === 'bca')
  await page.keyboard.press('Control+[')
  check('shortcut: Ctrl+[ sends it backward', (await order(st)) === 'bac')
  await page.keyboard.press('Control+Shift+{')
  check('shortcut: Ctrl+Shift+[ sends it to the back', (await order(st)) === 'abc')
  await context.close()
}

// ---------------------------------------------------------------------------------------------------------
// 2. dragging across lanes with the mouse
{
  const { context, page, st } = await openEditor()
  const rh = await rowHeight(page)

  // up: A (bottom lane) dropped on the top lane
  const p0 = await past(st)
  await dragBy(page, 'a', 0, -2 * rh, { hold: true })
  const row = await page.locator('[data-role="lane-drop-row"]').boundingBox()
  const line = page.locator('[data-role="lane-drop-line"]')
  const ghost = await page.locator('[data-role="lane-drop-ghost"]').boundingBox()
  const laneBox = await page.locator('[data-lane="overlay"]').boundingBox()
  check('drag up: the target lane is highlighted (top lane)', row && Math.abs(row.y - laneBox.y) < 2 && Math.abs(row.height - rh) < 2, JSON.stringify({ row, laneBox }))
  check('drag up: an insertion line marks "in front" at the top edge of that lane', (await line.getAttribute('data-side')) === 'front' && Math.abs((await line.boundingBox()).y - laneBox.y) < 3)
  check('drag up: a ghost bar shows where it lands', ghost && Math.abs(ghost.y - laneBox.y) < rh)
  const dragged = await bar(page, 'a').boundingBox()
  check('drag up: the dragged bar follows the pointer upwards', dragged.y < laneBox.y + rh)
  check('drag up: nothing is committed while dragging', (await order(st)) === 'abc')
  await page.screenshot({ path: `${SHOTS}/laneorder-drag-up-light.png` })
  await page.mouse.up()
  await page.waitForTimeout(250)
  check('drag up: released on the top lane, A is in front of B and C (one undo step)', (await order(st)) === 'bca' && (await topDown(page)) === 'acb' && (await past(st)) === p0 + 1, `${await order(st)} ${await topDown(page)} ${(await past(st)) - p0}`)
  check('drag up: the indicators are gone after the drop', (await page.locator('[data-role^="lane-drop"]').count()) === 0)
  await st('(ed) => ed.undo()')
  check('drag up: undo restores the order in one step', (await order(st)) === 'abc' && (await past(st)) === p0)

  // down: C (top lane) dropped on the bottom lane
  await dragBy(page, 'c', 0, 2 * rh, { hold: true })
  check('drag down: the insertion line marks "behind" at the lower edge', (await page.locator('[data-role="lane-drop-line"]').getAttribute('data-side')) === 'back')
  await page.mouse.up()
  await page.waitForTimeout(250)
  check('drag down: C is behind A and B', (await order(st)) === 'cab' && (await topDown(page)) === 'bac', `${await order(st)} ${await topDown(page)}`)
  await st('(ed) => ed.undo()')

  // one lane only
  await dragBy(page, 'b', 0, -rh)
  check('drag one lane up: B goes in front of the item above (C)', (await order(st)) === 'acb', await order(st))
  await st('(ed) => ed.undo()')

  // same lane: a small vertical wobble changes nothing and makes no undo step
  const p1 = await past(st)
  await dragBy(page, 'b', 0, 6)
  check('same lane: a small vertical wobble changes nothing', (await order(st)) === 'abc' && (await past(st)) === p1 && (await page.locator('[data-role^="lane-drop"]').count()) === 0)

  // horizontal drag keeps moving in time
  const s0 = await startsOf(st)
  await dragBy(page, 'b', 80, 0)
  const s1 = await startsOf(st)
  check('horizontal drag: moves in time as before and keeps the order', s1.b > s0.b && s1.a === s0.a && (await order(st)) === 'abc' && (await past(st)) === p1 + 1, JSON.stringify({ s0, s1 }))
  await st('(ed) => ed.undo()')

  // diagonal: both in one undo step
  const p2 = await past(st)
  const s2 = await startsOf(st)
  await dragBy(page, 'a', 90, -2 * rh)
  const s3 = await startsOf(st)
  check('diagonal drag: moves in time and changes the stacking in one undo step', s3.a > s2.a && (await order(st)) === 'bca' && (await past(st)) === p2 + 1, JSON.stringify({ s2, s3, order: await order(st) }))
  const end = await st('(ed) => ed.videoEndMicros')
  const a = await st('(ed) => ed.project.overlays.find((o) => o.id === "a")')
  check('diagonal drag: the item still ends before the video end', a.start + a.duration <= end, JSON.stringify({ a, end }))
  await st('(ed) => ed.undo()')
  check('diagonal drag: one undo restores time and order', (await order(st)) === 'abc' && (await startsOf(st)).a === s2.a)

  // Escape cancels: vertical and diagonal
  const p3 = await past(st)
  const future0 = await st('(ed) => ed.history.future.length')
  await dragBy(page, 'a', 70, -2 * rh, { hold: true })
  check('escape: while dragging the indicators show', (await page.locator('[data-role="lane-drop-line"]').count()) === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check('escape: the indicators are gone and the time move is rolled back', (await page.locator('[data-role^="lane-drop"]').count()) === 0 && (await startsOf(st)).a === s2.a)
  await page.mouse.move(400, 500)
  await page.mouse.up()
  await page.waitForTimeout(200)
  check('escape: releasing afterwards changes nothing and leaves no undo step or redo entry', (await order(st)) === 'abc' && (await past(st)) === p3 && (await st('(ed) => ed.history.future.length')) === future0, `${await order(st)} ${(await past(st)) - p3}`)

  // trimming a selected bar still works next to the lane drag
  await bar(page, 'b').click()
  const d0 = (await st('(ed) => ed.project.overlays.find((o) => o.id === "b").duration'))
  const handle = page.locator('[data-lane="overlay"] [data-kind="overlay"] [data-handle="end"]')
  const hb = await handle.boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x - 40, hb.y + hb.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  check('trim: the end handle still trims', (await st('(ed) => ed.project.overlays.find((o) => o.id === "b").duration')) < d0 && (await order(st)) === 'abc')
  await context.close()
}

// ---------------------------------------------------------------------------------------------------------
// 3. dark screenshot of a drag
{
  const { context, page } = await openEditor({ colorScheme: 'dark' })
  const rh = await rowHeight(page)
  await dragBy(page, 'a', 0, -2 * rh, { hold: true })
  await page.screenshot({ path: `${SHOTS}/laneorder-drag-up-dark.png` })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await context.close()
}

// ---------------------------------------------------------------------------------------------------------
// 4. touch: a long press lifts the bar, then it can go up and down too
{
  const { context, page, st } = await openEditor({ viewport: { width: 1024, height: 700 }, hasTouch: true, isMobile: false })
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  if (!coarse) {
    console.log('SKIP touch: this Chromium does not report a coarse pointer')
  } else {
    const cdp = await context.newCDPSession(page)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
    const c = await centre(page, 'a')
    await touch('touchStart', c.x, c.y)
    await page.waitForTimeout(500)
    check('touch: a long press lifts the bar', (await page.locator('[data-lifted="true"]').count()) === 1)
    // Selecting may scroll the lane area, so the target is measured after the lift.
    const laneBox = await page.locator('[data-lane="overlay"]').boundingBox()
    const topY = laneBox.y + laneBox.height / 6
    for (let i = 1; i <= 8; i++) await touch('touchMove', c.x, c.y + ((topY - c.y) * i) / 8)
    await page.waitForTimeout(150)
    check('touch: the drop indicator shows for a vertical move', (await page.locator('[data-role="lane-drop-line"]').count()) === 1)
    await touch('touchEnd', c.x, topY)
    await page.waitForTimeout(300)
    check('touch: the lifted bar dropped on the top lane is in front', (await order(st)) === 'bca', await order(st))
  }
  await context.close()
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
