// Real-browser check of the help section (dev server): every page loads without errors, the navigation and the
// previous/next chain reach all pages, the theme choice persists, the footer links to GitHub, no horizontal overflow
// at 360, 768 and 1440 px, the sources and rights page content, and screenshots of four pages in light and dark.
// Usage: node scripts/e2e-help.mjs
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5300
const ORIGIN = `http://localhost:${PORT}`
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const GITHUB = 'https://github.com/wi-wissen/JellyCut'
mkdirSync(SHOT_DIR, { recursive: true })

// Reading order and paths come from HELP_PAGES in src/ui/site/helpPages.ts, titles from the page locale files.
function titleOf(slug, lang) {
  const messages = JSON.parse(readFileSync(join(root, `src/locales/pages/help-${slug}.${lang}.json`), 'utf8'))
  return messages.help[slug].title
}
const PAGES = [...readFileSync(join(root, 'src/ui/site/helpPages.ts'), 'utf8').matchAll(/slug: '([a-z]+)',\s*dir: '([a-z/]*)'/g)].map(
  ([, slug, dir]) => ({ slug, path: `/help/${dir}`, de: titleOf(slug, 'de'), en: titleOf(slug, 'en') })
)

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const outcomes = []
function check(name, ok, detail = '') {
  outcomes.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` (${detail})`}`)
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })

/** A new browser context with error collection; locale is 'de-DE' or 'en-US'. */
async function session({ locale = 'de-DE', width = 1440, height = 900, scheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale, colorScheme: scheme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()))
  return { context, page, errors }
}

async function go(page, path) {
  const response = await page.goto(`${ORIGIN}${path}`)
  await page.waitForSelector('h1')
  return response
}

// 1) Every page, both languages: renders, title and language, landmarks, skip link, GitHub link, no errors.
for (const locale of ['de-DE', 'en-US']) {
  const lang = locale.slice(0, 2)
  const s = await session({ locale })
  for (const p of PAGES) {
    const response = await go(s.page, p.path)
    const h1 = (await s.page.locator('h1').innerText()).trim()
    check(`${lang}: ${p.path} loads with HTTP 200 and the title "${p[lang]}"`, response?.status() === 200 && h1 === p[lang], `${response?.status()} ${h1}`)
    const meta = await s.page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title }))
    check(`${lang}: ${p.path} has lang "${lang}" and the page title`, meta.lang === lang && meta.title.includes(p[lang]) && meta.title.includes('Jelly Cut'), JSON.stringify(meta))
    const landmarks = await s.page.evaluate(() => ['header', 'nav', 'main', 'footer'].every((t) => document.querySelector(t)))
    check(`${lang}: ${p.path} has header, navigation, main and footer`, landmarks)
    check(`${lang}: ${p.path} has a skip link to the content`, (await s.page.locator('a[href="#main"]').count()) === 1)
    check(`${lang}: ${p.path} links to GitHub in the footer`, (await s.page.locator(`footer a[href="${GITHUB}"]`).count()) === 1)
    check(`${lang}: ${p.path} has no console or page errors`, s.errors.length === 0, s.errors.join(' | '))
  }
  await s.context.close()
}

// 2) Navigation: each entry of the list reaches its page, and the current page is marked.
{
  const s = await session()
  for (const [i, p] of PAGES.entries()) {
    await go(s.page, '/help/')
    const nav = s.page.locator('nav[aria-label="Hilfeseiten"]')
    const count = await nav.locator('a').count()
    if (i === 0) check(`nav lists all ${PAGES.length} help pages`, count === PAGES.length, String(count))
    await nav.locator(`a[href="./${p.path.replace('/help/', '')}"]`).click()
    await s.page.waitForURL(new RegExp(`${p.path.replace(/\//g, '\\/')}$`))
    await s.page.waitForSelector('h1')
    const current = await s.page.locator('nav[aria-label="Hilfeseiten"] a[aria-current="page"]').innerText()
    check(`nav link to ${p.path} reaches the page and marks it as current`, (await s.page.locator('h1').innerText()).trim() === p.de && current.trim() === p.de, current)
  }
  await s.context.close()
}

// 3) Previous and next chain: from the start page through all pages, and back again.
{
  const s = await session()
  await go(s.page, '/help/')
  const forward = []
  for (let guard = 0; guard < 20; guard++) {
    forward.push((await s.page.locator('h1').innerText()).trim())
    const next = s.page.locator('a[rel="next"]')
    if ((await next.count()) === 0) break
    await next.click()
    await s.page.waitForSelector('h1')
    await s.page.waitForFunction((title) => document.querySelector('h1')?.textContent?.trim() !== title, forward.at(-1))
  }
  check('next links visit all pages in reading order', JSON.stringify(forward) === JSON.stringify(PAGES.map((p) => p.de)), forward.join(' | '))
  const backward = []
  for (let guard = 0; guard < 20; guard++) {
    backward.push((await s.page.locator('h1').innerText()).trim())
    const prev = s.page.locator('a[rel="prev"]')
    if ((await prev.count()) === 0) break
    await prev.click()
    await s.page.waitForSelector('h1')
    await s.page.waitForFunction((title) => document.querySelector('h1')?.textContent?.trim() !== title, backward.at(-1))
  }
  check('previous links go back through all pages to the start', JSON.stringify(backward) === JSON.stringify(PAGES.map((p) => p.de).reverse()), backward.join(' | '))
  await s.context.close()
}

