// Usage: node scripts/screenshot.mjs <out.png> [light|dark] [width] [height] [locale] [path]
// The default path opens the demo project (?demo=1); use /app/ for the empty start.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

const [out = 'shot.png', theme = 'light', width = '1120', height = '700', locale = 'de', path = '/app/?demo=1'] = process.argv.slice(2)

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${root}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return `${root}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: 5199, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: +width, height: +height }, locale, colorScheme: theme })
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message))
page.on('console', (m) => m.type() === 'error' && console.error('CONSOLE', m.text()))
await page.goto(`http://localhost:5199${path}`)
await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
await page.waitForSelector('header', { timeout: 15000 }).catch(() => undefined)
await page.waitForTimeout(800)
await page.screenshot({ path: out })
await browser.close()
await server.close()
console.log('saved', out)
