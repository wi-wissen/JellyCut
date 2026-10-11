// End-to-end check of colour filters and adjustments in a real Chromium: the Filters tab, its tiles and
// thumbnails, the preview pixels, intensity and adjustment sliders (one undo step per drag), reset,
// apply to all clips, the note in the clip panel, the exported MP4 (decoded and compared), autosave
// across a reload, and light and dark screenshots.
// Usage: node scripts/e2e-filters.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5174
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const FIXTURE_A = join(root, 'tests/fixtures/clip-a.webm')
const FIXTURE_B = join(root, 'tests/fixtures/frames.webm')

const outcomes = []
const check = (name, ok, detail = '') => {
  outcomes.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` (${detail})`}`)
}

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
mkdirSync(SHOT_DIR, { recursive: true })

const pageErrors = []
const consoleErrors = []
let page = null

// Reads or changes the editor store. `body` is a function body receiving (e = editor, m = media, arg).
const store = (body, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      return new Function('e', 'm', 'arg', src)(p._s.get('editor'), p._s.get('media'), a)
    },
    [body, arg]
  )
const undoDepth = () => store('return e.history.past.length')
const clipsOf = () => store('return JSON.parse(JSON.stringify(e.project.clips))')
const waitFor = async (fn, timeout = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true
    await page.waitForTimeout(60)
  }
  return false
}

/** Mean colour and channel spread of the central part of the player canvas (PNG of the element). */
async function previewMean() {
  const buf = await page.locator('canvas[role="img"]').screenshot()
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const x0 = Math.round(bmp.width * 0.2)
    const y0 = Math.round(bmp.height * 0.2)
    const w = Math.round(bmp.width * 0.6)
    const h = Math.round(bmp.height * 0.5)
    const d = ctx.getImageData(x0, y0, w, h).data
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++
    }
    const mean = [r / n, g / n, b / n]
    return { mean, spread: Math.max(...mean) - Math.min(...mean), lum: 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2] }
  }, buf.toString('base64'))
}

/** Colour count and painted share of a 2D canvas (tiles are read directly). */
const tileStats = (testId) =>
  page.evaluate((id) => {
    const c = document.querySelector(`[data-testid="${id}"] canvas`)
    if (!c) return null
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const seen = new Set()
    let sum = [0, 0, 0]
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      sum = [sum[0] + d[i], sum[1] + d[i + 1], sum[2] + d[i + 2]]
      n++
    }
    return { colours: seen.size, mean: sum.map((v) => v / n) }
  }, testId)

/** Mouse drag on a range input from one fraction of its width to another; one drag is one gesture. */
async function dragSlider(slider, fromFrac, toFrac) {
  await slider.scrollIntoViewIfNeeded()
  const box = await slider.boundingBox()
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * fromFrac, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 10 })
  await page.mouse.up()
}

const slider = (name) => page.getByRole('slider', { name, exact: true })
const tile = (id) => page.getByTestId(`filter-tile-${id}`)
const openFilters = async () => {
  await page.getByRole('tab', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
}
const timelineClip = (name) => page.getByRole('button', { name: `Clip: ${name}`, exact: true }).first()

// ---------- setup: new project, two clips ----------
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme: 'light' })
page = await context.newPage()
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && consoleErrors.push(m.text()))
await page.goto(APP_URL)
await page.waitForSelector('header')

await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
await page.locator('input[type=file]').first().setInputFiles([FIXTURE_A, FIXTURE_B])
await waitFor(() => store(`return e.project.assets.length === 2 && e.project.assets.every(a => m.status[a.id] === 'ready')`), 20000)
await page.getByRole('button', { name: /clip-a\.webm/ }).first().click()
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await waitFor(() => store(`return e.project.clips.length === 2`))
await store('e.setPlayhead(1000000)')
await store('e.select(null)')
check('setup: two clips on the timeline', (await store('return e.project.clips.length')) === 2)

// ---------- Filters tab: tiles and thumbnails ----------
await page.getByRole('button', { name: /^Clip: clip-a\.webm$/ }).first().click()
await openFilters()
await tile('none').waitFor()
const tiles = await page.locator('[data-testid^="filter-tile-"]').count()
check('filters tab: ten filter tiles', tiles === 10, String(tiles))
await waitFor(async () => {
  const s = await tileStats('filter-tile-blackWhite')
  return s && s.colours >= 2
}, 8000)
const ids = ['none', 'blackWhite', 'sepia', 'warm', 'cool', 'vivid', 'fade', 'vintage', 'noir', 'dream']
const stats = {}
for (const id of ids) stats[id] = await tileStats(`filter-tile-${id}`)
check('filter tiles render thumbnails (not blank, several colours)', ids.every((id) => stats[id] && stats[id].colours >= 2), JSON.stringify(ids.map((id) => [id, stats[id]?.colours])))

await store('e.setPlayhead(1000000)')
await page.waitForTimeout(400)
const original = await previewMean()
const tileNone = stats.none.mean
check(
  'thumbnail of "none" shows the current frame (close to the preview, not the placeholder)',
  original.mean.every((v, i) => Math.abs(v - tileNone[i]) <= 35),
  `preview ${original.mean.map(Math.round)} tile ${tileNone.map(Math.round)}`
)
await page.screenshot({ path: join(SHOT_DIR, 'filters-light-unselected.png') })

// ---------- Black & white changes the preview to grey ----------
await tile('blackWhite').click()
const bwReady = await waitFor(async () => (await previewMean()).spread <= 8, 4000)
const bw = await previewMean()
check('choosing Black & white makes the preview grey (channel spread <= 8)', bwReady && bw.spread <= 8, `spread ${bw.spread.toFixed(1)} mean ${bw.mean.map(Math.round)}`)
check('choosing Black & white stores the filter on the clip', (await clipsOf())[0].filter === 'blackWhite')
check('the selected tile is marked', (await tile('blackWhite').getAttribute('aria-pressed')) === 'true')

// ---------- intensity: half strength is halfway between original and filtered ----------
const intensity = slider('Intensität')
await dragSlider(intensity, 0.5, 0.5)
await page.waitForTimeout(300)
const amount = (await clipsOf())[0].filterAmount
const half = await previewMean()
const greyMean = bw.mean
const expectedHalf = original.mean.map((v, i) => (1 - amount) * v + amount * greyMean[i])
const halfErr = Math.max(...half.mean.map((v, i) => Math.abs(v - expectedHalf[i])))
check('intensity slider moves the preview back towards colour', amount < 0.7 && amount > 0.3 && half.spread > bw.spread + 3, `amount ${amount} spread ${half.spread.toFixed(1)}`)
check('intensity 50% is halfway between original and filtered (+-5)', halfErr <= 5, `error ${halfErr.toFixed(1)} amount ${amount}`)
await dragSlider(intensity, 0.5, 1)
await waitFor(async () => (await previewMean()).spread <= 8, 3000)
check('intensity back at 100% is full black & white again', (await clipsOf())[0].filterAmount === 1)

// ---------- adjustments: brightness, one undo step per drag ----------
const brightness = slider('Helligkeit')
const beforeBright = await previewMean()
const depth0 = await undoDepth()
await dragSlider(brightness, 0.5, 0.75)
await page.waitForTimeout(300)
const depth1 = await undoDepth()
const afterBright = await previewMean()
check('one brightness drag is one undo step', depth1 - depth0 === 1, `steps ${depth1 - depth0}`)
check('brightness raises the preview', afterBright.lum - beforeBright.lum >= 10, `lum ${beforeBright.lum.toFixed(1)} -> ${afterBright.lum.toFixed(1)}`)
const adjustBright = (await clipsOf())[0].adjust?.brightness
check('brightness is stored on the clip (about +0.5)', adjustBright > 0.4 && adjustBright < 0.6, String(adjustBright))

const contrast = slider('Kontrast')
const depth2 = await undoDepth()
await dragSlider(contrast, 0.5, 0.7)
await page.waitForTimeout(200)
check('one contrast drag is one undo step', (await undoDepth()) - depth2 === 1, String((await undoDepth()) - depth2))
const saturation = slider('Sättigung')
await dragSlider(saturation, 0.5, 0.2)
await page.waitForTimeout(200)
check('saturation below zero is stored', (await clipsOf())[0].adjust?.saturation < -0.3, JSON.stringify((await clipsOf())[0].adjust))

await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click()
await page.waitForTimeout(300)
const resetAdjust = (await clipsOf())[0].adjust
check('Reset clears brightness, contrast and saturation', resetAdjust.brightness === 0 && resetAdjust.contrast === 0 && resetAdjust.saturation === 0, JSON.stringify(resetAdjust))
const afterReset = await previewMean()
check('Reset restores the preview to black & white', Math.abs(afterReset.lum - bw.lum) <= 3, `lum ${bw.lum.toFixed(1)} vs ${afterReset.lum.toFixed(1)}`)

// ---------- dark screenshot of the selected clip ----------
await store('e.select({ kind: "clip", id: e.project.clips[0].id })')
await store('e.setActiveGroup("look", "filter")')
await dragSlider(brightness, 0.5, 0.6)
await page.waitForTimeout(400)
const scrollTop = () => page.evaluate(() => { document.querySelector('[data-testid="filter-tile-none"]').closest('.overflow-y-auto').scrollTop = 0 })
await scrollTop()
await waitFor(async () => (await tileStats('filter-tile-sepia'))?.colours >= 2, 4000)
await page.waitForTimeout(300)
await page.screenshot({ path: join(SHOT_DIR, 'filters-light.png') })
await store('e.setTheme("dark")')
await page.waitForTimeout(300)
await page.screenshot({ path: join(SHOT_DIR, 'filters-dark.png') })
await store('e.setTheme("light")')
await page.waitForTimeout(200)

// ---------- Apply to all clips (two clips) ----------
await store('e.setPlayhead(1000000)')
await store('e.select({ kind: "clip", id: e.project.clips[0].id })')
await page.getByRole('button', { name: 'Auf alle Clips anwenden', exact: true }).click()
await page.waitForTimeout(200)
const all = await clipsOf()
check('apply to all clips copies filter, intensity and adjustments to every clip', all.every((c) => c.filter === 'blackWhite' && JSON.stringify(c.adjust) === JSON.stringify(all[0].adjust)), JSON.stringify(all.map((c) => [c.filter, c.adjust])))

// ---------- clip panel note ----------
await page.getByRole('tab', { name: 'Material', exact: true }).click()
await page.getByRole('button', { name: 'Medien', exact: true }).click()
await store('e.select({ kind: "clip", id: e.project.clips[1].id })')
await page.waitForTimeout(200)
const summary = await page.getByTestId('filter-summary').textContent()
check('clip panel shows the filter of the clip', summary?.includes('Schwarzweiß'), summary)
await page.getByRole('button', { name: 'Filter öffnen', exact: true }).click()
check('the note links to the Filters tab', (await store('return e.activeTab')) === 'filter')

// ---------- no selection: the clip under the playhead is edited ----------
await store('e.select(null)')
await store('e.setPlayhead(1000000)')
await page.waitForTimeout(200)
const targetText = await page.getByTestId('filter-target').textContent()
check('without a selection the clip under the playhead is the target', targetText?.includes('clip-a.webm'), targetText)
await tile('sepia').click()
const sepiaClips = await clipsOf()
check('a tile applies to the clip under the playhead', sepiaClips[0].filter === 'sepia' && sepiaClips[1].filter === 'blackWhite', JSON.stringify(sepiaClips.map((c) => c.filter)))
await tile('blackWhite').click()

// ---------- export contains the grade ----------
const exported = await page.evaluate(async () => {
  const { runExport } = await import('/src/engine/export/exporter.ts')
  const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
  const { getAssetFile } = await import('/src/ui/stores/media.ts')
  const { frameStart } = await import('/src/core/time.ts')
  const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = p._s.get('editor')
  const base = JSON.parse(JSON.stringify(ed.project))
  const files = {}
  for (const a of base.assets) {
    const f = getAssetFile(a.id)
    if (f) files[a.id] = f
  }
  const plain = structuredClone(base)
  for (const c of plain.clips) {
    c.filter = null
    delete c.filterAmount
    delete c.adjust
  }
  const opts = { resolution: 480, fps: 30, quality: 'good', format: 'mp4' }
  const signal = new AbortController().signal
  const plainRes = await runExport({ project: plain, files, options: opts }, () => undefined, signal)
  const gradedRes = await runExport({ project: base, files, options: opts }, () => undefined, signal)

  const readFrame = async (blob, n) => {
    const provider = new ExactFrameProvider()
    provider.setFile('o', new File([blob], 'out.mp4'), false)
    const canvas = await provider.getFrame('o', frameStart(n, 30))
    await provider.dispose()
    if (!canvas) return null
    const c = new OffscreenCanvas(canvas.width, canvas.height)
    c.getContext('2d').drawImage(canvas, 0, 0)
    return { w: c.width, h: c.height, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data }
  }
  const a = await readFrame(plainRes.blob, 1)
  const b = await readFrame(gradedRes.blob, 1)
  if (!a || !b) return { error: 'no frame decoded' }
  // Expected: the grade applied to the decoded unfiltered frame, compared with the decoded graded frame.
  const { resolveGrade, applyGrade } = await import('/src/core/filters/filters.ts')
  const c0 = base.clips[0]
  const grade = resolveGrade(c0.filter, c0.filterAmount, c0.adjust)
  let errSum = 0, n = 0, spread = 0, diffSum = 0
  const step = 4 * 7
  for (let i = 0; i < a.data.length; i += step) {
    const rgb = [a.data[i] / 255, a.data[i + 1] / 255, a.data[i + 2] / 255]
    const e = applyGrade(grade, rgb).map((v) => v * 255)
    const got = [b.data[i], b.data[i + 1], b.data[i + 2]]
    errSum += (Math.abs(got[0] - e[0]) + Math.abs(got[1] - e[1]) + Math.abs(got[2] - e[2])) / 3
    diffSum += (Math.abs(got[0] - a.data[i]) + Math.abs(got[1] - a.data[i + 1]) + Math.abs(got[2] - a.data[i + 2])) / 3
    spread += Math.max(...got) - Math.min(...got)
    n++
  }
  return { meanError: errSum / n, meanChangeFromPlain: diffSum / n, meanSpreadGraded: spread / n, size: [b.w, b.h], adjust: c0.adjust }
})
check('export: decoded frame decodes', !exported.error, exported.error)
if (!exported.error) {
  check('export: the graded file is grey (mean channel spread <= 6)', exported.meanSpreadGraded <= 6, exported.meanSpreadGraded.toFixed(2))
  check('export: the graded frame changed from the plain one (mean change > 12)', exported.meanChangeFromPlain > 12, exported.meanChangeFromPlain.toFixed(2))
  check('export: graded frame equals the clip grade applied to the plain frame (mean error <= 8)', exported.meanError <= 8, `${exported.meanError.toFixed(2)} adjust ${JSON.stringify(exported.adjust)}`)
}

// ---------- autosave keeps the grade across a reload ----------
const before = (await clipsOf()).map((c) => ({ filter: c.filter, filterAmount: c.filterAmount, adjust: c.adjust }))
await page.waitForTimeout(1500)
await page.reload()
await page.waitForSelector('header')
await waitFor(() => store('return e.project.clips.length === 2'), 10000)
const after = (await clipsOf()).map((c) => ({ filter: c.filter, filterAmount: c.filterAmount, adjust: c.adjust }))
check('autosave: filter, intensity and adjustments survive a reload', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)

// ---------- uncaught errors ----------
check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
console.log(failed === 0 ? `ALL ${outcomes.length} CHECKS PASSED` : `${failed} of ${outcomes.length} CHECKS FAILED`)
process.exit(failed === 0 ? 0 : 1)
