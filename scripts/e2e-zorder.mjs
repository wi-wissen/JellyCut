// Real-browser check of the true stacking order between blur / pixelate areas and the other overlays:
// a sticker above an area is drawn sharp, a sticker below it is pixelated, reordering with
// stackSelectedOverlay switches the result, and a picture-in-picture video stays visible next to both
// (preview paused, preview playing and an exported frame). Usage: node scripts/e2e-zorder.mjs
// (exit code 1 when a check fails). Port 5340.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5340
const VIEW = { width: 1440, height: 900 }
const FIXTURES = ['overlays2-checker.png', 'overlays2-green.webm']

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
const settle = (ms = 600) => page.waitForTimeout(ms)

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
 * Pixel analysis in the page. 'count' counts pixels of shot a matching a predicate in a fraction rectangle.
 * 'maskChanged' takes the pixels of shot `mask` that match the predicate and returns how many of them differ
 * (summed channel change above 60) in shot a. Shots may have different sizes; b is scaled to a.
 */
function analyze(job) {
  return page.evaluate(async (j) => {
    const decode = async (b64, size = null) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const w = size ? size.w : bmp.width
      const h = size ? size.h : bmp.height
      const c = new OffscreenCanvas(w, h)
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0, w, h)
      return { w, h, d: ctx.getImageData(0, 0, w, h).data }
    }
    const A = await decode(j.a)
    const M = j.mask ? await decode(j.mask, { w: A.w, h: A.h }) : null
    const [x0, x1, y0, y1] = [Math.floor(j.rect[0] * A.w), Math.ceil(j.rect[1] * A.w), Math.floor(j.rect[2] * A.h), Math.ceil(j.rect[3] * A.h)]
    const test = new Function(`return (${j.predicate})`)()
    let matched = 0
    let changed = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * A.w + x) * 4
        if (!M) {
          if (test(A.d[i], A.d[i + 1], A.d[i + 2])) matched++
        } else if (test(M.d[i], M.d[i + 1], M.d[i + 2])) {
          matched++
          const d = Math.abs(A.d[i] - M.d[i]) + Math.abs(A.d[i + 1] - M.d[i + 1]) + Math.abs(A.d[i + 2] - M.d[i + 2])
          if (d > 60) changed++
        }
      }
    }
    return { matched, changed, ratio: matched ? changed / matched : 0 }
  }, job)
}

// The checker picture holds every pure primary, so the heart is orange (not a colour of the pattern).
const isRed = '(r, g, b) => r > 200 && g > 90 && g < 170 && b < 70'
// Pixels that are the sticker's own colour with nothing blended in (the antialiased edge is left out).
const isPureRed = '(r, g, b) => r > 248 && g > 122 && g < 134 && b < 8'
const isGreen = '(r, g, b) => g > 200 && r < 90 && b < 90'

// Layout (fractions of the picture): the area covers the left half, the heart sits on it, the video is bottom right.
const HEART_RECT = [0.2, 0.4, 0.35, 0.65]
const VIDEO_RECT = [0.7, 0.94, 0.7, 0.9]

// --- setup: a new project with the checker picture as the clip and the green video in the library
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
await page.waitForSelector('[data-player-overlay]')

const videoAsset = await st('(ed) => ed.project.assets.find((a) => a.name === "overlays2-green.webm").id')
const T0 = 500_000
const LEN = 3_000_000
const base = { start: T0, duration: LEN, scale: 1, rotation: 0 }
const heart = { ...base, id: 'z-heart', kind: 'sticker', pos: { x: 0.3, y: 0.5 }, shape: 'heart', color: '#ff8000', outline: null, size: 0.3 }
const region = { ...base, id: 'z-region', kind: 'region', pos: { x: 0.3, y: 0.5 }, shape: 'rect', effect: 'pixelate', strength: 0.5, width: 0.6, height: 0.6, radius: 0.03 }
const video = { ...base, id: 'z-video', kind: 'media', pos: { x: 0.82, y: 0.8 }, assetId: videoAsset, width: 0.3, height: 0.2, radius: 0, border: 0, borderColor: '#ffffff' }
const withOrder = (items) => st('(ed, items) => { ed.commitProject({ ...ed.project, overlays: items }); ed.setPlayhead(1000000) }', items)

