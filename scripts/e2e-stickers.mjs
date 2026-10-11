// Real-browser check of the picture stickers (Fluent Emoji): gallery with a category dropdown and search, adding one
// puts it on the canvas (preview pixels), the exported MP4 frame (worker export) contains it, a project round trip
// keeps it, and old projects with vector and emoji stickers still render. Writes screenshots to OVERLAY_SHOTS.
// Usage: node scripts/e2e-stickers.mjs (exit code 1 when a check fails). Port 5360 only.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5360
const SHOTS = process.env.OVERLAY_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'

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

/** Opens the category dropdown and picks an entry by its name. */
async function pickCategory(page, name) {
  const trigger = page.locator('[data-role="sticker-category"] button').first()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page.getByRole('option', { name, exact: true }).click()
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}
const errors = []

/** Opens the editor with the checker picture as the only clip, playhead at 1 s. */
async function openEditor(viewport, colorScheme, locale = 'en') {
  const context = await browser.newContext({ viewport, locale, colorScheme })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))
  await page.goto(`http://localhost:${PORT}/app/`)
  await page.waitForSelector('header')
  await page.locator('header button[aria-haspopup]').first().click()
  await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/overlays2-checker.png'))
  await page.waitForFunction(() => document.body.innerText.includes('overlays2-checker.png'))
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: /overlays2-checker\.png/ }).first().click()
  await page.waitForTimeout(500)
  const st = (fn, arg = null) =>
    page.evaluate(
      ([src, a]) => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        const ed = pinia._s.get('editor')
        return new Function('ed', 'a', `return (${src})(ed, a)`)(ed, a)
      },
      [fn, arg]
    )
  await st('(ed) => ed.setPlayhead(1000000)')
  await page.waitForSelector('[data-player-overlay]')
  await page.waitForTimeout(400)
  return { context, page, st }
}

/** Preview picture without the DOM overlay layer, as a base64 PNG. */
async function canvasShot(page) {
  await page.addStyleTag({ content: '[data-player-overlay]{display:none!important}' })
  await page.waitForTimeout(120)
  const buf = await page.locator('canvas').first().screenshot()
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('data-player-overlay') && s.remove()))
  return buf.toString('base64')
}

