// Paused preview, fine cut and export of clips RECORDED by the browser's MediaRecorder (Firefox and Chromium WebM).
// Such files have no cues, a cluster per second, a single keyframe at the start and sometimes a late first frame.
// They played fine but the paused preview went black from the second cluster on (see docs/decisions.md).
// Checks: the exact frame path delivers a picture everywhere, the preview canvas, the fine cut and an export are
// not black, and the safety net (media element) takes over when the exact path returns nothing, throws or is black.
// Usage: node scripts/e2e-recorded-frames.mjs     (Chromium; also the provider check in Firefox when it is installed)
// Port 5420. Exit code 1 when a check fails.
import { chromium, firefox } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5420
const BASE = `http://localhost:${PORT}`

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const FIXTURES = ['recorded-firefox-vp8.webm', 'recorded-chromium-vp8.webm', 'recorded-chromium-vp9.webm', 'recorded-offset-vfr.webm']
// Seconds into the file; mixes forward and backward jumps across the cluster borders (about every second).
const TIMES = [0, 0.3, 0.8, 1.2, 1.7, 2.2, 0.4, 2.4, 1.1]
// The fixtures are bright test pictures (mean grey above 90); black is below 5.
const MIN_LUMA = 40

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' :: ' + detail}`)
  if (!ok) failed++
}
const skip = (name, reason) => console.log(`SKIP ${name} (${reason})`)

const server = await createServer({ server: { port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' })
await server.listen()

/** Runs in the page: decodes every fixture with the exact provider at TIMES and returns mean grey values and frame spans. */
async function providerCheck(page) {
  return page.evaluate(
    async ({ fixtures, times }) => {
      const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
      const { KeyframeIndex } = await import('/src/engine/media/keyframes.ts')
      const out = {}
      const probe = new OffscreenCanvas(32, 18)
      const ctx = probe.getContext('2d', { willReadFrequently: true })
      const luma = (frame) => {
        if (!frame) return null
        ctx.drawImage(frame, 0, 0, 32, 18)
        const d = ctx.getImageData(0, 0, 32, 18).data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
        return Math.round(sum / (d.length / 4) / 3)
      }
      for (const name of fixtures) {
        const file = new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type: 'video/webm' })
        const provider = new ExactFrameProvider()
        provider.setFile('a', file, false)
        const rows = []
        for (const t of times) {
          const us = Math.round(t * 1e6)
          const frame = await provider.getFrame('a', us)
          const info = await provider.getFrameInfo('a', us)
          rows.push({ t, luma: luma(frame), start: info?.start ?? null, end: info?.end ?? null })
        }
        const index = await KeyframeIndex.open(file)
        const keys = { late: await index.before(2_200_000), early: await index.before(400_000) }
        index.dispose()
        out[name] = { rows, rescues: { ...provider.rescues }, keys }
        await provider.dispose()
      }
      return out
    },
    { fixtures: FIXTURES, times: TIMES }
  )
}

function judgeProvider(prefix, result) {
  for (const name of FIXTURES) {
    const { rows, keys } = result[name]
    const dark = rows.filter((r) => r.luma === null || r.luma < MIN_LUMA)
    check(`${prefix} ${name}: a picture at every time, forwards and backwards`, dark.length === 0, JSON.stringify(dark))
    const bad = rows.filter((r) => r.start === null || r.end <= r.start || (r.end - r.start < 10_000 && r.t < 2.4))
    check(`${prefix} ${name}: frame spans have a real length (no zero-length span at cluster ends)`, bad.length === 0, JSON.stringify(bad))
    const firstFrame = name === 'recorded-offset-vfr.webm' ? 300_000 : 0
    const covers = rows.filter((r) => r.start !== null && r.start > Math.max(r.t * 1e6 + 1500, firstFrame))
    check(`${prefix} ${name}: the span never starts after the requested time`, covers.length === 0, JSON.stringify(covers))
    const firstKey = name === 'recorded-offset-vfr.webm' ? 300_000 : 0
    check(`${prefix} ${name}: keyframe index finds the keyframe in later clusters`, keys.late === firstKey && keys.early === (name === 'recorded-offset-vfr.webm' ? 300_000 : 0), JSON.stringify(keys))
  }
}

// ---------------------------------------------------------------- Chromium
const chrome = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const errors = []
const warnings = []
let context = null
let page = null
/** A new browser context per project: an autosaved project would make "New project" ask for confirmation. */
async function freshPage(url) {
  await context?.close()
  context = await chrome.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en' })
  page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text())
    if (m.type() === 'warning' && m.text().includes('[jellycut] paused picture')) warnings.push(m.text())
    if (process.env.E2E_VERBOSE) console.log('[page]', m.type(), m.text())
  })
  await page.goto(url)
}

await freshPage(`${BASE}/`)
const chromiumProvider = await providerCheck(page)
judgeProvider('provider', chromiumProvider)
const rescued = Object.values(chromiumProvider).reduce((n, r) => n + r.rescues.fromKeyframe, 0)
console.log(`INFO Chromium: ${rescued} lookups were served from the keyframe list (the demuxer's own search failed for them)`)

const state = (fn, arg) =>
  page.evaluate(
    `(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; return (${fn})(p._s.get('editor'), p._s.get('media'), p._s.get('fineCut'), ${JSON.stringify(arg ?? null)}) })()`
  )

async function newProjectWith(fileName) {
  await freshPage(`${BASE}/app/`)
  await page.waitForSelector('header')
  await page.locator('header button[aria-haspopup]').first().click()
  await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures', fileName))
  await page.waitForFunction(
    (name) => {
      const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = p._s.get('editor')
      const asset = ed.project.assets.find((a) => a.name === name)
      return !!asset && p._s.get('media').status[asset.id] === 'ready'
    },
    fileName,
    { timeout: 20000 }
  )
  await page.getByRole('button', { name: new RegExp(fileName.replace(/\./g, '\\.')) }).first().click()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').project.clips.length === 1)
}

/** Mean grey of the preview canvas (screenshot: a WebGL canvas cannot be read directly). */
async function canvasLuma() {
  const buf = await page.locator('canvas').first().screenshot()
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(32, 18)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bmp, 0, 0, 32, 18)
    const d = ctx.getImageData(0, 0, 32, 18).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
    return Math.round(sum / (d.length / 4) / 3)
  }, buf.toString('base64'))
}

