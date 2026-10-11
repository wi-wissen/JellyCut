import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const r = '/opt/pw-browsers'
const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
const server = await createServer({ server: { port: 5183, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: `${r}/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en' })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
await page.goto('http://localhost:5183/app')
await page.waitForSelector('header')
await page.locator('header button[aria-haspopup]').first().click()
await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures/frames.webm'))
await page.waitForFunction(() => document.body.innerText.includes('frames.webm'))
await page.getByRole('button', { name: /frames\.webm/ }).first().click()
await page.waitForTimeout(400)
await page.evaluate(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const ed = p._s.get('editor'); ed.setRatio('9:16'); ed.setBackground({ type: 'color', color: '#0000ff' }); ed.setPlayhead(300000) })
await page.waitForTimeout(800)
await page.addStyleTag({ content: '[data-player-overlay]{display:none!important}' })
const buf = await page.locator('canvas').first().screenshot()
const info = await page.evaluate(async (d) => {
  const blob = await (await fetch(`data:image/png;base64,${d}`)).blob()
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data)
  return { w: bmp.width, h: bmp.height, corner: px(2, 2), mid: px(bmp.width / 2, bmp.height / 2), bottom: px(5, bmp.height - 5) }
}, buf.toString('base64'))
console.log('INFO', JSON.stringify(info), (await page.locator('canvas').count()))
require_ = null
console.log(await page.evaluate(() => [...document.querySelectorAll('button,[role=tab]')].map((b) => `${b.tagName}:${b.getAttribute('role')}:${(b.getAttribute('aria-label')||b.innerText).trim().slice(0,30)}`).join(' | ')))
await page.screenshot({ path: '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad/probe1.png' })
await browser.close(); await server.close()
