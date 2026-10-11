// Real-browser check of the design tabs: every item kind is selected on creation and shows the same sections,
// no position fields or 9-position grid anywhere, arrow keys move the selection, the pen stays on after a stroke,
// stacking buttons reorder, rounded blur/pixelate areas are really rounded (pixels), and screenshots of every tab
// with an item selected (desktop and phone, light and dark). Usage: node scripts/e2e-design.mjs (exit 1 on failure).
// Port 5310 (E2E_PORT overrides it). Screenshots go to OVERLAY_SHOTS or the scratchpad folder.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.E2E_PORT ?? 5310)
const SHOTS = process.env.OVERLAY_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const SECTIONS = ['Content', 'Look', 'Timing', 'Animation', 'Order', 'Actions']
const FORBIDDEN_POSITION = ['Top', 'Middle', 'Bottom', 'Left', 'Centre', 'Center', 'Right', 'Horizontal', 'Vertical']

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ root, server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en', colorScheme: 'light' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))
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

/** Sum of the colour change between two shots inside a fraction rectangle [x0, x1, y0, y1]. */
function diffSum(a, b, rect) {
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
      let sum = 0
      for (let y = Math.floor(r[2] * h); y < Math.ceil(r[3] * h); y++) {
        for (let x = Math.floor(r[0] * w); x < Math.ceil(r[1] * w); x++) {
          const i = (y * w + x) * 4
          sum += Math.abs(pa.d[i] - pb.d[i]) + Math.abs(pa.d[i + 1] - pb.d[i + 1]) + Math.abs(pa.d[i + 2] - pb.d[i + 2])
        }
      }
      return sum
    },
    [a, b, rect]
  )
}

/** Opens the app with one picture (the checker fixture) on the timeline, playhead at 1 s. */
async function newProjectWithPicture(p = page) {
  await p.goto(`http://localhost:${PORT}/app/`)
  await p.waitForSelector('header')
  await p.locator('header button[aria-haspopup]').first().click()
  await p.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await p.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/overlays2-checker.png'))
  await p.waitForFunction(() => document.body.innerText.includes('overlays2-checker.png'))
  await p.waitForTimeout(250)
  await p.getByRole('button', { name: /overlays2-checker\.png/ }).first().click()
  await p.waitForTimeout(500)
  await p.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    pinia._s.get('editor').setPlayhead(1000000)
  })
  await p.waitForSelector('[data-player-overlay]')
  await p.waitForTimeout(400)
}

/** Headings of the left panel's sections (h3), in order. */
const sectionTitles = async () => (await page.locator('aside h3').allTextContents()).map((t) => t.trim())
/** Names of the number fields and buttons and sliders in the left panel. */
const panelNames = () => page.evaluate(() => [...document.querySelectorAll('aside input, aside button, aside select, aside textarea')].map((e) => e.getAttribute('aria-label') || (e.textContent || '').trim() || e.getAttribute('name') || '').filter(Boolean))

// --- 1. creating each kind selects it and shows the same sections --------------------------------
await newProjectWithPicture()
await page.getByRole('tab', { name: 'Design', exact: true }).click()
const kinds = {}

await page.getByRole('button', { name: 'Text', exact: true }).click()
await page.getByRole('button', { name: 'Add text', exact: true }).click()
await page.getByRole('heading', { name: /^Text · / }).waitFor()
kinds.text = { sections: await sectionTitles(), selection: await st('(ed) => ed.selection') }

await page.getByRole('button', { name: 'Stickers', exact: true }).click()
await page.getByRole('button', { name: 'Star', exact: true }).click()
await page.getByRole('heading', { name: /^Sticker · / }).waitFor()
kinds.sticker = { sections: await sectionTitles(), selection: await st('(ed) => ed.selection') }
const stickerId = kinds.sticker.selection?.id

await page.getByRole('button', { name: 'Shapes', exact: true }).click()
await page.getByRole('button', { name: 'Frame', exact: true }).click()
await page.getByRole('heading', { name: /^Shape · / }).waitFor()
kinds.shape = { sections: await sectionTitles(), selection: await st('(ed) => ed.selection') }

await page.getByRole('button', { name: 'Hide', exact: true }).click()
await page.getByRole('button', { name: 'Blur an area', exact: true }).click()
await page.getByRole('heading', { name: /^Area · / }).waitFor()
kinds.region = { sections: await sectionTitles(), selection: await st('(ed) => ed.selection') }

