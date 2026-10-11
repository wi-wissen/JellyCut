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
async function open(slug, { width = 1440, height = 900, scheme = 'light', locale = 'de-DE', hash = '', reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale, reducedMotion })
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
  assert(afterDrag >= 9 && afterDrag <= 11, `drag ended at frame ${afterDrag}`)
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

const seekSection = (page) => section(page, /Mitten ins Video/)

await check('compression: seek demo explains the keyframe before the target and the trade-off', async () => {
  const { page, context } = await open('compression')
  const seek = seekSection(page)
  await seek.getByText('alle 8 Bilder', { exact: true }).click()
  assert((await stat(page, 'seek')).includes('Bild 17'), `unexpected plan text: ${await stat(page, 'seek')}`)
  assert((await stat(page, 'counter')).includes('von 7'), `unexpected counter: ${await stat(page, 'counter')}`)
  assert((await stat(page, 'tradeoff')) === 'Weniger Schlüsselbilder = kleinere Datei, aber längeres Rechnen beim Springen.', 'trade-off text for 8')
  await seek.getByText('alle 4 Bilder', { exact: true }).click()
  assert((await stat(page, 'tradeoff')).startsWith('Mehr Schlüsselbilder'), 'trade-off text for 4')
  await context.close()
})

await check('compression: seek animation runs step by step and ends with Fertig and the counter', async () => {
  const { page, context } = await open('compression')
  const seek = seekSection(page)
  await seek.getByText('alle 8 Bilder', { exact: true }).click()
  await seek.getByRole('button', { name: 'Springe dorthin' }).click()
  await page.waitForTimeout(1800)
  const midCounter = await stat(page, 'counter')
  assert(!midCounter.includes('7 von 7') && !midCounter.includes('0 von 7'), `counter not mid-way: ${midCounter}`)
  await page.waitForFunction(() => document.querySelector('[data-stat="seek"]')?.innerText.startsWith('Fertig'), null, { timeout: 15000 })
  const counter = await stat(page, 'counter')
  assert(counter.includes('Bilder berechnet: 7 von 7'), `final counter "${counter}"`)
  await context.close()
})

await check('compression: reduced motion jumps straight to the finished state', async () => {
  const { page, context } = await open('compression', { reducedMotion: 'reduce' })
  await seekSection(page).getByRole('button', { name: 'Springe dorthin' }).click()
  await page.waitForTimeout(300)
  const text = await stat(page, 'seek')
  assert(text.startsWith('Fertig'), `reduced motion did not finish at once: ${text}`)
  await context.close()
})

await check('compression: flipbook marks newly covered and uncovered edges separately', async () => {
  const { page, context } = await open('compression')
  const flip = section(page, /Trick 1/)
  await setRange(flip.locator('input[type=range]').nth(0), 3)
  const num = async (name) => Number((await stat(page, name)).replace(/\D/g, ''))
  const newly = await num('newly')
  const uncovered = await num('uncovered')
  assert(newly > 0, `no newly covered pixels: ${newly}`)
  assert(uncovered > 0, `no uncovered pixels: ${uncovered}`)
  const changed = await num('changed')
  assert(changed >= newly + uncovered, `changed ${changed} smaller than edges ${newly + uncovered}`)
  await context.close()
})

await check('container: the lid stays inside the SVG box when the box is open, at 360 and 1440 px', async () => {
  for (const width of [360, 1440]) {
    const { page, context } = await open('container', { width })
    await page.getByRole('button', { name: 'Box öffnen' }).click()
    await page.waitForTimeout(700)
    const r = await page.evaluate(() => {
      const svg = document.querySelector('button[aria-controls="container-box-tracks"] svg')
      const lid = svg.querySelector('g').getBoundingClientRect()
      const box = svg.getBoundingClientRect()
      return { lid: [lid.left, lid.top, lid.right, lid.bottom], box: [box.left, box.top, box.right, box.bottom] }
    })
    const [l, t, rr, b] = r.lid
    const [L, T, R, B] = r.box
    assert(l >= L - 0.5 && t >= T - 0.5 && rr <= R + 0.5 && b <= B + 0.5, `lid ${r.lid} outside box ${r.box} at ${width}`)
    await context.close()
  }
})

