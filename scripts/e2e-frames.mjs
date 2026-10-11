// Frame-accuracy check: tests/fixtures/frames.webm encodes the frame number N as 8 black/white blocks (bit b = block b, 20 px wide).
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

const server = await createServer({ server: { port: 5192, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5192/')

const r = await page.evaluate(async () => {
  const { ExactFrameProvider } = await import('/src/engine/media/frames.ts')
  const { frameStart } = await import('/src/core/time.ts')
  const load = async (name, type) => new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type })
  const provider = new ExactFrameProvider()
  provider.setFile('f', await load('frames.webm', 'video/webm'), false)
  provider.setFile('img', await load('still.png', 'image/png'), true)
  provider.setFile('h264', await load('clip-b-portrait.mp4', 'video/mp4'), false)

  const bits = (canvas) => {
    const c = new OffscreenCanvas(canvas.width, canvas.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const sx = canvas.width / 160
    let n = 0
    for (let b = 0; b < 8; b++) {
      const d = ctx.getImageData(Math.round((b * 20 + 10) * sx), canvas.height >> 1, 1, 1).data
      if (d[0] > 127) n |= 1 << b
    }
    return n
  }
  const frameNumber = async (t) => { const f = await provider.getFrame('f', t); return f ? bits(f) : null }

  const out = { sequential: [], random: [], boundary: [], mid: [] }
  for (const n of [0, 1, 2, 14, 15, 16, 29, 30, 31, 59, 60, 89]) out.sequential.push([n, await frameNumber(frameStart(n, 30))])
  for (const n of [70, 3, 45, 44, 46, 10, 88, 0, 61, 17]) out.random.push([n, await frameNumber(frameStart(n, 30))])
  for (const n of [5, 29, 30, 74]) {
    out.boundary.push([n, await frameNumber(frameStart(n, 30) - 4000), n - 1])
    out.mid.push([n, await frameNumber(frameStart(n, 30) + 16_000)])
  }
  const img = await provider.getFrame('img', 0)
  out.imageSize = img ? [img.width, img.height] : null
  out.h264 = await provider.getFrame('h264', 0)
  out.unknown = await provider.getFrame('nope', 0)
  const t0 = performance.now()
  for (let n = 0; n < 90; n++) await frameNumber(frameStart(n, 30))
  out.sequentialMs = Math.round(performance.now() - t0)
  await provider.dispose()
  out.h264 = out.h264 === null ? 'null' : 'frame'
  return out
})

let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
const exact = (rows) => rows.every(([n, got]) => got === n)
check('sequential frame numbers are exact', exact(r.sequential), JSON.stringify(r.sequential))
check('random access (seeking backward and forward) is exact', exact(r.random), JSON.stringify(r.random))
check('4 ms before a frame start shows the previous frame', r.boundary.every(([, got, want]) => got === want), JSON.stringify(r.boundary))
check('mid-frame times show the frame that started before', exact(r.mid), JSON.stringify(r.mid))
check('still image comes back as an image of the right size', JSON.stringify(r.imageSize) === '[320,180]', JSON.stringify(r.imageSize))
check('undecodable and unknown assets give null instead of throwing', r.unknown === null, String(r.unknown))
console.log(`INFO h264 in this browser: ${r.h264}; 90 sequential frames took ${r.sequentialMs} ms`)
check('no uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