await page.getByRole('button', { name: 'Picture in picture', exact: true }).click()
await page.getByRole('button', { name: 'Add overlays2-checker.png at the playhead', exact: true }).click()
await page.getByRole('heading', { name: /^Picture · / }).waitFor()
kinds.picture = { sections: await sectionTitles(), selection: await st('(ed) => ed.selection') }

for (const [name, kind] of Object.entries(kinds)) {
  check(`${name}: created and selected`, kind.selection !== null, JSON.stringify(kind.selection))
  check(`${name}: shows the sections ${SECTIONS.join(' / ')}`, JSON.stringify(kind.sections) === JSON.stringify(SECTIONS), JSON.stringify(kind.sections))
}

// --- 1b. the library adds a picture in the picture; Round makes a square with a full radius -------
await page.getByRole('tab', { name: 'Material', exact: true }).click()
await page.getByRole('button', { name: 'Media', exact: true }).click()
await page.getByRole('button', { name: 'As picture in picture', exact: true }).first().click()
await settle(200)
const fromLibrary = await st('(ed) => ed.selectedItem && ed.selectedItem.kind')
check('library: "As picture in picture" adds a picture and selects it', fromLibrary === 'media', String(fromLibrary))
await page.getByRole('tab', { name: 'Design', exact: true }).click()
await page.getByRole('button', { name: 'Round', exact: true }).click()
await settle(150)
const round = await st('(ed) => ed.selectedItem')
check('pictures: Round is a square box with a full radius', Math.abs(round.width - round.height) < 1e-9 && round.radius === 0.5, JSON.stringify({ w: round.width, h: round.height, r: round.radius }))

// --- 2. no position fields and no 9-position grid, on any item ----------------------------------
let positionHits = []
for (const name of ['text', 'sticker', 'shape', 'region', 'picture']) {
  await st('(ed, id) => ed.select(null)', null)
  const ref = await st('(ed, n) => ed.project.overlays.length', name)
  void ref
}
// Select each kind again through the store and inspect its panel.
const allItems = await st('(ed) => [...ed.project.texts.map((t) => ({ kind: "text", id: t.id })), ...ed.project.overlays.map((o) => ({ kind: "overlay", id: o.id }))]')
for (const item of allItems) {
  await st('(ed, ref) => ed.select(ref)', item)
  await settle(120)
  const names = await panelNames()
  const bad = names.filter((n) => FORBIDDEN_POSITION.includes(n))
  if (bad.length) positionHits.push(`${item.kind} ${item.id}: ${bad.join(',')}`)
  const spins = await page.locator('aside input[type=number]').evaluateAll((els) => els.map((e) => e.labels?.[0]?.textContent?.trim() ?? e.getAttribute('aria-label') ?? ''))
  const extra = spins.filter((s) => !/^(Start|Duration|Start \(s\)|Duration \(s\)|Start in the video \(s\))/.test(s))
  if (extra.length) positionHits.push(`${item.kind} ${item.id} numbers: ${extra.join(',')}`)
}
check('no position fields (horizontal / vertical / 9 positions) on any item, text included', positionHits.length === 0, positionHits.join(' | '))

// --- 3. arrow keys move the selected item (Shift = bigger step) ---------------------------------
await st('(ed, ref) => ed.select(ref)', { kind: 'overlay', id: stickerId })
await page.evaluate(() => document.activeElement?.blur())
const beforeArrow = await st('(ed) => ed.selectedItem.pos.x')
await page.keyboard.press('ArrowRight')
await settle(120)
const afterArrow = await st('(ed) => ed.selectedItem.pos.x')
check('arrow right moves the selected sticker by 1 %', Math.abs(afterArrow - beforeArrow - 0.01) < 1e-6, JSON.stringify({ beforeArrow, afterArrow }))
await page.keyboard.press('Shift+ArrowLeft')
await settle(120)
const afterShift = await st('(ed) => ed.selectedItem.pos.x')
check('Shift + arrow left moves it by 5 %', Math.abs(afterShift - afterArrow + 0.05) < 1e-6, JSON.stringify({ afterArrow, afterShift }))