async function previewShot(items) {
  await withOrder(items)
  await settle()
  return canvasShot()
}

// --- 1. preview, paused: the order decides whether the heart is pixelated
// The first shot can be taken before the preview has settled in its final size, so one is thrown away.
await previewShot([heart, region, video])
const sticker = await previewShot([heart])
const above = await previewShot([region, heart, video])
const below = await previewShot([heart, region, video])
const heartAbove = await analyze({ a: above, mask: sticker, rect: HEART_RECT, predicate: isPureRed })
const heartBelow = await analyze({ a: below, mask: sticker, rect: HEART_RECT, predicate: isPureRed })
check('setup: the heart is drawn in its colour', heartAbove.matched > 2000, JSON.stringify(heartAbove))
check('order: a heart above the area stays sharp', heartAbove.ratio < 0.03, JSON.stringify(heartAbove))
check('order: a heart below the area is pixelated with the picture', heartBelow.ratio > 0.1, JSON.stringify(heartBelow))
const videoAbove = await analyze({ a: above, rect: VIDEO_RECT, predicate: isGreen })
const videoBelow = await analyze({ a: below, rect: VIDEO_RECT, predicate: isGreen })
check('video picture: visible next to the area and the heart (heart above)', videoAbove.matched > 1500, JSON.stringify(videoAbove))
check('video picture: visible next to the area and the heart (heart below)', videoBelow.matched > 1500, JSON.stringify(videoBelow))

// --- 2. reordering with the store action switches the result (and the picture stays)
await withOrder([heart, region, video])
await st('(ed) => ed.select({ kind: "overlay", id: "z-heart" })')
await st('(ed) => ed.stackSelectedOverlay("front")')
await settle()
const order1 = await st('(ed) => ed.project.overlays.map((o) => o.id)')
const front = await canvasShot()
const heartFront = await analyze({ a: front, mask: sticker, rect: HEART_RECT, predicate: isPureRed })
check('stack: bringToFront puts the heart last in the list', order1.at(-1) === 'z-heart', JSON.stringify(order1))
check('stack: after bringToFront the heart is sharp', heartFront.ratio < 0.03, JSON.stringify(heartFront))
await st('(ed) => ed.select({ kind: "overlay", id: "z-region" })')
await st('(ed) => ed.stackSelectedOverlay("front")')
await settle()
const order2 = await st('(ed) => ed.project.overlays.map((o) => o.id)')
const regionFront = await canvasShot()
const heartRegionFront = await analyze({ a: regionFront, mask: sticker, rect: HEART_RECT, predicate: isPureRed })
check('stack: bringToFront on the area puts it last in the list', order2.at(-1) === 'z-region', JSON.stringify(order2))
check('stack: after the area is moved to the front the heart is pixelated', heartRegionFront.ratio > 0.1, JSON.stringify(heartRegionFront))
await st('(ed) => ed.stackSelectedOverlay("back")')
await settle()
const backShot = await canvasShot()
const heartBack = await analyze({ a: backShot, mask: sticker, rect: HEART_RECT, predicate: isPureRed })
check('stack: after sendToBack the area is below the heart again and the heart is sharp', heartBack.ratio < 0.03, JSON.stringify(heartBack))
await st('(ed) => ed.select(null)')

// --- 3. blur area: same order rule
const blurRegion = { ...region, effect: 'blur', strength: 0.8 }
const blurAbove = await analyze({ a: await previewShot([blurRegion, heart, video]), mask: sticker, rect: HEART_RECT, predicate: isPureRed })
const blurBelow = await analyze({ a: await previewShot([heart, blurRegion, video]), mask: sticker, rect: HEART_RECT, predicate: isPureRed })
check('blur: a heart above the area stays sharp', blurAbove.ratio < 0.03, JSON.stringify(blurAbove))
check('blur: a heart below the area is blurred', blurBelow.ratio > 0.1, JSON.stringify(blurBelow))