// 4) Theme: the choice made on one page holds on the next pages of the same browser.
{
  const s = await session({ scheme: 'light' })
  await go(s.page, '/help/')
  await s.page.getByRole('button', { name: /Zum dunklen Design wechseln/ }).click()
  check('theme toggle switches to dark on the start page', (await s.page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
  await go(s.page, '/help/rights/')
  const dark = await s.page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }))
  check('dark theme persists on another page', dark.theme === 'dark' && dark.bg === 'rgb(14, 15, 20)', JSON.stringify(dark))
  await go(s.page, '/help/tech/')
  check('the theme toggle on another page shows the light choice', (await s.page.getByRole('button', { name: /Zum hellen Design wechseln/ }).count()) === 1)
  await s.page.getByRole('button', { name: /Zum hellen Design wechseln/ }).click()
  await go(s.page, '/help/sources/')
  check('switching back to light persists', (await s.page.evaluate(() => document.documentElement.dataset.theme)) === 'light')
  await s.context.close()
}

// 5) Layout: no horizontal overflow at 360, 768 and 1440 px, and touch targets of 44 px in the header and navigation.
{
  for (const width of [360, 768, 1440]) {
    const s = await session({ width, height: 800 })
    for (const p of PAGES) {
      await go(s.page, p.path)
      const widths = await s.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
      check(`no horizontal overflow at ${width} px on ${p.path}`, widths[0] <= widths[1], widths.join(' > '))
    }
    if (width === 360) {
      await go(s.page, '/help/rights/')
      const small = await s.page.evaluate(() =>
        [...document.querySelectorAll('header a, header button, nav[aria-label="Hilfeseiten"] a')].filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height))
      )
      check('header and navigation targets are at least 44 px tall at 360 px', small.length > 0 && small.every((h) => h >= 44), small.join(','))
    }
    await s.context.close()
  }
}

// 6) Sources page: no printed URLs, no removed sources, the rights pointer works.
{
  const s = await session()
  await go(s.page, '/help/sources/')
  const externals = await s.page.locator('main a[target="_blank"]').evaluateAll((els) => els.map((a) => ({ href: a.getAttribute('href'), text: a.innerText })))
  check('sources: external links show only their title', externals.length > 0 && externals.every((l) => !/https?:\/\//.test(l.text)), JSON.stringify(externals))
  check('sources: no links to Freesound or Incompetech', externals.every((l) => !/freesound|incompetech/i.test(l.href)))
  check('sources: Free Music Archive links to its home page', externals.some((l) => l.href === 'https://freemusicarchive.org/home'))
  const outside = await s.page.locator('main section:not(#credit)').evaluateAll((els) => els.map((e) => e.innerText).join('\n'))
  check('sources: no raw address printed outside the credit example', !/https?:\/\//.test(outside))
  const headings = await s.page.locator('main h2').allInnerTexts()
  check('sources: "Nicht verwenden" section moved to the rights page', !headings.some((h) => /Nicht verwenden/.test(h)), headings.join(' | '))
  await s.page.locator('#check a[href="../rights/"]').click()
  await s.page.waitForURL(/\/help\/rights\/$/)
  check('sources: pointer link opens the rights page', (await s.page.locator('h1').innerText()).trim() === titleOf('rights', 'de'))
  await s.context.close()
}

// 7) Rights page: age-limit and image-rights headings, in both languages.
for (const [locale, age, image] of [
  ['de-DE', /Mindestalter/, /Recht am eigenen Bild/],
  ['en-US', /Minimum ages/, /right to your own image/i]
]) {
  const s = await session({ locale })
  await go(s.page, '/help/rights/')
  const headings = await s.page.locator('main h2').allInnerTexts()
  check(`rights (${locale.slice(0, 2)}): has the age-limit heading`, headings.some((h) => age.test(h)), headings.join(' | '))
  check(`rights (${locale.slice(0, 2)}): has the image-rights heading`, headings.some((h) => image.test(h)), headings.join(' | '))
  check(`rights (${locale.slice(0, 2)}): has callouts and the general-information note`, (await s.page.locator('aside').count()) >= 3)
  await s.context.close()
}

// 8) Screenshots of four pages in light and dark, at phone and desktop size.
for (const slug of ['index', 'sources', 'rights', 'tech']) {
  const p = PAGES.find((x) => x.slug === slug)
  for (const scheme of ['light', 'dark']) {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const s = await session({ width, height, scheme })
      await go(s.page, p.path)
      const name = slug === 'index' ? 'start' : slug
      await s.page.screenshot({ path: join(SHOT_DIR, `help-${name}-${scheme}-${width}.png`), fullPage: true })
      check(`screenshot written: help-${name}-${scheme}-${width}.png`, true)
      await s.context.close()
    }
  }
}

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
if (failed) {
  console.log(`${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log(`ALL ${outcomes.length} CHECKS PASSED`)
void root