await st('(ed, ref) => ed.select(ref)', { kind: 'text', id: (await st('(ed) => ed.project.texts[0].id')) })
await page.evaluate(() => document.activeElement?.blur())
const textBefore = await st('(ed) => ed.selectedItem.pos.y')
await page.keyboard.press('ArrowDown')
await settle(120)
const textAfter = await st('(ed) => ed.selectedItem.pos.y')
check('arrow down moves the selected text', Math.abs(textAfter - textBefore - 0.01) < 1e-6, JSON.stringify({ textBefore, textAfter }))
await page.keyboard.press('Delete')
await settle(120)
check('Delete removes the selected text', (await st('(ed) => ed.project.texts.length')) === 0)

// --- 4. stacking buttons change the order (one undo step each) ----------------------------------
await st('(ed, ref) => ed.select(ref)', { kind: 'overlay', id: stickerId })
await settle(150)
await page.getByRole('button', { name: 'To back', exact: true }).click()
await settle(150)
const orderBack = await st('(ed, id) => ed.project.overlays.findIndex((o) => o.id === id)', stickerId)
check('stacking: To back puts the selected item first in the list', orderBack === 0, String(orderBack))
await page.getByRole('button', { name: 'To front', exact: true }).click()
await settle(150)
const orderFront = await st('(ed, id) => ed.project.overlays.findIndex((o) => o.id === id)', stickerId)
const count = await st('(ed) => ed.project.overlays.length')
check('stacking: To front puts it last', orderFront === count - 1, `${orderFront} of ${count}`)

// --- 5. the pen stays on after a stroke; Done ends it; a stroke is selected like other items -----
await page.getByRole('button', { name: 'Draw', exact: true }).click()
await page.getByRole('button', { name: 'Start drawing', exact: true }).click()
await settle(150)
const surface = page.locator('[data-role=draw-surface]')
const box = await surface.boundingBox()
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
await page.mouse.down()
for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.3 + 0.04 * i), box.y + box.height * (0.3 + 0.01 * i))
await page.mouse.up()
await settle(250)
check('pen: the stroke is added', (await st('(ed) => ed.project.overlays.filter((o) => o.kind === "stroke").length')) === 1)
check('pen: drawing stays on after a stroke', (await st('(ed) => ed.drawing')) === true)
check('pen: the Done button is shown while drawing', await page.getByRole('button', { name: 'Done', exact: true }).isVisible())
await page.getByRole('button', { name: 'Marker (highlighter)', exact: true }).click()
const marker = await st('(ed) => ({ cap: ed.penCap, opacity: ed.penOpacity })')
check('pen: the marker preset is flat-ended at 40 % opacity', marker.cap === 'flat' && Math.abs(marker.opacity - 0.4) < 1e-9, JSON.stringify(marker))
await page.getByRole('button', { name: 'Done', exact: true }).click()
await settle(150)
check('pen: Done ends drawing', (await st('(ed) => ed.drawing')) === false)
const pick = await page.locator('[data-role=pick]').boundingBox()
await page.mouse.click(pick.x + pick.width * 0.5, pick.y + pick.height * 0.3)
await settle(250)
const strokeSel = await st('(ed) => { const s = ed.selection; return s && ed.project.overlays.find((o) => o.id === s.id)?.kind }')
check('pen: after Done a click on the stroke selects it', strokeSel === 'stroke', String(strokeSel))
check('pen: the stroke shows the same sections', JSON.stringify(await sectionTitles()) === JSON.stringify(SECTIONS), JSON.stringify(await sectionTitles()))
await st('(ed) => ed.select(null)')

// --- 6. rounded blur / pixelate areas are rounded (pixels outside the corner are untouched) -----
await st('(ed) => { ed.setPlayhead(1000000); ed.setRegionShape("roundRect"); ed.commitProject({ ...ed.project, overlays: [] }); ed.addRegionAtPlayhead("pixelate"); ed.updateSelectedOverlay({ width: 0.5, height: 0.4, radius: 0.2, strength: 1, pos: { x: 0.5, y: 0.5 } }) }')
await settle(500)
const withRound = await canvasShot()
await st('(ed) => ed.updateSelectedOverlay({ shape: "rect" })')
await settle(700)
const withRect = await canvasShot()
await st('(ed) => ed.commitProject({ ...ed.project, overlays: [] })')
await settle(500)
const base = await canvasShot()
// Box: 0.5 x 1080 px wide and 0.4 x 1080 px high at the centre of a 16:9 picture. The corner point is 6 px inside.
const corner = [0.3625, 0.3625 + 0.004, 0.3056, 0.3056 + 0.004]
const control = [0.05, 0.1, 0.05, 0.1]
const controlSum = await diffSum(withRound, base, control)
const cornerRound = await diffSum(withRound, base, corner)
const cornerRect = await diffSum(withRect, base, corner)
const centre = [0.47, 0.53, 0.45, 0.55]
const centreRound = await diffSum(withRound, base, centre)
check('rounded: the centre of a rounded pixelate area is changed', centreRound > 1000, String(centreRound))
check('rounded: the corner outside the rounded edge is untouched', cornerRound < 50 && controlSum === 0, `round ${cornerRound}, rect corner ${cornerRect}, control ${controlSum}`)
check('rounded: the same corner of a plain rectangle is changed', cornerRect > cornerRound + 500, `rect ${cornerRect}`)
await st('(ed) => ed.commitProject({ ...ed.project, overlays: [] })')