// --- 4. two areas around the heart: only the area above it changes it
const region2 = { ...region, id: 'z-region2', effect: 'blur', strength: 0.8 }
const twoAbove = await analyze({ a: await previewShot([region, heart, region2, video]), mask: sticker, rect: HEART_RECT, predicate: isPureRed })
check('two areas: the area above the heart still changes it', twoAbove.ratio > 0.1, JSON.stringify(twoAbove))
const twoVideo = await analyze({ a: await previewShot([region, heart, region2, video]), rect: VIDEO_RECT, predicate: isGreen })
check('two areas: the video picture is still visible', twoVideo.matched > 1500, JSON.stringify(twoVideo))

// --- 5. a video picture below an area is pixelated with the rest, above it is not
const videoInside = { ...video, pos: { x: 0.3, y: 0.5 }, width: 0.3, height: 0.2 }
const videoCentre = [0.24, 0.36, 0.45, 0.55]
const vidBelowRegion = await previewShot([videoInside, region])
const vidAboveRegion = await previewShot([region, videoInside])
const vBelow = await analyze({ a: vidBelowRegion, mask: vidAboveRegion, rect: [0.1, 0.5, 0.3, 0.7], predicate: isGreen })
check('video picture: above the area it is green inside its box', (await analyze({ a: vidAboveRegion, rect: videoCentre, predicate: isGreen })).matched > 1500)
check('video picture: below the area its edge is pixelated', vBelow.ratio > 0.05, JSON.stringify(vBelow))

// --- 6. playing: the video picture is drawn while the timeline plays with the area and the heart
await withOrder([region, heart, video])
await st('(ed) => ed.togglePlaying()')
await page.waitForTimeout(700)
const playing = await st('(ed) => ed.isPlaying')
const playShot = await canvasShot()
await st('(ed) => { if (ed.isPlaying) ed.togglePlaying() }')
const playGreen = await analyze({ a: playShot, rect: VIDEO_RECT, predicate: isGreen })
check('playing: the video picture is visible next to the area and the heart', playing === true && playGreen.matched > 1500, JSON.stringify({ playing, ...playGreen }))
await settle()

// --- 7. export: the same order rule and the video picture in an exported frame
async function exportedFrame(items) {
  return page.evaluate(async (overlays) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const ed = pinia._s.get('editor')
    const { runExport } = await import('/src/engine/export/exporter.ts')
    const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
    const { frameStart } = await import('/src/core/time.ts')
    const files = {}
    for (const asset of ed.project.assets) files[asset.id] = new File([await (await fetch(`/tests/fixtures/${asset.name}`)).blob()], asset.name)
    const project = { ...JSON.parse(JSON.stringify(ed.project)), overlays }
    const res = await runExport({ project, files, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, () => undefined, new AbortController().signal)
    const provider = new ExactFrameProvider()
    provider.setFile('out', new File([res.blob], 'out.mp4'), false)
    const frame = await provider.getFrame('out', frameStart(30, 30))
    const c = new OffscreenCanvas(frame.displayWidth ?? frame.width, frame.displayHeight ?? frame.height)
    c.getContext('2d').drawImage(frame, 0, 0)
    const png = await c.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await png.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    await provider.dispose()
    return btoa(bin)
  }, items)
}
const exAbove = await exportedFrame([region, heart, video])
const exBelow = await exportedFrame([heart, region, video])
const exHeartBelow = await analyze({ a: exBelow, mask: exAbove, rect: HEART_RECT, predicate: isRed })
check('export: the heart is in the exported frame', (await analyze({ a: exAbove, rect: HEART_RECT, predicate: isRed })).matched > 500)
check('export: a heart below the area differs from one above it', exHeartBelow.ratio > 0.1, JSON.stringify(exHeartBelow))
const exVideoAbove = await analyze({ a: exAbove, rect: VIDEO_RECT, predicate: isGreen })
const exVideoBelow = await analyze({ a: exBelow, rect: VIDEO_RECT, predicate: isGreen })
check('export: the video picture is in the frame (heart above the area)', exVideoAbove.matched > 500, JSON.stringify(exVideoAbove))
check('export: the video picture is in the frame (heart below the area)', exVideoBelow.matched > 500, JSON.stringify(exVideoBelow))

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
await server.close()
console.log(failed === 0 ? 'ALL PASSED' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
