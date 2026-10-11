// Real-browser check of the responsive editor: no horizontal overflow, the player is visible, the tabs are
// reachable with 44px targets, every tap target is 44px (or has a 44px hit area), the Tab order in compact
// mode goes player -> timeline -> tool sheet, touch long-press lifts a clip (CDP touch events) while a quick
// swipe still scrolls, the overflow menu works on phones, and the export dialog fits. Screenshots of every size.
// Usage: node scripts/e2e-responsive.mjs   (env SHOT_DIR overrides the screenshot folder, E2E_PORT the port)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 5210)
const FIXTURES = join(process.cwd(), 'tests/fixtures')
const APP_URL = `http://localhost:${PORT}/app/?demo=1`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const TOUCH_MIN = 44

const SIZES = [
  { name: 'phone-portrait', width: 390, height: 844, touch: true },
  { name: 'phone-landscape', width: 844, height: 390, touch: true },
  { name: 'tablet-portrait', width: 820, height: 1180, touch: true },
  // Touch at desktop width: the desktop layout, but the coarse-pointer rules (44px bars, pan, long press) still apply.
  { name: 'tablet-landscape', width: 1180, height: 820, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false }
]

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

/** Inside the visible viewport (a small tolerance for sub-pixel layout). */
function inViewport(box, size) {
  return box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= size.width + 0.5 && box.y + box.height <= size.height + 0.5
}

async function visibleBox(locator) {
  await locator.first().waitFor({ state: 'visible', timeout: 10000 })
  const box = await locator.first().boundingBox()
  assert(box, 'no bounding box')
  return box
}

/** Short landscape screens: an open panel covers the timeline and the player, so it is hidden before the next step. */
async function hideToolsIfOpen(page) {
  const hide = page.getByRole('button', { name: 'Hide tools', exact: true })
  if (await hide.isVisible()) await hide.click()
}

/** Back to the top-left of the timeline: keyboard focus or earlier steps may have scrolled it, and the checks need fixed positions. */
async function resetTimelineScroll(page, { left = true } = {}) {
  await page.evaluate((resetLeft) => {
    document.querySelector('.jc-timeline').scrollTop = 0
    if (resetLeft) document.querySelector('[data-role="ruler"]').parentElement.parentElement.scrollLeft = 0
  }, left)
}

/** Scrolls a timeline bar into view (landscape phones show only part of the timeline), then returns its box. */
async function revealBar(page, name) {
  const bar = page.getByRole('button', { name, exact: true }).first()
  await bar.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  return visibleBox(bar)
}

/** Closes a dialog with Escape and waits until it is gone, so the next step is not blocked by it. */
async function closeWithEscape(page, dialog) {
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 3000 })
}

