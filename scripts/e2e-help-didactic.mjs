// Real-browser checks for the four didactic help pages: container, compression, encoding, glossary.
// Each page loads without console errors, the widgets respond, no horizontal overflow at 360 and 1440 px,
// and screenshots (light and dark, phone and desktop) are written for review.
// Usage: node scripts/e2e-help-didactic.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'

const PORT = 5320
const BASE = `http://localhost:${PORT}/help`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const PAGES = ['container', 'compression', 'encoding', 'glossary']

const outcomes = []

function assert(condition, message) {
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
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${root}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return `${root}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
mkdirSync(SHOT_DIR, { recursive: true })

/** Opens a help page with its own context and collects console errors and page errors. */
async function open(slug, { width = 1440, height = 900, scheme = 'light', locale = 'de-DE', hash = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error' || /not found .*key|missing key/i.test(text)) problems.push(`console ${msg.type()}: ${text}`)
  })
  await page.goto(`${BASE}/${slug}/${hash}`)
  await page.locator('#main h1').waitFor()
  await page.waitForTimeout(400)
  return { page, context, problems }
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// Pages load, no console errors or page errors, and nothing overflows at phone and desktop widths.
for (const slug of PAGES) {
  await check(`${slug}: loads without console errors and fits 360 px`, async () => {
    const { page, context, problems } = await open(slug, { width: 360, height: 800 })
    await page.waitForTimeout(800)
    const extra = await overflow(page)
    assert(extra <= 0, `horizontal overflow ${extra}px at 360`)
    await context.close()
    assert(problems.length === 0, problems.join('\n'))
  })
  await check(`${slug}: no horizontal overflow at 1440 px`, async () => {
    const { page, context, problems } = await open(slug, { width: 1440 })
    const extra = await overflow(page)
    assert(extra <= 0, `horizontal overflow ${extra}px at 1440`)
    await context.close()
    assert(problems.length === 0, problems.join('\n'))
  })
}

/** The section of a help page whose heading matches re. */
const section = (page, re) => page.locator('section').filter({ has: page.getByRole('heading', { name: re }) })

/** Sets a range input the way a user would: value, then the input event. */
async function setRange(locator, value) {
  await locator.evaluate((el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/** Text of an element that carries data-stat=name. */
const stat = (page, name) => page.locator(`[data-stat="${name}"]`).first().innerText()

await check('container: box opens and shows the tracks', async () => {
  const { page, context } = await open('container')
  const button = page.getByRole('button', { name: 'Box öffnen' })
  assert(await page.locator('#container-box-tracks').isHidden(), 'tracks visible before opening')
  await button.click()
  assert(await page.locator('#container-box-tracks').isVisible(), 'tracks hidden after opening')
  await page.getByRole('button', { name: 'Box schließen' }).click()
  await context.close()
})

await check('container: frame strip responds to keyboard and pointer', async () => {
  const { page, context } = await open('container')
  const slider = page.getByRole('slider', { name: 'Position im Video' })
  const before = Number(await slider.getAttribute('aria-valuenow'))
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const afterKeys = Number(await slider.getAttribute('aria-valuenow'))
  assert(afterKeys === before + 2, `keys moved ${before} -> ${afterKeys}`)
  const box = await slider.boundingBox()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const afterDrag = Number(await slider.getAttribute('aria-valuenow'))
  assert(afterDrag > 150, `drag ended at frame ${afterDrag}`)
  await context.close()
})

await check('compression: flipbook frame slider changes the highlighted pixel count', async () => {
  const { page, context } = await open('compression')
  const flip = section(page, /Trick 1/)
  await setRange(flip.locator('input[type=range]').nth(0), 0)
  const first = await stat(page, 'changed')
  await setRange(flip.locator('input[type=range]').nth(0), 5)
  const later = await stat(page, 'changed')
  assert(first !== later, `count did not change: "${first}" vs "${later}"`)
  await context.close()
})

await check('compression: keyframe interval changes the stored amount bars', async () => {
  const { page, context } = await open('compression')
  const before = await stat(page, 'total')
  await setRange(section(page, /Trick 1/).locator('input[type=range]').nth(1), 0)
  const after = await stat(page, 'total')
  assert(before !== after, `stored amount did not change: "${before}" vs "${after}"`)
  await context.close()
})

await check('compression: more movement means more changed pixels', async () => {
  const { page, context } = await open('compression')
  const flip = section(page, /Trick 1/)
  await setRange(flip.locator('input[type=range]').nth(0), 5)
  await setRange(flip.locator('input[type=range]').nth(2), 0)
  const still = await stat(page, 'changed')
  await setRange(flip.locator('input[type=range]').nth(2), 4)
  const fast = await stat(page, 'changed')
  assert(still !== fast, `movement had no effect: "${still}" vs "${fast}"`)
  await context.close()
})

await check('compression: seek demo names the keyframe before second 30', async () => {
  const { page, context } = await open('compression')
  await section(page, /Mitten ins Video/).getByText('alle 4 s', { exact: true }).click()
  const text = await stat(page, 'seek')
  assert(text.includes('Sekunde 28'), `unexpected seek text: ${text}`)
  await page.getByRole('button', { name: 'Springe zu Sekunde 30' }).click()
  await context.close()
})

await check('compression: JPEG quality slider changes the displayed quality and size', async () => {
  const { page, context } = await open('compression')
  const before = await stat(page, 'size')
  await setRange(section(page, /Details weglassen/).locator('input[type=range]'), 5)
  await page.waitForTimeout(500)
  const after = await stat(page, 'size')
  assert(before !== after, `size text did not change: "${before}" vs "${after}"`)
  await context.close()
})

await check('compression: raw size calculator shows 11.2 GB for 1080p at 30 fps for 60 s', async () => {
  const { page, context } = await open('compression')
  const calc = section(page, /Warum Rohvideo/)
  await calc.getByText('Full HD', { exact: true }).click()
  await calc.locator('label', { hasText: /^30$/ }).click()
  await setRange(calc.locator('input[type=range]'), 60)
  const text = await stat(page, 'raw')
  assert(text.includes('11,2 GB'), `unexpected size: ${text}`)
  await context.close()
})

await check('encoding: recompression slider changes the displayed degradation', async () => {
  const { page, context } = await open('encoding')
  const passes = section(page, /Kopie einer Kopie/).locator('input[type=range]')
  await page.waitForFunction(() => document.querySelector('[data-stat="drift"]')?.innerText.includes('%'), null, { timeout: 20000 })
  await setRange(passes, 2)
  await page.waitForTimeout(600)
  const early = await stat(page, 'drift')
  await setRange(passes, 30)
  await page.waitForFunction((before) => document.querySelector('[data-stat="drift"]')?.innerText !== before, early, { timeout: 30000 })
  const late = await stat(page, 'drift')
  assert(early !== late, `drift did not change: "${early}" vs "${late}"`)
  await context.close()
})

await check('glossary: search filters terms and the count updates', async () => {
  const { page, context } = await open('glossary')
  const total = await page.locator('section[id]').count()
  await page.getByRole('searchbox').fill('Bildrate')
  const shown = await page.locator('section[id]:visible').count()
  assert(shown > 0 && shown < total, `filter shows ${shown} of ${total}`)
  const count = await stat(page, 'count')
  assert(count.includes(String(shown)), `count text "${count}" does not match ${shown}`)
  await page.getByRole('searchbox').fill('xyzxyz')
  const none = await page.locator('section[id]:visible').count()
  assert(none === 0, `expected no results, got ${none}`)
  await context.close()
})

await check('glossary: anchors scroll to the term and a hidden target clears the search', async () => {
  const { page, context } = await open('glossary', { hash: '#codec' })
  await page.waitForTimeout(500)
  const top = await page.locator('#codec').evaluate((el) => el.getBoundingClientRect().top)
  assert(top >= -5 && top < 400, `codec term top at ${top}`)
  await page.getByRole('searchbox').fill('Kodieren')
  await page.evaluate(() => (location.hash = '#keyframe'))
  await page.waitForTimeout(300)
  const search = await page.getByRole('searchbox').inputValue()
  assert(search === '', `search not cleared for hidden anchor: "${search}"`)
  await context.close()
})

await check('encoding: page links to glossary anchors that exist', async () => {
  const { page, context } = await open('encoding')
  const hrefs = await page.locator('a[href^="../glossary/#"]').evaluateAll((links) => links.map((a) => a.getAttribute('href')))
  assert(hrefs.length > 0, 'no glossary links found')
  const { page: g, context: gc } = await open('glossary')
  for (const href of hrefs) {
    const id = href.split('#')[1]
    assert(await g.locator(`#${id}`).count() === 1, `missing glossary anchor #${id}`)
  }
  await context.close()
  await gc.close()
})

// Screenshots: light and dark, phone and desktop.
for (const slug of PAGES) {
  for (const scheme of ['light', 'dark']) {
    for (const [size, width, height] of [
      ['390', 390, 844],
      ['1440', 1440, 900]
    ]) {
      await check(`${slug}: screenshot ${scheme} ${size}`, async () => {
        const { page, context } = await open(slug, { width, height, scheme })
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${SHOT_DIR}/didactic-${slug}-${scheme}-${size}.png`, fullPage: true })
        await context.close()
      })
    }
  }
}

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