/** Number of pixels in a fraction rectangle whose colour satisfies a predicate (source text, evaluated in the page). */
function countColour(page, png, predicate, rect = [0, 1, 0, 1]) {
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

// The Fluent heart is red with a lighter highlight; the checker picture has no red.
const isRed = '(r, g, b) => r > 190 && g < 110 && b < 130 && r - g > 100'
const CENTRE = [0.4, 0.6, 0.35, 0.65]

async function openStickers(page) {
  await page.getByRole('tab', { name: /Design|Gestalten/ }).click()
  await page.getByRole('button', { name: /^(Stickers|Aufkleber)$/ }).click()
  await page.waitForSelector('#sticker-grid')
  await page.waitForTimeout(250)
}

// ---------------------------------------------------------------------------------------------------------
// 1. desktop, light: gallery, search, adding, preview pixels
{
  const { context, page, st } = await openEditor({ width: 1440, height: 900 }, 'light')
  await openStickers(page)

  const trigger = page.locator('[data-role="sticker-category"] button').first()
  check('gallery: a labelled "Category" dropdown replaces the sideways scroller', (await page.getByText('Category', { exact: true }).count()) === 1 && (await trigger.getAttribute('aria-haspopup')) === 'listbox')
  const tbox = await trigger.boundingBox()
  check('gallery: the dropdown is 44 px tall and shows the current category', tbox && tbox.height >= 44 && (await trigger.textContent()).includes('Faces'), JSON.stringify(tbox))
  check('gallery: no horizontal scroller is left', (await page.locator('#sticker-grid').evaluate((g) => g.parentElement.querySelectorAll('.overflow-x-auto').length)) === 0)
  await trigger.click()
  const opts = await page.getByRole('option').evaluateAll((els) => els.map((e) => e.textContent.trim()))
  check('gallery: the list starts with All and offers every category plus Shapes', opts[0] === 'All' && opts.includes('Faces') && opts.includes('Animals') && opts.at(-1) === 'Shapes' && opts.length === 10, JSON.stringify(opts))
  check('gallery: options carry an icon', (await page.getByRole('option').first().locator('svg, img').count()) >= 1 && (await page.getByRole('option', { name: 'Animals' }).locator('img').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/stickers-dropdown-open-desktop-light.png` })
  await page.keyboard.press('Escape')
  check('gallery: Escape closes the list and the focus is back on the dropdown', (await trigger.getAttribute('aria-expanded')) === 'false' && (await trigger.evaluate((e) => e === document.activeElement)))
  const facesCount = await page.locator('#sticker-grid [data-sticker]').count()
  check('gallery: the first tab shows the faces', facesCount >= 8 && (await page.locator('[data-sticker="grin"]').count()) === 1, String(facesCount))
  await pickCategory(page, 'Animals')
  check('gallery: the Animals tab shows animals and no faces', (await page.locator('[data-sticker="panda"]').count()) === 1 && (await page.locator('[data-sticker="grin"]').count()) === 0)

  // keyboard: arrow down opens the list, arrows move, Enter picks
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  check('gallery: the keyboard picks the next category (Party)', (await trigger.textContent()).includes('Party') && (await trigger.getAttribute('aria-expanded')) === 'false')
  await pickCategory(page, 'All')
  check('gallery: All shows every category', (await page.locator('[data-sticker="grin"]').count()) === 1 && (await page.locator('[data-sticker="panda"]').count()) === 1)
  await pickCategory(page, 'Animals')

  const small = await page.locator('#sticker-grid button').first().boundingBox()
  check('gallery: tiles are big touch targets', small && small.width >= 80 && small.height >= 80, JSON.stringify(small))
  const imgBox = await page.locator('#sticker-grid img').first().boundingBox()
  check('gallery: sticker pictures are 56 to 90 px', imgBox && imgBox.width >= 56 && imgBox.width <= 90, JSON.stringify(imgBox))
  const lazy = await page.locator('#sticker-grid img').first().getAttribute('loading')
  check('gallery: pictures load lazily', lazy === 'lazy')

  // search works in both languages, across all categories
  const search = page.getByRole('searchbox')
  await search.fill('herz')
  await page.waitForTimeout(150)
  const herz = await page.locator('#sticker-grid [data-sticker]').evaluateAll((els) => els.map((e) => e.dataset.sticker))
  check('search: "herz" finds the hearts while the app is in English', herz.includes('heart') && herz.includes('sparklingHeart') && herz.includes('shape-heart') && !herz.includes('panda'), JSON.stringify(herz))
  await search.fill('heart')
  await page.waitForTimeout(150)
  const heart = await page.locator('#sticker-grid [data-sticker]').evaluateAll((els) => els.map((e) => e.dataset.sticker))
  check('search: "heart" finds the same hearts', heart.includes('heart') && heart.includes('heartEyes') && heart.includes('shape-heart'), JSON.stringify(heart))
  await search.fill('qqqqq')
  await page.waitForTimeout(150)
  check('search: no match shows a message', (await page.locator('#sticker-grid [data-sticker]').count()) === 0 && (await page.getByText('Nothing found').count()) === 1)
  await search.fill('')
  await page.waitForTimeout(150)
  check('search: clearing the search shows the category again', (await page.locator('#sticker-grid [data-sticker]').count()) > 0)

  // adding a sticker
  await pickCategory(page, 'Faces')
  await pickCategory(page, 'Hearts & hands')
  await page.waitForTimeout(150)
  const bg = await (async () => {
    await st('(ed) => ed.select(null)')
    await page.waitForTimeout(300)
    return canvasShot(page)
  })()
  const noRed = await countColour(page, bg, isRed, CENTRE)
  await page.locator('[data-sticker="heart"]').click()
  await page.waitForTimeout(700)
  const item = await st('(ed) => ed.project.overlays[0]')
  check('add: a tap adds a picture sticker with an image id and nothing else', item?.kind === 'sticker' && item.imageId === 'heart' && item.emoji === undefined && item.shape === undefined && item.color === undefined, JSON.stringify(item))
  const sel = await st('(ed) => ed.selection')
  check('add: the new sticker is selected', sel?.kind === 'overlay' && sel.id === item.id)

  const text = await page.evaluate(() => document.body.innerText)
  check('properties: no colour or outline controls for a picture sticker', !/Outline/i.test(text) && (await page.locator('[aria-label="Colour"], [aria-label="Color"]').count()) === 0)
  check('properties: opacity and animation stay available', /Opacity/i.test(text) && /Animation/i.test(text))

  await st('(ed) => ed.select(null)')
  await page.waitForTimeout(400)
  const withHeart = await canvasShot(page)
  const redNow = await countColour(page, withHeart, isRed, CENTRE)
  check('preview: the heart sticker is drawn on the canvas at the centre', redNow > noRed + 800, JSON.stringify({ noRed, redNow }))

  // opacity 0 makes it vanish again, so the pixels really come from the sticker
  await st('(ed, id) => { ed.select({ kind: "overlay", id }); ed.updateSelectedOverlay({ opacity: 0 }); ed.select(null) }', item.id)
  await page.waitForTimeout(400)
  const hidden = await countColour(page, await canvasShot(page), isRed, CENTRE)
  check('preview: at opacity 0 the red pixels are gone', hidden <= noRed + 5, JSON.stringify({ hidden, noRed }))
  await st('(ed, id) => { ed.select({ kind: "overlay", id }); ed.updateSelectedOverlay({ opacity: 1 }); ed.select(null) }', item.id)

  // rotation and size patches go through the shared ops
  await st('(ed, id) => { ed.select({ kind: "overlay", id }); ed.updateSelectedOverlay({ size: 0.3, rotation: 15 }); ed.select(null) }', item.id)
  await page.waitForTimeout(400)
  const bigger = await countColour(page, await canvasShot(page), isRed, [0.3, 0.7, 0.25, 0.75])
  check('preview: a bigger sticker covers more pixels', bigger > redNow, JSON.stringify({ bigger, redNow }))

  // --- export in the worker: the exported frame contains the heart
  const exported = await page.evaluate(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const ed = pinia._s.get('editor')
    const { startExport } = await import('/src/engine/export/exportClient.ts')
    const { FONT_SOURCES } = await import('/src/ui/fontUrls.ts')
    const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
    const { frameStart } = await import('/src/core/time.ts')
    const files = {}
    for (const asset of ed.project.assets) files[asset.id] = new File([await (await fetch(`/tests/fixtures/${asset.name}`)).blob()], asset.name)
    const running = startExport({ project: JSON.parse(JSON.stringify(ed.project)), files, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, FONT_SOURCES, () => undefined)
    const res = await running.promise
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
    return { frames: res.frames, inWorker: running.inWorker, png: btoa(bin) }
  })
  // The video encoder smears colours a little: a looser red test.
  const redExport = await countColour(page, exported.png, '(r, g, b) => r > 170 && r - g > 80 && r - b > 60', [0.3, 0.7, 0.25, 0.75])
  check('export: the exported frame contains the heart sticker', redExport > 400 && exported.frames > 30, JSON.stringify({ redExport, frames: exported.frames }))
  check('export: it ran in the worker (fetch + createImageBitmap there)', exported.inWorker === true)
  writeFileSync(`${SHOTS}/stickers-export-frame.png`, Buffer.from(exported.png, 'base64'))

  // --- an old project with vector and emoji stickers still renders
  await st(
    `(ed) => ed.commitProject({ ...ed.project, overlays: [
      { id: 'v1', kind: 'sticker', start: 0, duration: 9000000, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, size: 0.3, shape: 'heart', color: '#ff0000', outline: null },
      { id: 'e1', kind: 'sticker', start: 0, duration: 9000000, pos: { x: 0.2, y: 0.5 }, scale: 1, rotation: 0, size: 0.2, emoji: '⭐' }
    ] })`
  )
  await st('(ed) => { ed.setPlayhead(1000000); ed.select(null) }')
  await page.waitForTimeout(700)
  const legacyShot = await canvasShot(page)
  const vec = await countColour(page, legacyShot, '(r, g, b) => r > 220 && g < 40 && b < 40', CENTRE)
  check('legacy: a vector sticker from an old project still renders', vec > 800, JSON.stringify({ vec }))
  const legacyOk = await page.evaluate(async () => {
    const { parseProjectJson } = await import('/src/core/project/schema.ts')
    const doc = {
      version: 1, name: 'old', format: { ratio: '16:9', width: 1920, height: 1080, fps: 30, background: { type: 'blur' } },
      assets: [], clips: [], texts: [], stickers: [], drawings: [], music: [],
      overlays: [
        { id: 'a', kind: 'sticker', start: 0, duration: 1000000, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, size: 0.12, shape: 'lightbulb', color: '#ffe14d', outline: null },
        { id: 'b', kind: 'sticker', start: 0, duration: 1000000, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, size: 0.12, emoji: '⭐' }
      ]
    }
    return parseProjectJson(JSON.stringify(doc)).ok
  })
  check('legacy: removed-from-gallery vector shapes and emoji stickers still validate', legacyOk === true)

  // --- screenshots: gallery (light), a frame with several stickers
  await st(
    `(ed) => ed.commitProject({ ...ed.project, overlays: ${JSON.stringify(['partyPopper', 'cool', 'heart', 'unicorn', 'rocket', 'trophy', 'pizza', 'thumbsUp'])}.map((imageId, i) => ({ id: 'g' + i, kind: 'sticker', start: 0, duration: 9000000, pos: { x: 0.14 + (i % 4) * 0.24, y: 0.3 + Math.floor(i / 4) * 0.4 }, scale: 1, rotation: [-12, 8, -6, 10, 0, -8, 12, -4][i], size: 0.2, imageId })) })`
  )
  await st('(ed) => { ed.setPlayhead(1000000); ed.select(null) }')
  await page.waitForTimeout(800)
  writeFileSync(`${SHOTS}/stickers-frame-light.png`, Buffer.from(await canvasShot(page), 'base64'))
  await pickCategory(page, 'Faces').catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/stickers-gallery-desktop-light.png` })
  await pickCategory(page, 'Hearts & hands').catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/stickers-gallery-desktop-hearts-light.png` })
  await page.getByRole('searchbox').fill('par')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/stickers-search-desktop-light.png` })
  // --- save and load: the project keeps the sticker
  const reloaded = await page.evaluate(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const ed = pinia._s.get('editor')
    const { parseProjectJson, serializeProject } = await import('/src/core/project/schema.ts')
    const parsed = parseProjectJson(serializeProject(ed.project))
    if (!parsed.ok) return { ok: false, errors: parsed.errors }
    const before = JSON.stringify(ed.project.overlays)
    ed.replaceDocument(parsed.project, { handle: null, name: null })
    return { ok: true, count: ed.project.overlays.length, same: JSON.stringify(ed.project.overlays) === before }
  })
  check('file: save and load keeps the picture stickers, their ids, size and rotation', reloaded.ok && reloaded.count === 8 && reloaded.same, JSON.stringify(reloaded))

  await context.close()
}

