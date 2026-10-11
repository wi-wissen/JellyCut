// Real-browser check of the help page 'editors': table and cards, links, the chooser widget, overflow, screenshots.
// Usage: node scripts/e2e-help-editors.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5330
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
mkdirSync(SHOT_DIR, { recursive: true })

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ root, server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const origin = `http://localhost:${PORT}`
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })

let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }

// Desktop: content checks, console errors, links, chooser.
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme: 'light' })
const errors = []
desktop.on('pageerror', (e) => errors.push(e.message))
desktop.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await desktop.goto(`${origin}/help/editors/`)
await desktop.waitForSelector('h1')
await desktop.waitForTimeout(300)

check('page loads without console or page errors', errors.length === 0, errors.join(' | '))
check('h1 shows the translated title', (await desktop.locator('h1').innerText()).includes('Andere Videoeditoren im Überblick'))
check('body data-page is editors', (await desktop.evaluate(() => document.body.dataset.page)) === 'editors')

const rows = desktop.locator('table tbody tr')
check('table has a row for every tool (9)', (await rows.count()) === 9, `rows: ${await rows.count()}`)
check('table has a caption and column headers', (await desktop.locator('table caption').count()) === 1 && (await desktop.locator('table thead th[scope=col]').count()) === 7)
check('row headers use scope=row', (await desktop.locator('table tbody th[scope=row]').count()) === 9)
const toolNames = ['CapCut', 'Adobe Premiere Pro', 'Shotcut', 'OpenShot', 'FilmCraft', 'iMovie', 'Clipchamp', 'Windows Movie Maker', 'Jelly Cut']
for (const name of toolNames) check(`table lists ${name}`, (await desktop.locator('table tbody th', { hasText: name }).count()) === 1)

const external = desktop.locator('main a[target="_blank"]')
const externalCount = await external.count()
check('external official links exist (7 tools, table and cards)', externalCount === 14, `found ${externalCount}`)
let relOk = true
for (let i = 0; i < externalCount; i++) {
  const rel = (await external.nth(i).getAttribute('rel')) ?? ''
  if (!rel.includes('noopener')) relOk = false
}
check('every target=_blank link has rel=noopener', relOk)

const bodyText = await desktop.locator('main').innerText()
check('no raw URL text is visible', !/https?:\/\/|www\.\w+\.\w+/i.test(bodyText), bodyText.match(/https?:\/\/\S+|www\.\S+/i)?.[0] ?? '')

// Chooser: no answer shows the hint, an answer shows matches, a contradicting answer shows the empty message.
const emptyText = await desktop.locator('section[aria-live]').innerText()
check('chooser shows the empty hint before any answer', emptyText.includes('Beantworte'))
await desktop.getByText('Windows-PC', { exact: true }).click()
await desktop.getByText('Ja, ohne Konto', { exact: true }).click()
await desktop.getByText('Einfache Schulvideos', { exact: true }).click()
const afterAnswers = await desktop.locator('section[aria-live] ul a').allInnerTexts()
check('chooser suggests matching tools after three answers', afterAnswers.length > 0 && afterAnswers.includes('OpenShot'), afterAnswers.join(', '))
await desktop.getByText('Professionell lernen', { exact: true }).click()
const proResult = await desktop.locator('section[aria-live]').innerText()
check('changing an answer updates the suggestions', proResult.includes('Shotcut') && !proResult.includes('OpenShot'), proResult)
await desktop.getByText('Mac', { exact: true }).click()
await desktop.getByText('Smartphone oder Tablet', { exact: true }).click()
const none = await desktop.locator('section[aria-live]').innerText()
check('contradicting answers show the no-match message', none.includes('Mit dieser Kombination passt kein Programm'), none)
await desktop.getByRole('button', { name: 'Antworten zurücksetzen' }).click()
check('reset clears the answers', (await desktop.locator('section[aria-live]').innerText()).includes('Beantworte'))

// Overflow at 1440 and 360.
const overflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('no horizontal overflow at 1440', (await overflow(desktop)) <= 0, `overflow ${await overflow(desktop)}px`)
await desktop.screenshot({ path: join(SHOT_DIR, 'editors-desktop-light.png'), fullPage: true })

const phone = await browser.newPage({ viewport: { width: 360, height: 740 }, locale: 'de-DE', colorScheme: 'light' })
await phone.goto(`${origin}/help/editors/`)
await phone.waitForSelector('h1')
await phone.waitForTimeout(300)
check('no horizontal overflow at 360', (await overflow(phone)) <= 0, `overflow ${await overflow(phone)}px`)
check('phone shows cards and hides the table', (await phone.locator('table').isVisible()) === false && (await phone.locator('main ul.grid > li').count()) === 9)
await phone.close()

// Screenshots: phone and desktop, light and dark.
for (const [scheme, colorScheme] of [['light', 'light'], ['dark', 'dark']]) {
  const phonePage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'de-DE', colorScheme })
  await phonePage.goto(`${origin}/help/editors/`)
  await phonePage.waitForSelector('h1')
  await phonePage.waitForTimeout(300)
  check(`no horizontal overflow at 390 (${scheme})`, (await overflow(phonePage)) <= 0, `overflow ${await overflow(phonePage)}px`)
  await phonePage.screenshot({ path: join(SHOT_DIR, `editors-phone-${scheme}.png`), fullPage: true })
  await phonePage.close()

  const deskPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme })
  await deskPage.goto(`${origin}/help/editors/`)
  await deskPage.waitForSelector('h1')
  await deskPage.waitForTimeout(300)
  await deskPage.screenshot({ path: join(SHOT_DIR, `editors-desktop-${scheme}.png`), fullPage: true })
  await deskPage.close()
}

await browser.close()
await server.close()
console.log(failed === 0 ? '\nAll editors checks passed.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