/** Seeks the paused playhead to each time and returns the grey value the canvas settles on (or the last one seen). */
async function lumaAt(seconds) {
  await state('(ed, me, fc, s) => ed.setPlayhead(Math.round(s * 1000000))', seconds)
  let luma = 0
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100)
    luma = await canvasLuma()
    if (luma >= MIN_LUMA) break
  }
  return luma
}

const fallbackAttr = () => page.locator('canvas').first().getAttribute('data-paused-fallback')

for (const name of FIXTURES) {
  await newProjectWith(name)
  const rows = []
  for (const t of TIMES) rows.push([t, await lumaAt(t)])
  const dark = rows.filter(([, l]) => l < MIN_LUMA)
  check(`preview ${name}: paused canvas is not black at any time`, dark.length === 0, JSON.stringify(rows))
  check(`preview ${name}: the exact path delivered the pictures (no element fallback needed)`, (await fallbackAttr()) === null, String(await fallbackAttr()))
}

// --- safety net: the exact path returns nothing / throws / returns a black picture
const modes = {
  none: 'async function () { return null }',
  throws: 'async function () { throw new Error("decoder exploded") }',
  black: 'async function (...a) { const f = await original.apply(this, a); return f ? new OffscreenCanvas(f.width, f.height) : f }'
}
const FALLBACK_TIMES = [0.3, 1.7, 2.2]
for (const [mode, body] of Object.entries(modes)) {
  if (process.env.MODES && !process.env.MODES.split(',').includes(mode)) continue
  warnings.length = 0
  await freshPage(`${BASE}/app/`)
  await page.waitForSelector('header')
  await page.evaluate(`(async () => {
    const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
    window.__originalGetFrame ??= ExactFrameProvider.prototype.getFrame
    const original = window.__originalGetFrame
    ExactFrameProvider.prototype.getFrame = ${body}
  })()`)
  // The page keeps its patched prototype across the in-app project switch, so import after patching.
  await page.locator('header button[aria-haspopup]').first().click()
  await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures', 'recorded-firefox-vp8.webm'))
  await page.waitForFunction(
    () => {
      const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      return p._s.get('editor').project.assets.some((a) => p._s.get('media').status[a.id] === 'ready')
    },
    null,
    { timeout: 20000 }
  )
  await page.getByRole('button', { name: /recorded-firefox-vp8\.webm/ }).first().click()
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor').project.clips.length === 1)
  const rows = []
  for (const t of FALLBACK_TIMES) rows.push([t, await lumaAt(t)])
  check(`safety net (${mode}): the paused canvas is not black at any time`, rows.every(([, l]) => l >= MIN_LUMA), JSON.stringify(rows))
  const attr = await fallbackAttr()
  check(`safety net (${mode}): the fallback is visible on the canvas (data-paused-fallback)`, !!attr && attr.trim().length > 0, String(attr))
  check(`safety net (${mode}): the fallback is logged once per asset`, warnings.length === 1 && warnings[0].includes(mode === 'none' ? 'missing' : mode === 'throws' ? 'error' : 'black'), JSON.stringify(warnings))

  if (mode === 'none') {
    // Fine cut uses the same safety net for its two big frames.
    await state('(ed) => ed.setPlayhead(1700000)')
    await page.locator('#fine-cut-button').click()
    const dialog = page.getByRole('dialog', { name: 'Fine cut' })
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-testid="fine-frame"]')].filter((c) => c.dataset.fallback === 'element').length >= 1,
      null,
      { timeout: 15000 }
    ).catch(() => undefined)
    const frames = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="fine-frame"]')].map((c) => {
        const d = c.width ? c.getContext('2d').getImageData(0, 0, c.width, c.height).data : []
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
        return { fallback: c.dataset.fallback, luma: d.length ? Math.round(sum / (d.length / 4) / 3) : 0 }
      })
    )
    check('fine cut: with a failing exact path its frames come from the element and are not black', frames.length >= 1 && frames.every((f) => f.fallback === 'element' && f.luma >= MIN_LUMA), JSON.stringify(frames))
  }
}
await page.evaluate(`(async () => {
  const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
  if (window.__originalGetFrame) ExactFrameProvider.prototype.getFrame = window.__originalGetFrame
})()`)

