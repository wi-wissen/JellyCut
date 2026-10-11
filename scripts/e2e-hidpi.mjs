// The preview canvas must be drawn at the size it is shown in DEVICE pixels, so text stays crisp on HiDPI screens.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: 5179, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
const errors = []

async function measure(dpr, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, locale: 'en' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5179/app')
  await page.waitForSelector('canvas')
  await page.waitForTimeout(1200)
  const r = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const b = c.getBoundingClientRect()
    return { cssW: b.width, cssH: b.height, w: c.width, h: c.height }
  })
  await ctx.close()
  return r
}

const one = await measure(1, { width: 1440, height: 900 })
const two = await measure(2, { width: 1440, height: 900 })
const three = await measure(1.5, { width: 1440, height: 900 })
console.log('INFO dpr1', JSON.stringify(one), 'dpr1.5', JSON.stringify(three), 'dpr2', JSON.stringify(two))
check('dpr 1: the canvas has about one pixel per displayed pixel', Math.abs(one.w - one.cssW) <= 3 && Math.abs(one.h - one.cssH) <= 3, JSON.stringify(one))
check('dpr 2: the canvas has about two pixels per displayed pixel (crisp text)', Math.abs(two.w - two.cssW * 2) <= 4 && Math.abs(two.h - two.cssH * 2) <= 4, JSON.stringify(two))
check('dpr 1.5: fractional scaling is followed too', Math.abs(three.w - three.cssW * 1.5) <= 4, JSON.stringify(three))
check('the picture is never drawn larger than the project format (1920x1080)', two.w <= 1920 && two.h <= 1080)
check('no uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