// 2. desktop, dark
{
  const { context, page, st } = await openEditor({ width: 1440, height: 900 }, 'dark', 'de')
  await openStickers(page)
  check('german: the dropdown and the search are translated', (await page.getByText('Kategorie', { exact: true }).count()) === 1 && (await page.getByRole('searchbox').getAttribute('aria-label')) === 'Aufkleber suchen')
  await page.getByRole('searchbox').fill('heart')
  await page.waitForTimeout(150)
  check('german: searching the English word finds German-labelled stickers', (await page.locator('[data-sticker="heart"]').count()) === 1)
  await page.getByRole('searchbox').fill('')
  await page.locator('[data-role="sticker-category"] button').first().click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${SHOTS}/stickers-dropdown-open-desktop-dark.png` })
  await page.getByRole('option', { name: 'Tiere', exact: true }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/stickers-gallery-desktop-dark.png` })
  await st(
    `(ed) => ed.commitProject({ ...ed.project, overlays: ${JSON.stringify(['fox', 'panda', 'unicorn', 'frog', 'penguin', 'owl'])}.map((imageId, i) => ({ id: 'g' + i, kind: 'sticker', start: 0, duration: 9000000, pos: { x: 0.2 + (i % 3) * 0.3, y: 0.3 + Math.floor(i / 3) * 0.4 }, scale: 1, rotation: 0, size: 0.22, imageId })) })`
  )
  await st('(ed) => { ed.setPlayhead(1000000); ed.select(null) }')
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/stickers-editor-desktop-dark.png` })
  await context.close()
}

// 3. phone, light and dark
for (const scheme of ['light', 'dark']) {
  const { context, page, st } = await openEditor({ width: 390, height: 844 }, scheme)
  await page.getByRole('tab', { name: /Design|Gestalten/ }).click().catch(() => {})
  await page.getByRole('button', { name: /^(Stickers|Aufkleber)$/ }).click().catch(() => {})
  await page.waitForTimeout(500)
  const grid = await page.locator('#sticker-grid').count()
  check(`phone ${scheme}: the sticker gallery opens`, grid === 1)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check(`phone ${scheme}: no horizontal page scroll`, !overflow)
  const tile = await page.locator('#sticker-grid button').first().boundingBox()
  check(`phone ${scheme}: tiles keep 44 px touch targets`, tile && tile.width >= 44 && tile.height >= 44, JSON.stringify(tile))
  await page.screenshot({ path: `${SHOTS}/stickers-gallery-phone-${scheme}.png` })
  const ptrigger = page.locator('[data-role="sticker-category"] button').first()
  const pbox = await ptrigger.boundingBox()
  check(`phone ${scheme}: the category dropdown is 44 px tall and fits the width`, pbox && pbox.height >= 44 && pbox.x >= 0 && pbox.x + pbox.width <= 390, JSON.stringify(pbox))
  await ptrigger.click()
  await page.waitForTimeout(200)
  const obox = await page.getByRole('option').nth(1).boundingBox()
  check(`phone ${scheme}: list options keep 44 px`, obox && obox.height >= 44 && obox.x + obox.width <= 390, JSON.stringify(obox))
  await page.screenshot({ path: `${SHOTS}/stickers-dropdown-open-phone-${scheme}.png` })
  await page.keyboard.press('Escape')
  await page.locator('#sticker-grid').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/stickers-gallery-phone-scrolled-${scheme}.png` })
  await page.locator('[data-sticker="grin"]').click()
  await page.waitForTimeout(600)
  const added = await st('(ed) => ed.project.overlays[0]?.imageId')
  check(`phone ${scheme}: a tap adds the sticker`, added === 'grin', String(added))
  await page.screenshot({ path: `${SHOTS}/stickers-editor-phone-${scheme}.png` })
  await context.close()
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