// --- fine cut with the exact path itself, in a later cluster
await newProjectWith('recorded-firefox-vp8.webm')
await state('(ed) => ed.setPlayhead(1700000)')
await page.locator('#fine-cut-button').click()
await page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'visible', timeout: 5000 })
await page.waitForFunction(() => document.querySelectorAll('[data-testid="fine-frame"]').length > 0 && !document.querySelector('[data-testid="fine-frame"] ~ [role="status"]'), null, { timeout: 15000 })
const fine = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="fine-frame"]')].map((c) => {
    const d = c.width ? c.getContext('2d').getImageData(0, 0, c.width, c.height).data : []
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
    return { fallback: c.dataset.fallback ?? '', luma: d.length ? Math.round(sum / (d.length / 4) / 3) : 0 }
  })
)
check('fine cut: frames in a later cluster come from the exact path and are not black', fine.length >= 1 && fine.every((f) => f.fallback === '' && f.luma >= MIN_LUMA), JSON.stringify(fine))

// --- export: frames of the recorded clips are not black
await freshPage(`${BASE}/`)
const exported = await page.evaluate(
  async ({ names }) => {
    const { runExport } = await import('/src/engine/export/exporter.ts')
    const { probeFile } = await import('/src/engine/media/probe.ts')
    const { createProject } = await import('/src/core/project/schema.ts')
    const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
    const probe = new OffscreenCanvas(32, 18)
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    const luma = (frame) => {
      if (!frame) return null
      ctx.drawImage(frame, 0, 0, 32, 18)
      const d = ctx.getImageData(0, 0, 32, 18).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
      return Math.round(sum / (d.length / 4) / 3)
    }
    const out = {}
    for (const name of names) {
      const file = new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type: 'video/webm' })
      const info = await probeFile(file)
      const project = createProject(name)
      project.assets.push({ id: 'r', kind: info.kind, name, relPath: name, size: info.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio })
      project.clips = [
        {
          id: 'c1', track: 'video', assetId: 'r', srcIn: 0, srcOut: Math.min(info.duration, 2_400_000), start: 0, speed: 1,
          transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
          volume: 1, muted: false, filter: null, transitionIn: null
        }
      ]
      const res = await runExport({ project, files: { r: file }, options: { resolution: 480, fps: 30, quality: 'good', format: 'mp4' } }, () => undefined, new AbortController().signal)
      const provider = new ExactFrameProvider()
      provider.setFile('o', new File([res.blob], 'out.mp4'), false)
      const rows = []
      for (const t of [0.1, 0.6, 1.1, 1.6, 2.1, 2.3]) rows.push([t, luma(await provider.getFrame('o', Math.round(t * 1e6)))])
      await provider.dispose()
      out[name] = { frames: res.frames, rows }
    }
    return out
  },
  { names: FIXTURES }
)
for (const name of FIXTURES) {
  const { frames, rows } = exported[name]
  check(`export ${name}: exported frames are not black (${frames} frames)`, frames > 0 && rows.every(([, l]) => l !== null && l >= MIN_LUMA), JSON.stringify(rows))
}
check('no uncaught page errors in Chromium', errors.length === 0, errors.join('; '))
await context?.close()
await chrome.close()

// ---------------------------------------------------------------- Firefox (provider level; the sandbox has no WebGL2)
let ff = null
try {
  ff = await firefox.launch()
} catch (e) {
  skip('Firefox provider checks', `Firefox is not installed (${String(e.message).split('\n')[0]})`)
}
if (ff) {
  const ffPage = await ff.newPage()
  const ffErrors = []
  ffPage.on('pageerror', (e) => ffErrors.push(e.message))
  await ffPage.goto(`${BASE}/`)
  const hasCodec = await ffPage.evaluate(() => typeof VideoDecoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined')
  if (!hasCodec) {
    skip('Firefox provider checks', 'no WebCodecs in this Firefox')
  } else {
    const result = await providerCheck(ffPage)
    judgeProvider('firefox provider', result)
    check('no uncaught page errors in Firefox', ffErrors.length === 0, ffErrors.join('; '))
  }
  await ff.close()
}

await server.close()
if (failed) {
  console.log(`${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('ALL CHECKS PASSED')
