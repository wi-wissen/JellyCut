// Export in a Web Worker: text with a curated font is drawn, progress arrives, cancel works.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${root}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return `${root}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: 5187, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5187/')

const r = await page.evaluate(async () => {
  const mod = (p) => import(p)
  const { startExport } = await mod('/src/engine/export/exportClient.ts')
  const { FONT_SOURCES } = await mod('/src/ui/fontUrls.ts')
  const { ExactFrameProvider } = await mod('/src/engine/media/frames.ts')
  const { probeFile } = await mod('/src/engine/media/probe.ts')
  const { createProject } = await mod('/src/core/project/schema.ts')
  const { ExportCancelled } = await mod('/src/engine/export/exporter.ts')

  const S = 1_000_000
  const file = new File([await (await fetch('/tests/fixtures/frames.webm')).blob()], 'frames.webm', { type: 'video/webm' })
  const info = await probeFile(file)
  const base = () => {
    const p = createProject('w')
    p.assets.push({ id: 'f', kind: 'video', name: 'frames.webm', relPath: 'frames.webm', size: info.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: false })
    p.clips = [{ id: 'c1', track: 'video', assetId: 'f', srcIn: 0, srcOut: 2 * S, start: 0, speed: 1, transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false }, volume: 1, muted: false, filter: null, transitionIn: null }]
    return p
  }
  const withText = (font) => {
    const p = base()
    p.texts = [{ id: 't1', start: 0, duration: 2 * S, text: 'HELLO', style: { font, size: 160, color: '#ff00ff', outline: null }, pos: { x: 0.5, y: 0.5 }, animIn: null, animOut: null }]
    return p
  }
  const opts = { resolution: 480, fps: 30, quality: 'good', format: 'mp4' }
  const run = async (project) => {
    const progress = []
    const running = startExport({ project, files: { f: file }, options: opts }, FONT_SOURCES, (p) => progress.push(p.fraction))
    const result = await running.promise
    return { result, progress, inWorker: running.inWorker }
  }
  const frame15 = async (blob) => {
    const prov = new ExactFrameProvider()
    prov.setFile('o', new File([blob], 'o.mp4'), false)
    const f = await prov.getFrame('o', 500_000)
    const c = new OffscreenCanvas(f.width, f.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(f, 0, 0)
    const d = ctx.getImageData(0, 0, f.width, f.height)
    await prov.dispose()
    return { w: f.width, h: f.height, data: Array.from(d.data) }
  }
  const diffPixels = (a, b) => { let n = 0, magenta = 0; for (let i = 0; i < a.data.length; i += 4) { if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 60) n++; if (b.data[i] > 150 && b.data[i + 2] > 150 && b.data[i + 1] < 90) magenta++ } return { n, magenta } }

  const out = {}
  const plain = await run(base())
  const sora = await run(withText('Sora'))
  const bebas = await run(withText('Bebas Neue'))
  out.inWorker = plain.inWorker
  out.progressOk = plain.progress.length > 1 && plain.progress.at(-1) === 1 && plain.progress.every((v, i) => i === 0 || v >= plain.progress[i - 1])
  out.size = plain.result.blob.size
  const a = await frame15(plain.result.blob), b = await frame15(sora.result.blob), c = await frame15(bebas.result.blob)
  out.sora = diffPixels(a, b)
  out.bebas = diffPixels(a, c)
  out.fontsDiffer = diffPixels(b, c).n
  out.pixels = a.w * a.h

  // Cancel
  const ac = startExport({ project: base(), files: { f: file }, options: opts }, FONT_SOURCES, (p) => { if (p.fraction > 0.2) ac.cancel() })
  try { await ac.promise; out.cancel = 'resolved' } catch (e) { out.cancel = e instanceof ExportCancelled ? 'cancelled' : e.message }
  return out
})

let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
check('export runs in a worker', r.inWorker === true)
check('progress is reported and ends at 100 %', r.progressOk)
check('Sora text is drawn in the worker (magenta pixels appear)', r.sora.magenta > 300 && r.sora.n > 300, JSON.stringify(r.sora))
check('Bebas Neue text is drawn in the worker', r.bebas.magenta > 300, JSON.stringify(r.bebas))
check('different fonts give visibly different text (fonts really load in the worker)', r.fontsDiffer > 500, String(r.fontsDiffer))
check('cancelling a worker export rejects with ExportCancelled', r.cancel === 'cancelled', r.cancel)
check('no uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