await check('container: strip is a 2-second excerpt; picture, time axis and sound share the span', async () => {
  const { page, context } = await open('container')
  const slider = page.getByRole('slider', { name: 'Position im Video' })
  await slider.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  assert((await slider.getAttribute('aria-valuenow')) === '6', 'frame 6 not reached')
  assert((await slider.getAttribute('aria-valuetext')).includes('1 s'), `time at frame 6: ${await slider.getAttribute('aria-valuetext')}`)
  await page.keyboard.press('End')
  assert((await slider.getAttribute('aria-valuenow')) === '11', 'last frame is not 11')
  assert((await slider.getAttribute('aria-valuetext')).includes('1,83 s'), 'time at last frame')
  const thumbs = await page.locator('[role="slider"] .h-16 > div').count()
  assert(thumbs === 12, `strip has ${thumbs} pictures, expected 12`)
  const playhead = await page.locator('[role="slider"] .pointer-events-none').getAttribute('style')
  assert(/left:\s*91\.6/.test(playhead), `playhead not at frame 11: ${playhead}`)
  const widths = await page.evaluate(() => {
    const strip = document.querySelector('[role="slider"] .h-16').getBoundingClientRect()
    const wave = document.querySelector('[role="slider"] svg[viewBox="0 0 120 40"]').getBoundingClientRect()
    return [strip.left, strip.right, wave.left, wave.right]
  })
  assert(Math.abs(widths[0] - widths[2]) < 1 && Math.abs(widths[1] - widths[3]) < 1, `strip and sound differ in span: ${widths}`)
  const axis = await page.locator('[role="slider"] ~ div').first().innerText()
  assert(axis.includes('0 s') && axis.includes('2 s'), `time axis: ${axis}`)
  await context.close()
})

await check('container: the waveform is irregular, not a repeating pattern', async () => {
  const { page, context } = await open('container')
  const heights = await page.locator('svg[viewBox="0 0 120 40"] rect').evaluateAll((rs) => rs.map((r) => Number(r.getAttribute('height'))))
  assert(new Set(heights).size >= 6, `only ${new Set(heights).size} distinct bar heights`)
  const mean = heights.reduce((a, b) => a + b, 0) / heights.length
  const variance = heights.reduce((a, b) => a + (b - mean) ** 2, 0)
  let worst = 0
  for (let lag = 4; lag <= 40; lag++) {
    let sum = 0
    for (let i = 0; i + lag < heights.length; i++) sum += (heights[i] - mean) * (heights[i + lag] - mean)
    worst = Math.max(worst, Math.abs(sum / variance))
  }
  assert(worst < 0.4, `autocorrelation ${worst.toFixed(2)} too high`)
  await context.close()
})

await check('container: the Chromium sentence names the browsers', async () => {
  const { page, context } = await open('container')
  const text = await page.locator('#main').innerText()
  assert(text.includes('Dann hilft ein Chromium-basierter Browser wie Brave, Microsoft Edge oder Google Chrome.'), 'sentence not found')
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

// Screenshots of the reworked widgets: container box open, seek animation mid-way and finished, flipbook at frame 4.
for (const scheme of ['light', 'dark']) {
  for (const [size, width, height] of [
    ['390', 390, 844],
    ['1440', 1440, 900]
  ]) {
    await check(`didactic2 screenshots ${scheme} ${size}`, async () => {
      const { page, context } = await open('container', { width, height, scheme })
      await page.getByRole('button', { name: 'Box öffnen' }).click()
      await page.waitForTimeout(700)
      await page.locator('section').filter({ has: page.getByRole('heading', { name: /Die Box/ }) }).screenshot({ path: `${SHOT_DIR}/didactic2-box-${scheme}-${size}.png` })
      await context.close()
      const flipCtx = await open('compression', { width, height, scheme })
      const flip = section(flipCtx.page, /Trick 1/)
      await setRange(flip.locator('input[type=range]').nth(0), 3)
      await flip.screenshot({ path: `${SHOT_DIR}/didactic2-flip-frame4-${scheme}-${size}.png` })
      await flipCtx.context.close()
      const seekCtx = await open('compression', { width, height, scheme })
      const seek = seekSection(seekCtx.page)
      await seek.getByRole('button', { name: 'Springe dorthin' }).click()
      await seekCtx.page.waitForTimeout(400)
      await seek.screenshot({ path: `${SHOT_DIR}/didactic2-seek-look-${scheme}-${size}.png` })
      await seekCtx.page.waitForTimeout(2200)
      await seek.screenshot({ path: `${SHOT_DIR}/didactic2-seek-mid-${scheme}-${size}.png` })
      await seekCtx.page.waitForFunction(() => document.querySelector('[data-stat="seek"]')?.innerText.startsWith('Fertig'), null, { timeout: 15000 })
      await seek.screenshot({ path: `${SHOT_DIR}/didactic2-seek-end-${scheme}-${size}.png` })
      await seekCtx.context.close()
    })
  }
}

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