/** Every visible control in the editor smaller than 44 CSS px, counting a ::before/::after hit extension. */
async function undersizedTargets(page) {
  return page.evaluate(() => {
    const selector = 'button, a[href], input, select, [role="tab"], [role="switch"], [data-handle]'
    const bad = []
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      let w = r.width
      let h = r.height
      if (cs.position !== 'static') {
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(el, pseudo)
          if (ps.content === 'none' || ps.position !== 'absolute') continue
          const side = (v) => (v === 'auto' ? null : parseFloat(v))
          const top = side(ps.top)
          const bottom = side(ps.bottom)
          const left = side(ps.left)
          const right = side(ps.right)
          const ph = top !== null && bottom !== null ? r.height - top - bottom : parseFloat(ps.height)
          const pw = left !== null && right !== null ? r.width - left - right : parseFloat(ps.width)
          h = Math.max(h, ph)
          w = Math.max(w, pw)
        }
      }
      // Timeline bars: a short clip is narrower than 44 px by nature, so only the height is required.
      const isBar = el.tagName === 'BUTTON' && el.closest('.jc-timeline__track') !== null
      if (h < 43.5 || (!isBar && w < 43.5)) {
        bad.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)} ${Math.round(w)}x${Math.round(h)}`)
      }
    }
    return bad
  })
}

/** Keyboard Tab from the top of the page: returns the region rank of each stop (0 top bar, 1 player, 2 timeline, 3 sheet). */
async function tabRegions(page) {
  await page.evaluate(() => document.activeElement?.blur())
  const ranks = []
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press('Tab')
    const rank = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return 'none'
      if (el.closest('header.jc-topbar')) return 0
      if (el.closest('main.jc-main')) return 1
      if (el.closest('section.jc-timeline')) return 2
      if (el.closest('aside.jc-sheet')) return 3
      return -1
    })
    if (rank === 'none') break
    ranks.push(rank)
    if (rank === 0 && ranks.includes(3)) break
  }
  return ranks
}

/** One touch gesture through CDP: press, optional hold, then a straight move in steps, then release. */
async function touchGesture(cdp, page, from, to, { holdMs = 0, steps = 10, onHold, onStep } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] })
  if (holdMs) {
    await page.waitForTimeout(holdMs)
    if (onHold) await onHold()
  }
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
    if (onStep) await onStep()
    await page.waitForTimeout(30)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(100)
}

function centerOf(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const videoClipOrder = (page) => page.$$eval('[data-lane="video"] button', (els) => els.map((e) => e.getAttribute('aria-label')))
const firstTextStart = (page) =>
  page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value.editor.history.present.texts[0].start)
const timelineScrollLeft = (page) => page.evaluate(() => document.querySelector('[data-role="ruler"]').parentElement.parentElement.scrollLeft)

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
mkdirSync(SHOT_DIR, { recursive: true })

const pageErrors = []

// Optional filters for a quick run: SIZE=phone-portrait SCHEME=dark
for (const size of SIZES.filter((z) => !process.env.SIZE || z.name === process.env.SIZE)) {
  for (const scheme of ['light', 'dark'].filter((c) => !process.env.SCHEME || c === process.env.SCHEME)) {
    const label = `${size.name} ${size.width}x${size.height} ${scheme}`
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      colorScheme: scheme,
      locale: 'en-US',
      hasTouch: size.touch,
      isMobile: size.touch
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`))
    if (process.env.E2E_TRACE) {
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`TRACE ${label} navigated ${f.url()}`) })
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`TRACE ${label} console.${m.type()} ${m.text().slice(0, 160)}`) })
      page.on('close', () => console.log(`TRACE ${label} page closed`))
      context.on('page', (p2) => console.log(`TRACE ${label} new page ${p2.url()}`))
    }
    await page.goto(APP_URL)
    await page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first().waitFor({ state: 'attached', timeout: 20000 })
    await page.evaluate(() => document.fonts.ready)
    const viewport = { width: size.width, height: size.height }
    const shot = (suffix) => page.screenshot({ path: join(SHOT_DIR, `resp-${size.name}-${scheme}${suffix}.png`) })
    await shot('-start')

    await check(`${label}: Tab order is player -> timeline -> tool sheet`, async () => {
      const ranks = await tabRegions(page)
      const seen = ranks.filter((rank) => rank >= 0)
      for (const region of [1, 2, 3]) assert(seen.includes(region), `region ${region} never reached (ranks ${ranks.join(',')})`)
      const first = (region) => seen.indexOf(region)
      assert(first(1) < first(2) && first(2) < first(3), `order ${seen.join(',')}`)
      for (let i = 1; i < seen.length; i++) assert(seen[i] >= seen[i - 1], `focus went back: ${seen.join(',')}`)
    })

    await check(`${label}: no horizontal page scroll`, async () => {
      const metrics = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        bodyW: document.body.scrollWidth,
        innerW: window.innerWidth,
        clientW: document.documentElement.clientWidth
      }))
      assert(metrics.docW <= metrics.clientW + 1, `document scrollWidth ${metrics.docW} > ${metrics.clientW}`)
      assert(metrics.bodyW <= metrics.innerW + 1, `body scrollWidth ${metrics.bodyW} > ${metrics.innerW}`)
    })

    await check(`${label}: player visible`, async () => {
      const box = await visibleBox(page.locator('canvas').first())
      assert(box.width >= 120 && box.height >= 60, `canvas ${Math.round(box.width)}x${Math.round(box.height)}`)
      assert(inViewport(box, viewport), `canvas outside viewport: ${JSON.stringify(box)}`)
    })

    await check(`${label}: export button reachable`, async () => {
      const box = await visibleBox(page.locator('#export-button'))
      assert(inViewport(box, viewport), `export button outside viewport: ${JSON.stringify(box)}`)
      assert(box.height >= TOUCH_MIN - 8, `export button ${Math.round(box.height)}px high`)
    })

    await check(`${label}: tabs reachable, 44px targets`, async () => {
      for (const name of ['Media', 'Audio', 'Record']) {
        const box = await visibleBox(page.getByRole('button', { name, exact: true }))
        assert(inViewport(box, viewport), `${name} tab outside viewport: ${JSON.stringify(box)}`)
        if (size.touch) assert(box.height >= TOUCH_MIN - 0.5 && box.width >= TOUCH_MIN - 0.5, `${name} tab ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
      await page.getByRole('tab', { name: 'Design', exact: true }).click()
      const text = await visibleBox(page.getByRole('button', { name: 'Text', exact: true }))
      assert(inViewport(text, viewport), 'Text tab outside viewport')
      if (size.touch) assert(text.height >= TOUCH_MIN - 0.5, `Text tab ${Math.round(text.height)}px high`)
      await page.getByRole('tab', { name: 'Material', exact: true }).click()
    })

    await check(`${label}: action bar buttons are touch sized`, async () => {
      if (!size.touch) return
      const box = await visibleBox(page.getByRole('button', { name: 'Split', exact: true }))
      assert(box.height >= TOUCH_MIN - 0.5, `Split ${Math.round(box.height)}px high`)
    })

    await check(`${label}: timeline shows clips and taps move the playhead`, async () => {
      await hideToolsIfOpen(page)
      await resetTimelineScroll(page)
      const clip = await visibleBox(page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }))
      assert(clip.height >= 20, `clip ${Math.round(clip.height)}px high`)
      const scroller = page.locator('[data-role="ruler"]').locator('xpath=../..')
      const scrollBox = await visibleBox(scroller)
      const before = await page.locator('[data-role="playhead"]').boundingBox()
      const tapX = scrollBox.x + scrollBox.width * 0.6
      const tapY = scrollBox.y + 5
      if (size.touch) await page.touchscreen.tap(tapX, tapY)
      else await page.mouse.click(tapX, tapY)
      await page.waitForTimeout(150)
      const after = await page.locator('[data-role="playhead"]').boundingBox()
      assert(Math.abs(after.x - before.x) > 2, `playhead did not move (${before.x} -> ${after.x})`)
    })

    await check(`${label}: lane rows and clip bodies are 44px on touch, 38px lanes on desktop`, async () => {
      const heights = await page.$$eval('[data-lane]', (els) => els.map((e) => e.getBoundingClientRect().height))
      const bars = await page.$$eval('[data-lane] [data-kind] > button', (els) => els.map((e) => e.getBoundingClientRect().height))
      assert(heights.length === 5, `lanes ${heights.length}`)
      if (size.touch) {
        assert(heights.every((h) => h >= TOUCH_MIN - 0.5), `lane heights ${heights.map(Math.round).join(',')}`)
        assert(bars.every((h) => h >= TOUCH_MIN - 0.5), `bar heights ${bars.map(Math.round).join(',')}`)
      } else {
        assert(heights.every((h) => Math.abs(h - 38) < 0.5), `desktop lane heights ${heights.map(Math.round).join(',')}`)
      }
    })

    await check(`${label}: timeline scrolls sideways`, async () => {
      const moved = await page.evaluate(() => {
        const ruler = document.querySelector('[data-role="ruler"]')
        const el = ruler.parentElement.parentElement
        if (el.scrollWidth <= el.clientWidth) return 'no overflow'
        el.scrollLeft = 120
        return el.scrollLeft > 0 ? 'ok' : 'stuck'
      })
      assert(moved === 'ok' || moved === 'no overflow', `scroll ${moved}`)
    })

    // Compact layout only (below 1100 px): the 44px rules are scoped to it; the desktop layout keeps its sizes.
    if (size.touch && size.width < 1100) await check(`${label}: every tap target is at least 44px (all tabs)`, async () => {
      const problems = []
      const tabs = [
        ['Material', 'Media'],
        ['Material', 'Audio'],
        ['Material', 'Record'],
        ['Design', 'Text'],
        ['Design', 'Draw'],
        ['Look', 'Filters'],
        ['Look', 'Transitions']
      ]
      for (const [group, tab] of tabs) {
        await page.getByRole('tab', { name: group, exact: true }).click()
        await page.getByRole('button', { name: tab, exact: true }).click()
        for (const bad of await undersizedTargets(page)) problems.push(`[${tab}] ${bad}`)
      }
      await page.getByRole('tab', { name: 'Material', exact: true }).click()
      await page.getByRole('button', { name: 'Media', exact: true }).click()
      assert(problems.length === 0, `${problems.length} undersized: ${[...new Set(problems)].slice(0, 6).join(' | ')}`)
    })

    await check(`${label}: library add tile is visible on touch and has a visible keyboard focus`, async () => {
      await page.getByRole('tab', { name: 'Material', exact: true }).click()
      await page.getByRole('button', { name: 'Media', exact: true }).click()
      if ((await page.locator('.jc-tile__add').count()) === 0) {
        // The demo has only missing files; importing a real clip gives a ready tile.
        await page.locator('input[type=file]').first().setInputFiles(join(FIXTURES, 'frames.webm'))
        await page.locator('.jc-tile__add').first().waitFor({ state: 'attached', timeout: 20000 })
      }
      await page.evaluate(() => document.activeElement?.blur())
      await page.waitForTimeout(300)
      if (size.touch) {
        const opacity = await page.evaluate(() => getComputedStyle(document.querySelector('.jc-tile__add')).opacity)
        assert(opacity === '1', `add overlay opacity ${opacity} without hover on touch`)
      }
      let found = false
      for (let i = 0; i < 300 && !found; i++) {
        await page.keyboard.press('Tab')
        found = await page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && document.activeElement.querySelector('.jc-tile__add') !== null)
      }
      assert(found, 'keyboard Tab never reached a library tile')
      await page.waitForTimeout(300)
      const style = await page.evaluate(() => {
        const tile = document.activeElement
        const add = tile.querySelector('.jc-tile__add')
        const cs = getComputedStyle(tile)
        return { focusVisible: tile.matches(':focus-visible'), opacity: getComputedStyle(add).opacity, outline: cs.outlineStyle, width: cs.outlineWidth }
      })
      assert(style.focusVisible, 'tile is not :focus-visible')
      assert(style.opacity === '1', `add overlay opacity ${style.opacity} while focused`)
      assert(style.outline === 'solid' && parseFloat(style.width) >= 2, `focus outline ${style.outline} ${style.width}`)
    })

    if (size.touch) {
      await check(`${label}: tapping a clip opens its panel without overflow`, async () => {
        await hideToolsIfOpen(page)
        await resetTimelineScroll(page)
        await page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first().tap()
        await page.getByRole('heading', { name: 'Clip · Beach.mp4' }).waitFor({ timeout: 5000 })
        const metrics = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        assert(metrics <= 1, `page overflows by ${metrics}px`)
        await shot('-clip')
        if (size.width < 1100) {
          const problems = await undersizedTargets(page)
          assert(problems.length === 0, `with trim handles: ${problems.slice(0, 6).join(' | ')}`)
        }
      })
      const cdp = await context.newCDPSession(page)
      await check(`${label}: long press lifts a clip, a drag reorders it`, async () => {
        await hideToolsIfOpen(page)
        const before = await videoClipOrder(page)
        assert(before.length >= 2, `clips ${before.join(', ')}`)
        const a = centerOf(await revealBar(page, before[0]))
        const b = centerOf(await revealBar(page, before[1]))
        let lifted = false
        await touchGesture(cdp, page, a, { x: b.x + 12, y: a.y }, {
          holdMs: 450,
          steps: 12,
          onHold: async () => {
            lifted = (await page.locator('[data-lifted="true"]').count()) === 1
            await shot('-lifted')
          }
        })
        assert(lifted, 'no lifted bar after the long press')
        const after = await videoClipOrder(page)
        assert(after[0] === before[1] && after[1] === before[0], `order ${before.join(', ')} -> ${after.join(', ')}`)
        assert((await page.locator('[data-lifted="true"]').count()) === 0, 'bar still lifted after release')
      })
      await check(`${label}: a quick swipe pans the timeline and lifts nothing`, async () => {
        await hideToolsIfOpen(page)
        await resetTimelineScroll(page)
        await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
        const order = await videoClipOrder(page)
        const target = centerOf(await revealBar(page, order[1]))
        const scrollBefore = await timelineScrollLeft(page)
        let lifted = false
        await touchGesture(cdp, page, target, { x: target.x - 120, y: target.y }, {
          steps: 20,
          onStep: async () => {
            if ((await page.locator('[data-lifted="true"]').count()) > 0) lifted = true
          }
        })
        const scrollAfter = await timelineScrollLeft(page)
        assert(!lifted, 'swipe lifted a bar')
        assert(JSON.stringify(await videoClipOrder(page)) === JSON.stringify(order), 'swipe reordered clips')
        assert(scrollAfter > scrollBefore, `timeline did not pan (${scrollBefore} -> ${scrollAfter})`)
      })
      await check(`${label}: long press moves a text item`, async () => {
        // The swipe above panned the timeline; bring the text bar (at the start) back into view.
        await hideToolsIfOpen(page)
        await resetTimelineScroll(page)
        const bar = centerOf(await revealBar(page, await page.locator('[data-lane="text"] button').first().getAttribute('aria-label')))
        const startBefore = await firstTextStart(page)
        await touchGesture(cdp, page, bar, { x: bar.x + 40, y: bar.y }, { holdMs: 450, steps: 8 })
        const startAfter = await firstTextStart(page)
        assert(startAfter > startBefore, `text start ${startBefore} -> ${startAfter}`)
      })
      await check(`${label}: touch can pan the timeline (touch-action)`, async () => {
        const action = await page.evaluate(() => {
          const track = document.querySelector('.jc-timeline__track')
          return getComputedStyle(track).touchAction
        })
        assert(action.includes('pan-x'), `touch-action ${action}`)
      })
    }

    if (size.width < 768) {
      await check(`${label}: overflow menu holds undo, redo and theme`, async () => {
        const more = await visibleBox(page.getByRole('button', { name: 'More', exact: true }))
        assert(more.height >= TOUCH_MIN - 0.5, `More button ${Math.round(more.height)}px`)
        await page.getByRole('button', { name: 'More', exact: true }).click()
        for (const name of ['Undo', 'Redo']) {
          const box = await visibleBox(page.getByRole('button', { name, exact: true }))
          assert(inViewport(box, viewport), `${name} outside viewport`)
        }
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Undo', exact: true }).waitFor({ state: 'hidden', timeout: 3000 })
      })
    }

    await check(`${label}: export dialog fits`, async () => {
      await page.locator('#export-button').click()
      const dialog = page.getByRole('dialog').first()
      const box = await visibleBox(dialog)
      assert(inViewport(box, viewport), `dialog outside viewport: ${JSON.stringify(box)}`)
      const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)
      assert(overflow <= 1, `dialog overflows horizontally by ${overflow}px`)
      await shot('-export')
      await closeWithEscape(page, dialog)
    })

    await check(`${label}: fine cut overlay fits`, async () => {
      // Fine cut needs a video clip under the playhead or selected: select the clip, then hide the panel it opens.
      await hideToolsIfOpen(page)
      const clip = page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first()
      if (size.touch) await clip.tap()
      else await clip.click()
      await hideToolsIfOpen(page)
      await page.locator('#fine-cut-button').click()
      const back = await visibleBox(page.locator('[data-testid="fine-back"]'))
      assert(inViewport(back, viewport), `back button outside viewport: ${JSON.stringify(back)}`)
      const primary = await visibleBox(page.locator('[data-testid="fine-primary"], [data-testid="fine-unavailable"]'))
      assert(inViewport(primary, viewport), `fine cut content outside viewport: ${JSON.stringify(primary)}`)
      await shot('-finecut')
      await page.locator('[data-testid="fine-back"]').click()
      await page.locator('[data-testid="fine-back"]').waitFor({ state: 'hidden', timeout: 3000 })
    })

    await check(`${label}: credits dialog fits`, async () => {
      await page.locator('#project-menu-trigger').click()
      await page.getByRole('menuitem', { name: 'Credits…' }).click()
      const dialog = page.getByRole('dialog').first()
      const box = await visibleBox(dialog)
      assert(inViewport(box, viewport), `credits outside viewport: ${JSON.stringify(box)}`)
      const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)
      assert(overflow <= 1, `credits overflows horizontally by ${overflow}px`)
      await shot('-credits')
      await closeWithEscape(page, dialog)
    })

    await check(`${label}: relink dialog fits`, async () => {
      await hideToolsIfOpen(page)
      const back = page.getByRole('button', { name: 'Back to library', exact: true })
      if (await back.isVisible()) await back.click()
      // The dialog opens on its own when files are missing; the demo has them missing, so set the store flag.
      await page.evaluate(() => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
        pinia.state.value.media.relinkOpen = true
      })
      const dialog = page.getByRole('dialog').first()
      const box = await visibleBox(dialog)
      assert(inViewport(box, viewport), `relink outside viewport: ${JSON.stringify(box)}`)
      const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)
      assert(overflow <= 1, `relink overflows horizontally by ${overflow}px`)
      await shot('-relink')
      await closeWithEscape(page, dialog)
    })

    await check(`${label}: screenshot`, async () => {
      await shot('')
    })

    await context.close()
  }
}

await check('no page errors during the run', async () => {
  assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
})

await browser.close()
await server.close()

const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
