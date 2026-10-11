import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const r = '/opt/pw-browsers'
const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
const server = await createServer({ server: { port: 5184, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: `${r}/${dir}/chrome-linux/chrome`, args: ['--no-sandbox'] })
const errors = []
const st = (page, fn, arg = null) => page.evaluate(([src, a]) => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const ed = p._s.get('editor'); return new Function('ed', 'a', `return (${src})(ed, a)`)(ed, a) }, [fn, arg])
for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, locale: 'en', colorScheme: theme })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('http://localhost:5184/app')
    await page.waitForSelector('header')
    await page.locator('header button[aria-haspopup]').first().click()
    await page.getByRole('menuitem', { name: /New project/ }).click()
    await page.locator('input[type=file]').first().setInputFiles(['frames.webm', 'clip-a.webm', 'talk.webm', 'music.webm'].map((f) => join(root, 'tests/fixtures', f)))
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /frames\.webm/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /clip-a\.webm/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /talk\.webm/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    await page.getByRole('tab', { name: 'Design' }).click()
    await page.getByRole('button', { name: /^Text$/ }).first().click()
    await page.getByRole('button', { name: /^Add text$/ }).click()
    await page.getByRole('button', { name: /^Add text$/ }).click().catch(() => {})
    await page.waitForTimeout(200)
    await st(page, '(ed) => { ed.setPlayhead(1000000) }')
    await page.getByRole('tab', { name: 'Material' }).click()
    await page.getByRole('button', { name: /^Audio$/ }).click().catch(() => {})
    await page.getByRole('button', { name: /music\.webm/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    const texts = await st(page, '(ed) => ed.project.texts.map((t) => t.id)')
    const clips = await st(page, '(ed) => ed.project.clips.map((c) => c.id)')
    const music = await st(page, '(ed) => ed.project.music.length')
    console.log(w, theme, 'texts', texts.length, 'clips', clips.length, 'music', music)
    // Text selected: panel and canvas handles.
    await page.getByRole('tab', { name: 'Design' }).click()
    await st(page, '(ed, id) => { ed.select({ kind: "text", id }); ed.setPlayhead(1000000) }', texts[0])
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/canvas-text-${theme}-${w}.png` })
    // Clip selected.
    await st(page, '(ed, id) => ed.select({ kind: "clip", id })', clips[1])
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/canvas-clip-${theme}-${w}.png` })
    // Ratio popover.
    await page.getByRole('button', { name: 'Aspect ratio' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/canvas-popover-${theme}-${w}.png` })
    await page.keyboard.press('Escape')
    await page.close()
  }
}
console.log('errors', errors)
await browser.close(); await server.close()
