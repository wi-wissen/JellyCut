// Real-browser checks for the landing page (/): links, theme toggle, footer, overflow, reduced motion,
// keyboard focus, no editor code, and screenshots in light and dark.
// Usage: node scripts/e2e-landing.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5290
const BASE = `http://localhost:${PORT}`
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const GITHUB = 'https://github.com/wi-wissen/JellyCut'

const outcomes = []
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
async function check(name, fn) {
  try {
    await fn()
    outcomes.push(true)
    console.log(`PASS ${name}`)
  } catch (e) {
    outcomes.push(false)
    console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`)
  }
}

function findChromium() {
  const dirRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${dirRoot}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(dirRoot).find((d) => d.startsWith('chromium-'))
  return `${dirRoot}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ root, server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
mkdirSync(SHOT_DIR, { recursive: true })

/** Opens the landing page in a fresh context and collects errors and requested scripts. */
async function open({ width = 1440, height = 900, colorScheme = 'light', reducedMotion = 'no-preference', theme } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: 'en-US',
    colorScheme,
    reducedMotion
  })
  if (theme) await context.addInitScript((t) => localStorage.setItem('jellycut.theme', t), theme)
  const page = await context.newPage()
  const errors = []
  const scripts = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()))
  page.on('response', (r) => r.request().resourceType() === 'script' && scripts.push(new URL(r.url()).pathname))
  await page.goto(`${BASE}/`)
  await page.waitForSelector('h1')
  await page.waitForLoadState('networkidle')
  return { context, page, errors, scripts }
}

// 1) Content, links and the page loads cleanly.
{
  const { context, page, errors, scripts } = await open()
  await check('page renders the hero and no console or page errors', async () => {
    assert((await page.locator('h1').innerText()).length > 10, 'empty h1')
    assert(errors.length === 0, errors.join('; '))
  })
  await check('the big call to action links to ./app/', async () => {
    const href = await page.locator('main a.jc-cta').first().getAttribute('href')
    assert(href === './app/', `href is ${href}`)
  })
  await check('the header help link points to ./help/ and sits in the header', async () => {
    const href = await page.locator('header a.jc-help-link').getAttribute('href')
    assert(href === './help/', `href is ${href}`)
  })
  await check('the footer GitHub link is present with rel=noopener', async () => {
    const link = page.locator(`footer a[href="${GITHUB}"]`)
    assert((await link.count()) === 1, 'footer GitHub link missing')
    const rel = await link.getAttribute('rel')
    assert(/noopener/.test(rel ?? ''), `rel is ${rel}`)
  })
  await check('the landing page loads no editor code, mediabunny or worker', async () => {
    assert(!scripts.some((p) => /mediabunny|worker|EditorView|exporter/i.test(p)), scripts.join(', '))
  })
  await check('touch targets: CTA, help link and theme toggle are at least 44px high', async () => {
    for (const selector of ['main a.jc-cta', 'header a.jc-help-link', 'header button']) {
      const box = await page.locator(selector).first().boundingBox()
      assert(box && box.height >= 44, `${selector} is ${box?.height}px high`)
    }
  })
  await check('keyboard: Tab reaches the help link and shows a focus ring', async () => {
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => document.activeElement?.className ?? '')
    assert(focused.includes('jc-help-link'), `focused: ${focused}`)
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)
    assert(outline !== 'none', 'no focus outline')
  })
  await context.close()
}

// 2) Theme toggle switches data-theme and remembers the choice across reloads.
{
  const { context, page, errors } = await open({ colorScheme: 'light' })
  await check('theme toggle switches data-theme and persists across reload', async () => {
    await page.locator('header button').click()
    assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'data-theme is not dark')
    await page.reload()
    await page.waitForSelector('h1')
    assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark not kept after reload')
    await page.locator('header button').click()
    assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'data-theme is not light')
    assert(errors.length === 0, errors.join('; '))
  })
  await context.close()
}

// 3) No horizontal overflow at phone, tablet and desktop widths.
for (const width of [360, 768, 1440]) {
  const { context, page } = await open({ width, height: 800 })
  await check(`no horizontal page scroll at ${width}px`, async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(300)
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    }))
    assert(scroll <= client, `scrollWidth ${scroll} > clientWidth ${client}`)
  })
  await context.close()
}

// 4) Motion: running by default, stopped for reduced motion (static final frame).
{
  const { context, page } = await open()
  await check('decorative animations run without reduced motion', async () => {
    const name = await page.evaluate(() => getComputedStyle(document.querySelector('.jc-blob')).animationName)
    assert(name !== 'none', `blob animation-name ${name}`)
    assert(await page.evaluate(() => document.documentElement.classList.contains('jc-motion')), 'jc-motion not set')
  })
  await context.close()
}
{
  const { context, page, errors } = await open({ reducedMotion: 'reduce' })
  await check('reduced motion stops the animations and shows the final frame', async () => {
    const styles = await page.evaluate(() => {
      const blob = getComputedStyle(document.querySelector('.jc-blob'))
      const sticker = getComputedStyle(document.querySelector('.jc-mock__sticker'))
      const playhead = getComputedStyle(document.querySelector('.jc-mock__playhead'))
      return {
        blob: blob.animationName,
        blobPlay: blob.animationPlayState,
        sticker: sticker.animationName,
        stickerOpacity: sticker.opacity,
        playhead: playhead.animationName,
        motion: document.documentElement.classList.contains('jc-motion')
      }
    })
    assert(styles.blob === 'none', `blob animation-name ${styles.blob}`)
    assert(styles.sticker === 'none' && styles.stickerOpacity === '1', `sticker ${styles.sticker} ${styles.stickerOpacity}`)
    assert(styles.playhead === 'none', `playhead ${styles.playhead}`)
    assert(styles.motion === false, 'jc-motion set under reduced motion')
    const cards = await page.locator('.jc-card').evaluateAll((els) => els.every((el) => getComputedStyle(el.parentElement).opacity === '1'))
    assert(cards, 'feature cards hidden under reduced motion')
    assert(errors.length === 0, errors.join('; '))
  })
  await context.close()
}

// 5) Screenshots, light and dark, phone and desktop. Scroll first so the reveals are shown.
for (const [label, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
  for (const theme of ['light', 'dark']) {
    const { context, page } = await open({ ...viewport, colorScheme: theme, theme })
    await check(`screenshot ${theme} ${label}`, async () => {
      const height = await page.evaluate(() => document.body.scrollHeight)
      for (let y = 0; y < height; y += 300) {
        await page.evaluate((top) => window.scrollTo(0, top), y)
        await page.waitForTimeout(60)
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(900)
      await page.screenshot({ path: join(SHOT_DIR, `landing-${theme}-${label}.png`), fullPage: true })
      assert(existsSync(join(SHOT_DIR, `landing-${theme}-${label}.png`)), 'screenshot not written')
    })
    await context.close()
  }
}

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
if (failed) {
  console.log(`${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('ALL CHECKS PASSED')
