// Real-browser check of the animated stickers (Fluent Emoji animated): nothing is requested on the first load,
// the 'Animated' switch loads only the visible tiles' sheets, an animated sticker is a whole number of loops long
// ('3 x' in its bar), the picture changes inside a loop and repeats after one, the exported frames (worker export)
// follow the same cells, trimming and the video end snap to whole loops, switching off gives the still picture,
// a saved project keeps the flag, a missing sheet falls back to the still picture. Writes screenshots to OVERLAY_SHOTS
// (animstickers-*.png). Usage: node scripts/e2e-animstickers.mjs (exit code 1 when a check fails). Port 5390 only.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5390
const SHOTS = process.env.OVERLAY_SHOTS ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
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

/**
 * Opens the editor with the checker picture as the only clip (8 s long), playhead at 1 s. `requests` collects the
 * URLs of animation sheets that the page asks for, from the very first navigation on.
 */
async function openEditor(viewport, colorScheme, locale = 'en', { blockSheets = false } = {}) {
  const context = await browser.newContext({ viewport, locale, colorScheme })
  // Playwright's Chromium has no file dialog: the save path falls back to a download.
  await context.addInitScript(() => {
    delete window.showSaveFilePicker
  })
  const requests = []
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && !(blockSheets && /sticker-anim|ERR_FAILED/.test(m.text() + m.location().url)) && errors.push(m.text()))
  // The dev server hands out each `?url` asset as a tiny script module that exports the URL; only the file itself counts.
  page.on('request', (r) => /sticker-anim-/.test(r.url()) && r.resourceType() !== 'script' && !r.url().includes('?') && requests.push(r.url().replace(/^.*sticker-anim-([A-Za-z0-9]+).*$/, '$1')))
  // Only the sheet files fail; the dev server's url modules (scripts) must still load.
  if (blockSheets) await page.route(/sticker-anim-/, (route) => (route.request().resourceType() === 'script' ? route.continue() : route.abort()))
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
  // Eight seconds of picture, so several loops fit.
  await st('(ed) => ed.commitProject({ ...ed.project, clips: ed.project.clips.map((c) => ({ ...c, srcOut: c.srcIn + 8000000 })) })')
  await st('(ed) => ed.setPlayhead(1000000)')
  await page.waitForSelector('[data-player-overlay]')
  await page.waitForTimeout(400)
  return { context, page, st, requests }
}

/** Preview picture without the DOM overlay layer, as a base64 PNG. */
async function canvasShot(page) {
  await page.addStyleTag({ content: '[data-player-overlay]{display:none!important}' })
  await page.waitForTimeout(120)
  const buf = await page.locator('canvas.size-full[role="img"]').first().screenshot()
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('data-player-overlay') && s.remove()))
  return buf.toString('base64')
}

/**
 * Difference of two PNGs (any sizes) after scaling both to 160 x 90: the share of pixels inside a fraction rectangle
 * that changed clearly, and the mean absolute difference per channel there.
 */
function imageDiff(page, a, b, rect = [0.36, 0.64, 0.3, 0.7]) {
  return page.evaluate(
    async ([x, y, r]) => {
      const load = async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(160, 90)
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0, 160, 90)
        return ctx.getImageData(0, 0, 160, 90).data
      }
      const [da, db] = [await load(x), await load(y)]
      let changed = 0
      let sum = 0
      let n = 0
      for (let py = Math.floor(r[2] * 90); py < Math.ceil(r[3] * 90); py++) {
        for (let px = Math.floor(r[0] * 160); px < Math.ceil(r[1] * 160); px++) {
          const i = (py * 160 + px) * 4
          const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
          if (d > 90) changed++
          sum += d / 3
          n++
        }
      }
      return { changed, mean: sum / n, pixels: n }
    },
    [a, b, rect]
  )
}

/**
 * Mean per-channel difference between `a` and `b` over the pixels where `a` differs clearly from `bg` (the same picture
 * without the sticker): it looks at the sticker's own pixels only, not at the background behind it. All three are scaled
 * to 320 x 180 first, so a preview and an exported frame of different sizes can be compared.
 */