// --- 7. touch: every control in the design panels is at least 44 px high on a phone -------------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en', colorScheme: 'light', hasTouch: true, isMobile: true })
const phonePage = await phone.newPage()
phonePage.on('pageerror', (e) => errors.push(e.message))
await newProjectWithPicture(phonePage)
const tooSmall = []
for (const tab of ['Text', 'Stickers', 'Shapes', 'Draw', 'Hide', 'Picture in picture']) {
  if (tab === 'Text') await phonePage.getByRole('tab', { name: 'Design', exact: true }).click()
  await phonePage.getByRole('button', { name: tab, exact: true }).first().click()
  await phonePage.waitForTimeout(200)
  const small = await phonePage.locator('aside button:visible, aside input:visible, aside select:visible, aside textarea:visible').evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().height < 43.5 && !e.closest('[aria-hidden="true"]')).map((e) => `${e.tagName}:${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}`)
  )
  if (small.length) tooSmall.push(`${tab}: ${small.slice(0, 4).join(' ; ')}`)
}
check('touch: tab panels have 44 px tap targets on a phone', tooSmall.length === 0, tooSmall.join(' | '))
await phone.close()

// --- 8. screenshots: every tab with an item selected, desktop and phone, light and dark ---------
const TABS = [
  { tab: 'Text', name: 'text', make: (ed) => ed.addTextAtPlayhead('title', 'Hallo') },
  { tab: 'Stickers', name: 'sticker', make: (ed) => ed.addVectorStickerAtPlayhead('heart') },
  { tab: 'Shapes', name: 'shape', make: (ed) => ed.addShapeAtPlayhead('ellipse') },
  { tab: 'Draw', name: 'draw', make: null },
  { tab: 'Hide', name: 'region', make: (ed) => ed.addRegionAtPlayhead('blur') },
  { tab: 'Picture in picture', name: 'picture', make: (ed) => ed.addMediaAtPlayhead(ed.project.assets.find((a) => a.kind !== 'audio').id) }
]
const VIEWS = [
  { label: 'desktop', size: { width: 1440, height: 900 }, touch: false },
  { label: 'phone', size: { width: 390, height: 844 }, touch: true }
]
for (const view of VIEWS) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: view.size, locale: 'en', colorScheme: scheme, hasTouch: view.touch, isMobile: view.touch })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    await newProjectWithPicture(p)
    await p.getByRole('tab', { name: 'Design', exact: true }).click()
    for (const shot of TABS) {
      await p.getByRole('button', { name: shot.tab, exact: true }).first().click()
      await p.waitForTimeout(150)
      if (shot.make) {
        await p.evaluate((src) => {
          const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
          const ed = pinia._s.get('editor')
          new Function('ed', `return (${src})(ed)`)(ed)
        }, shot.make.toString())
      } else {
        await p.evaluate(() => {
          const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
          const ed = pinia._s.get('editor')
          ed.setDrawing(true)
          ed.commitProject({ ...ed.project, overlays: [...ed.project.overlays, { id: 'demo-stroke', kind: 'stroke', start: 0, duration: 9000000, pos: { x: 0.5, y: 0.4 }, scale: 1, rotation: 0, points: [[-0.2, 0], [-0.1, -0.05], [0, 0], [0.1, 0.05], [0.2, 0]], lineWidth: 0.008, color: '#ff5ca8' }] })
          ed.setDrawing(false)
          ed.select({ kind: 'overlay', id: 'demo-stroke' })
        })
      }
      await p.waitForTimeout(350)
      await p.screenshot({ path: `${SHOTS}/design-${shot.name}-${view.label}-${scheme}.png` })
    }
    await ctx.close()
  }
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