function stickerDiff(page, a, b, bg) {
  return page.evaluate(
    async ([x, y, z]) => {
      const load = async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(320, 180)
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0, 320, 180)
        return ctx.getImageData(0, 0, 320, 180).data
      }
      const [da, db, dz] = [await load(x), await load(y), await load(z)]
      let sum = 0
      let n = 0
      for (let i = 0; i < da.length; i += 4) {
        const m = Math.abs(da[i] - dz[i]) + Math.abs(da[i + 1] - dz[i + 1]) + Math.abs(da[i + 2] - dz[i + 2])
        if (m < 90) continue
        sum += (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3
        n++
      }
      return { mean: n ? sum / n : 255, pixels: n }
    },
    [a, b, bg]
  )
}

/** Pixels of a PNG in a fraction rectangle that are not like the checker picture: here, anything strongly coloured. */
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
const isRed = '(r, g, b) => r > 190 && g < 110 && b < 130 && r - g > 100'
const CENTRE = [0.4, 0.6, 0.35, 0.65]

async function openStickers(page) {
  await page.getByRole('tab', { name: /Design|Gestalten/ }).click()
  await page.getByRole('button', { name: /^(Stickers|Aufkleber)$/ }).click()
  await page.waitForSelector('#sticker-grid')
  await page.waitForTimeout(250)
}

const animSwitch = (page) => page.locator('[data-animated-switch] [role="switch"]').first()
const sheetsOf = (list) => [...new Set(list)].sort()

// ---------------------------------------------------------------------------------------------------------
// 1. desktop, light: nothing on first load, the switch, lazy sheets, adding, loops, preview pixels
const { context, page, st, requests } = await openEditor({ width: 1440, height: 1200 }, 'light')
{
  check('first load: the editor with a clip requests no animated sheet', requests.length === 0, JSON.stringify(requests))
  await openStickers(page)
  await page.waitForTimeout(500)
  check('gallery: opening the sticker panel requests no sheet either', requests.length === 0, JSON.stringify(requests))
  check('gallery: there is no global "Animated" switch any more', (await page.locator('#sticker-grid').evaluate((g) => g.parentElement.querySelectorAll('[role="switch"], [data-animated-switch]').length)) === 0)
  const badges = await page.locator('#sticker-grid [data-animated-badge]').count()
  const faceTiles = await page.locator('#sticker-grid [data-sticker]').count()
  check('badges: the faces that have an animation show a badge, not every tile', badges >= 8 && badges < faceTiles, `${badges}/${faceTiles}`)
  const badge = page.locator('[data-sticker="grin"] [data-animated-badge]')
  check('badges: the badge is a plain image-like indicator (no button, no play triangle) named "Animated"', (await badge.evaluate((e) => e.tagName === 'SPAN' && e.getAttribute('role') === 'img' && e.getAttribute('aria-label') === 'Animated' && !e.querySelector('path[d^="M3.5"]'))))
  check('gallery: the tiles show still pictures only', (await page.locator('#sticker-grid [data-sticker-animation]').count()) === 0)
  const tileName = await page.locator('[data-sticker="grin"]').innerText()
  check('badges: a tile with an animation says so for screen readers', /animated/i.test(tileName), tileName)

  // hover: a quick pass downloads nothing, resting for 150 ms loads only that tile's sheet
  const centre = async (id) => {
    const box = await page.locator(`[data-sticker="${id}"]`).boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const grin = await centre('grin')
  await page.mouse.move(grin.x, grin.y)
  await page.waitForTimeout(60)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(500)
  check('hover: a quick pass over a tile requests no sheet', requests.length === 0, JSON.stringify(requests))
  await page.mouse.move(grin.x, grin.y)
  await page.waitForFunction(() => document.querySelector('[data-sticker="grin"] [data-sticker-animation]')?.style.visibility === 'visible', null, { timeout: 15000 })
  await page.waitForTimeout(300)
  check('hover: only the hovered tile\'s sheet is requested', JSON.stringify(sheetsOf(requests)) === JSON.stringify(['grin']), JSON.stringify(requests))
  const tileFrames = await page.evaluate(async () => {
    const canvas = document.querySelector('[data-sticker="grin"] [data-sticker-animation]')
    const seen = new Set([canvas.toDataURL()])
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 90))
      seen.add(canvas.toDataURL())
    }
    return seen.size
  })
  check('hover: the tile animates (its canvas shows several different pictures)', tileFrames >= 4, String(tileFrames))
  await page.screenshot({ path: `${SHOTS}/animstickers-gallery-desktop-light.png` })
  const laugh = await centre('laugh')
  await page.mouse.move(laugh.x, laugh.y)
  await page.waitForTimeout(700)
  const canvases = await page.locator('#sticker-grid [data-sticker-animation]').count()
  check('hover: at most one tile animates at a time', canvases <= 1 && (await page.locator('[data-sticker="grin"] [data-sticker-animation]').count()) === 0, String(canvases))
  await page.mouse.move(5, 5)
  await page.waitForTimeout(200)
  check('hover: leaving the tile shows the still picture again', (await page.locator('#sticker-grid [data-sticker-animation]').count()) === 0)

  // keyboard focus plays too, blur stops it
  await page.keyboard.press('Shift')
  await page.locator('[data-sticker="grin"]').focus()
  await page.waitForFunction(() => document.querySelector('[data-sticker="grin"] [data-sticker-animation]') !== null, null, { timeout: 5000 })
  check('focus: a keyboard-focused tile plays its animation', true)
  await page.locator('[data-sticker="grin"]').blur()
  await page.waitForTimeout(200)
  check('focus: blur stops it', (await page.locator('#sticker-grid [data-sticker-animation]').count()) === 0)

  // reduced motion: no playback, no request
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const requestsBefore = requests.length
  const wink = await centre('wink')
  await page.mouse.move(wink.x, wink.y)
  await page.waitForTimeout(700)
  check('reduced motion: hovering plays nothing and requests nothing', (await page.locator('#sticker-grid [data-sticker-animation]').count()) === 0 && requests.length === requestsBefore, JSON.stringify(requests))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.mouse.move(5, 5)

  // other tab: no sheet is requested by switching
  await pickCategory(page, 'Hearts & hands')
  await page.waitForTimeout(500)
  check('lazy: opening the next tab requests no sheet', !sheetsOf(requests).includes('thumbsUp') && !sheetsOf(requests).includes('clap'), JSON.stringify(sheetsOf(requests)))

  // --- add an animated sticker (clap: big motion, 1.2 s loop)
  const loopOf = (id) => page.evaluate(async (i) => (await import('/src/core/render/stickerAnimations.ts')).animatedSticker(i).loopMicros, id)
  const CLAP = await loopOf('clap')
  await st('(ed) => ed.select(null)')
  await page.locator('[data-sticker="clap"]').click()
  await page.waitForTimeout(700)
  check('add: adding requests the sheet of that sticker', sheetsOf(requests).includes('clap'), JSON.stringify(sheetsOf(requests)))
  const item = await st('(ed) => ed.project.overlays[0]')
  check('add: a tap adds an animated sticker by default', item?.kind === 'sticker' && item.imageId === 'clap' && item.animated === true && item.emoji === undefined, JSON.stringify(item))
  check('add: it is selected', (await st('(ed) => ed.selection?.id')) === item.id)
  check('add: its length is exactly three loops (a whole number of loops, in whole microseconds)', item.duration === 3 * CLAP && Number.isInteger(item.duration), `${item.duration} vs ${3 * CLAP}`)
  check('timeline: the bar says how many loops it has ("3 ×")', /Clapping · 3 ×/.test(await page.locator('body').innerText()))
  const props = await page.evaluate(() => document.body.innerText)
  check('properties: the Animated switch is on and the loop length is explained', (await animSwitch(page).getAttribute('aria-checked')) === 'true' && /whole number of loops/i.test(props))
  await page.screenshot({ path: `${SHOTS}/animstickers-selected-desktop-light.png` })

  // --- preview pixels: the picture changes inside a loop and repeats after one loop
  const t0 = item.start
  const frame30 = (t) => Math.round((t * 30) / S) // frame number of a time
  const at = async (t) => {
    const micros = await page.evaluate((n) => import('/src/core/time.ts').then((m) => m.frameStart(n, 30)), frame30(t))
    await st('(ed, t) => { ed.select(null); ed.setPlayhead(t) }', micros)
    await page.waitForTimeout(450)
    return { micros, png: await canvasShot(page) }
  }
  // The loop tests use exact microseconds (no snapping to a video frame), so t and t + loop are the same cell by construction.
  const exact = async (micros) => {
    await st('(ed, t) => { ed.select(null); ed.setPlayhead(t) }', micros)
    await page.waitForTimeout(450)
    return { micros, png: await canvasShot(page) }
  }
  const a = await exact(t0 + Math.round(0.12 * CLAP))
  const b = await exact(t0 + Math.round(0.55 * CLAP))
  const dAB = await imageDiff(page, a.png, b.png)
  check('preview: the sticker looks different at two times of the same loop', dAB.changed > 12, JSON.stringify(dAB))
  const a2 = await exact(a.micros + CLAP)
  const dLoop = await imageDiff(page, a.png, a2.png)
  check('preview: at t and t + one loop the picture is the same (the loop repeats)', dLoop.changed <= 3 && dLoop.mean < 0.6, JSON.stringify({ dLoop, a: a.micros, a2: a2.micros }))
  const b3 = await exact(b.micros + 2 * CLAP)
  const dLoop2 = await imageDiff(page, b.png, b3.png)
  check('preview: also two loops later', dLoop2.changed <= 3 && dLoop2.mean < 0.6, JSON.stringify(dLoop2))
  const itemEnd = item.start + item.duration
  await at(itemEnd + 400_000)
  const beforeStickers = await canvasShot(page)
  check('preview: after the sticker ended the picture is the plain checker again', (await imageDiff(page, a.png, beforeStickers)).changed > 12)

  // playing: the sticker is drawn on playback frames too
  await st('(ed, t) => { ed.setPlayhead(t); ed.togglePlaying() }', t0)
  await page.waitForTimeout(700)
  const playing = await canvasShot(page)
  await st('(ed) => { if (ed.isPlaying) ed.togglePlaying() }')
  check('preview: during playback the picture differs from the plain checker (the sticker is drawn)', (await imageDiff(page, playing, beforeStickers)).changed > 5)

  // --- filmstrip of six preview frames over one loop (partyPopper) for the screenshots
  await st('(ed) => { ed.select(null); ed.commitProject({ ...ed.project, overlays: [] }) }')
  await st('(ed) => { ed.setPlayhead(1000000); ed.addImageStickerAtPlayhead("partyPopper", true) }')
  await page.waitForTimeout(500)
  const POP = await loopOf('partyPopper')
  const strip = []
  for (let k = 0; k < 6; k++) strip.push((await at(1 * S + Math.round((k * POP) / 6))).png)
  const filmstrip = await page.evaluate(async (list) => {
    const cell = 220
    const out = new OffscreenCanvas(cell * list.length, cell)
    const ctx = out.getContext('2d')
    for (let i = 0; i < list.length; i++) {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${list[i]}`)).blob())
      const side = bmp.height * 0.46
      ctx.drawImage(bmp, bmp.width / 2 - side / 2, bmp.height / 2 - side / 2, side, side, i * cell, 0, cell, cell)
    }
    const blob = await out.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }, strip)
  writeFileSync(`${SHOTS}/animstickers-filmstrip.png`, Buffer.from(filmstrip, 'base64'))
  let distinct = 0
  for (let k = 1; k < 6; k++) if ((await imageDiff(page, strip[0], strip[k])).changed > 12) distinct++
  check('filmstrip: six frames of one loop show a moving sticker', distinct >= 4, String(distinct))

  // --- trimming snaps to loops; the video end rounds down
  await st('(ed) => { ed.select(null); ed.commitProject({ ...ed.project, overlays: [] }) }')
  await st('(ed) => { ed.setPlayhead(1000000); ed.addImageStickerAtPlayhead("clap", true) }')
  const id = await st('(ed) => ed.project.overlays[0].id')
  const start = 1 * S
  await st('(ed, a) => ed.trimOverlayEnd(a.id, a.end)', { id, end: start + Math.round(1.4 * CLAP) })
  check('trim: dragging the end snaps to one loop', (await st('(ed) => ed.project.overlays[0].duration')) === CLAP)
  await st('(ed, a) => ed.trimOverlayEnd(a.id, a.end)', { id, end: start + Math.round(4.6 * CLAP) })
  check('trim: ... and to five loops', (await st('(ed) => ed.project.overlays[0].duration')) === 5 * CLAP)
  await st('(ed, a) => ed.trimOverlayStart(a.id, a.t)', { id, t: start + Math.round(1.1 * CLAP) })
  const trimmed = await st('(ed) => ed.project.overlays[0]')
  check('trim: trimming the start keeps the end and snaps the length to loops', trimmed.start + trimmed.duration === start + 5 * CLAP && trimmed.duration === 4 * CLAP, JSON.stringify(trimmed))
  await st('(ed, a) => { ed.select({ kind: "overlay", id: a }); ed.updateSelectedOverlay({ duration: 7000000 }) }', id)
  check('time field: a typed length snaps to whole loops', (await st('(ed) => ed.project.overlays[0].duration')) % CLAP === 0)
  const endMicros = await page.evaluate(() => import('/src/core/timeline/fit.ts').then(async (m) => m.videoEnd(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').project)))
  await st('(ed, a) => ed.moveOverlay(a, 7500000)', id)
  const movedItem = await st('(ed) => ed.project.overlays[0]')
  check('video end: a move stops at the end with whole loops', movedItem.start + movedItem.duration <= endMicros && movedItem.duration % CLAP === 0 && endMicros - (movedItem.start + movedItem.duration) < CLAP, JSON.stringify({ movedItem, endMicros }))
  // adding near the end: heart (3.07 s loop), 8 s video, playhead at 3 s => two... one loop plus the rest rounds down
  await st('(ed) => { ed.select(null); ed.commitProject({ ...ed.project, overlays: [] }) }')
  const HEART = await loopOf('heart')
  await st('(ed) => { ed.setPlayhead(3000000); ed.addImageStickerAtPlayhead("heart", true) }')
  const near = await st('(ed) => ed.project.overlays[0]')
  check('video end: three heart loops do not fit, so it ends on a whole number of loops before the end', near.duration % HEART === 0 && near.duration === 1 * HEART && near.start + near.duration < endMicros && endMicros - (near.start + near.duration) < HEART, JSON.stringify({ near, endMicros }))
  await st('(ed) => { ed.select(null); ed.commitProject({ ...ed.project, overlays: [] }) }')
  await st('(ed, e) => { ed.setPlayhead(e - 300000); ed.addImageStickerAtPlayhead("clap", true) }', endMicros)
  const tight = await st('(ed) => ed.project.overlays[0]')
  check('video end: when less than one loop fits, it runs exactly to the video end', tight.start + tight.duration === endMicros && tight.duration < CLAP, JSON.stringify({ tight, endMicros }))

  // --- switch off in the properties: still picture, the length is kept; undo brings the animation back
  await st('(ed) => { ed.select(null); ed.commitProject({ ...ed.project, overlays: [] }) }')
  await st('(ed) => { ed.setPlayhead(1000000); ed.addImageStickerAtPlayhead("clap", true) }')
  const cid = await st('(ed) => ed.project.overlays[0].id')
  const before = await st('(ed) => ed.project.overlays[0]')
  await page.waitForTimeout(300)
  await animSwitch(page).click()
  await page.waitForTimeout(300)
  const off = await st('(ed) => ed.project.overlays[0]')
  check('switch off: the flag is gone and the length is unchanged', off.animated === undefined && off.duration === before.duration, JSON.stringify(off))
  const s1 = await at(t0 + Math.round(0.12 * CLAP))
  const s2 = await at(t0 + Math.round(0.55 * CLAP))
  const stillDiff = await imageDiff(page, s1.png, s2.png)
  check('switch off: the sticker is a still picture again (same picture at two times)', stillDiff.changed <= 3, JSON.stringify(stillDiff))
  await st('(ed, i) => ed.select({ kind: "overlay", id: i })', cid)
  await page.waitForTimeout(250)
  await st('(ed) => ed.updateSelectedOverlay({ duration: 5000000 })')
  await animSwitch(page).click()
  await page.waitForTimeout(250)
  const on = await st('(ed) => ed.project.overlays[0]')
  check('switch on: an existing sticker is shortened to whole loops', on.animated === true && on.duration === 4 * CLAP, JSON.stringify(on))
  await st('(ed) => ed.undo()')
  const undone = await st('(ed) => ed.project.overlays[0]')
  check('switch on is undoable: the old length and no animation come back', undone.animated === undefined && undone.duration === 5000000, JSON.stringify(undone))
  await st('(ed) => ed.redo()')
  check('... and redo animates again', (await st('(ed) => ed.project.overlays[0].animated')) === true)

  // --- export in the worker: frames at two times differ and match the preview
  await st('(ed) => { ed.select(null); ed.commitProject({ ...ed.project, overlays: [] }) }')
  await st('(ed) => { ed.setPlayhead(1000000); ed.addImageStickerAtPlayhead("clap", true) }')
  const tA = (await page.evaluate((n) => import('/src/core/time.ts').then((m) => m.frameStart(n, 30)), frame30(1 * S + 0.14 * CLAP)))
  const tB = (await page.evaluate((n) => import('/src/core/time.ts').then((m) => m.frameStart(n, 30)), frame30(1 * S + 0.58 * CLAP)))
  const exported = await page.evaluate(
    async ([times]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = pinia._s.get('editor')
      const { startExport } = await import('/src/engine/export/exportClient.ts')
      const { FONT_SOURCES } = await import('/src/ui/fontUrls.ts')
      const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
      const files = {}
      for (const asset of ed.project.assets) files[asset.id] = new File([await (await fetch(`/tests/fixtures/${asset.name}`)).blob()], asset.name)
      const running = startExport({ project: JSON.parse(JSON.stringify(ed.project)), files, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, FONT_SOURCES, () => undefined)
      const res = await running.promise
      const provider = new ExactFrameProvider()
      provider.setFile('out', new File([res.blob], 'out.mp4'), false)
      const pngs = []
      for (const t of times) {
        const frame = await provider.getFrame('out', t)
        const w = frame.displayWidth ?? frame.width
        const h = frame.displayHeight ?? frame.height
        const c = new OffscreenCanvas(w, h)
        c.getContext('2d').drawImage(frame, 0, 0)
        const png = await c.convertToBlob({ type: 'image/png' })
        const bytes = new Uint8Array(await png.arrayBuffer())
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        pngs.push(btoa(bin))
      }
      await provider.dispose()
      return { frames: res.frames, inWorker: running.inWorker, pngs }
    },
    [[tA, tB]]
  )
  check('export: it ran in the worker and produced frames', exported.inWorker === true && exported.frames > 30, JSON.stringify({ inWorker: exported.inWorker, frames: exported.frames }))
  const [eA, eB] = exported.pngs
  writeFileSync(`${SHOTS}/animstickers-export-a.png`, Buffer.from(eA, 'base64'))
  writeFileSync(`${SHOTS}/animstickers-export-b.png`, Buffer.from(eB, 'base64'))
  const dExport = await imageDiff(page, eA, eB)
  check('export: the sticker looks different in two exported frames of one loop', dExport.changed > 8, JSON.stringify(dExport))
  await st('(ed) => ed.select(null)')
  const pA = await at(tA)
  const pB = await at(tB)
  // the same two times without the sticker: the reference that shows which pixels belong to it
  const stickerId = await st('(ed) => ed.project.overlays[0].id')
  await st('(ed, i) => { ed.select({ kind: "overlay", id: i }); ed.updateSelectedOverlay({ opacity: 0 }); ed.select(null) }', stickerId)
  const bgA = await at(tA)
  await st('(ed, i) => { ed.select({ kind: "overlay", id: i }); ed.updateSelectedOverlay({ opacity: 1 }); ed.select(null) }', stickerId)
  const same = [await stickerDiff(page, pA.png, eA, bgA.png), await stickerDiff(page, pB.png, eB, bgA.png)]
  const cross = [await stickerDiff(page, pA.png, eB, bgA.png), await stickerDiff(page, pB.png, eA, bgA.png)]
  check('export: each exported frame matches the preview at the same time on the sticker pixels (and not the other phase)', same[0].pixels > 30 && same[0].mean < cross[0].mean * 0.6 && same[1].mean < cross[1].mean * 0.6 && same[0].mean < 30, JSON.stringify({ same, cross }))

  // --- save and load keeps the flag
  const reloaded = await page.evaluate(async () => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const ed = pinia._s.get('editor')
    const { parseProjectJson, serializeProject } = await import('/src/core/project/schema.ts')
    const parsed = parseProjectJson(serializeProject(ed.project))
    if (!parsed.ok) return { ok: false, errors: parsed.errors }
    const before = JSON.stringify(ed.project.overlays)
    ed.replaceDocument(parsed.project, { handle: null, name: null })
    return { ok: true, same: JSON.stringify(ed.project.overlays) === before, animated: ed.project.overlays[0].animated }
  })
  check('file: save and load keeps the animated flag and the length', reloaded.ok && reloaded.same && reloaded.animated === true, JSON.stringify(reloaded))
  const badFile = await page.evaluate(async () => {
    const { parseProjectJson, serializeProject } = await import('/src/core/project/schema.ts')
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const ed = pinia._s.get('editor')
    const doc = JSON.parse(serializeProject(ed.project))
    doc.overlays[0].imageId = 'fox'
    return parseProjectJson(JSON.stringify(doc)).ok
  })
  check('file: the flag on a sticker without an animation is rejected', badFile === false)

  // Re-opening the file may ask to find the media again; the checks below are about the gallery.
  const modal = page.locator('div.fixed.inset-0.z-50')
  if ((await modal.count()) > 0) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  // --- the gallery has no switch: a tap adds an animated sticker again
  await st('(ed) => { ed.select(null); ed.commitProject({ ...ed.project, overlays: [] }) }')
  await pickCategory(page, 'Hearts & hands').catch(() => {})
  await page.locator('[data-sticker="clap"]').click()
  await page.waitForTimeout(400)
  const againItem = await st('(ed) => ed.project.overlays[0]')
  check('gallery: a tap adds an animated sticker with whole loops', againItem.imageId === 'clap' && againItem.animated === true && againItem.duration === 3 * CLAP, JSON.stringify(againItem))
}
await context.close()

// ---------------------------------------------------------------------------------------------------------
// 2. a project with animated stickers loads its sheet when it is opened (no gallery involved)
{
  const { context: ctx, page: p, st: s2, requests: reqs } = await openEditor({ width: 1440, height: 1200 }, 'light')
  check('open: before the project is opened no sheet was requested', reqs.length === 0)
  await s2(`(ed) => ed.replaceDocument({ ...ed.project, overlays: [{ id: 'o1', kind: 'sticker', start: 1000000, duration: 3000000, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, size: 0.3, imageId: 'thumbsUp', animated: true }] }, { handle: null, name: null })`)
  await p.waitForTimeout(800)
  check('open: opening a project with an animated sticker requests that sheet', sheetsOf(reqs).join() === 'thumbsUp', JSON.stringify(reqs))
  const fixed = await s2('(ed) => ed.project.overlays[0].duration')
  const loop = await p.evaluate(async () => (await import('/src/core/render/stickerAnimations.ts')).animatedSticker('thumbsUp').loopMicros)
  check('open: its length was brought to whole loops', fixed % loop === 0, `${fixed} / ${loop}`)
  await ctx.close()
}

// 3. a sheet that cannot be loaded (offline, never cached): the still picture is shown, nothing breaks
{
  const { context: ctx, page: p, st: s3, requests: reqs } = await openEditor({ width: 1440, height: 1200 }, 'light', 'en', { blockSheets: true })
  await s3(`(ed) => ed.commitProject({ ...ed.project, overlays: [{ id: 'o1', kind: 'sticker', start: 1000000, duration: 3000000, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, size: 0.3, imageId: 'heart', animated: true }] })`)
  const loop = await p.evaluate(async () => (await import('/src/core/render/stickerAnimations.ts')).animatedSticker('heart').loopMicros)
  await s3('(ed) => { ed.select(null); ed.setPlayhead(1200000) }')
  await p.waitForTimeout(700)
  const x = await canvasShot(p)
  await s3('(ed, t) => ed.setPlayhead(t)', 1000000 + Math.round(loop * 0.5))
  await p.waitForTimeout(700)
  const y = await canvasShot(p)
  const red = await countColour(p, x, isRed, CENTRE)
  check('fallback: with the sheet blocked the still heart is drawn', red > 800, String(red))
  check('fallback: and it does not move', (await imageDiff(p, x, y)).changed <= 3)
  check('fallback: the sheet was asked for', reqs.includes('heart'), JSON.stringify(reqs))
  await ctx.close()
}

// 4. German, dark: labels; screenshots (gallery, selected) in dark and on the phone in both schemes
{
  const { context: ctx, page: p, st: s4 } = await openEditor({ width: 1440, height: 1200 }, 'dark', 'de')
  await openStickers(p)
  check('german: the badge is named "Animiert"', (await p.locator('[data-sticker="laugh"] [data-animated-badge]').getAttribute('aria-label')) === 'Animiert')
  const lb = await p.locator('[data-sticker="laugh"]').boundingBox()
  await p.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
  await p.waitForFunction(() => document.querySelector('[data-sticker="laugh"] [data-sticker-animation]')?.style.visibility === 'visible', null, { timeout: 15000 })
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${SHOTS}/animstickers-gallery-desktop-dark.png` })
  await p.locator('[data-sticker="laugh"]').click()
  await p.waitForTimeout(700)
  check('german: the bar label shows the loops', /3 ×/.test(await p.locator('body').innerText()))
  await p.screenshot({ path: `${SHOTS}/animstickers-selected-desktop-dark.png` })
  await ctx.close()
}
for (const scheme of ['light', 'dark']) {
  const { context: ctx, page: p, st: s5 } = await openEditor({ width: 390, height: 844 }, scheme)
  await p.getByRole('tab', { name: /Design|Gestalten/ }).click().catch(() => {})
  await p.getByRole('button', { name: /^(Stickers|Aufkleber)$/ }).click().catch(() => {})
  await p.waitForSelector('#sticker-grid')
  await p.waitForTimeout(300)
  // On the phone the gallery is below the picture; there is no hover, so no sheet is requested before a tap.
  await p.locator('#sticker-grid').scrollIntoViewIfNeeded()
  await p.waitForTimeout(400)
  check(`phone ${scheme}: no horizontal page scroll`, !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
  const tile = await p.locator('#sticker-grid button').first().boundingBox()
  check(`phone ${scheme}: tiles keep 44 px touch targets`, tile && tile.width >= 44 && tile.height >= 44, JSON.stringify(tile))
  await p.screenshot({ path: `${SHOTS}/animstickers-gallery-phone-${scheme}.png` })
  await p.locator('[data-sticker="grin"]').click()
  await p.waitForTimeout(700)
  const added = await s5('(ed) => ed.project.overlays[0]?.animated')
  check(`phone ${scheme}: a tap adds an animated sticker`, added === true)
  await p.screenshot({ path: `${SHOTS}/animstickers-selected-phone-${scheme}.png` })
  await ctx.close()
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
