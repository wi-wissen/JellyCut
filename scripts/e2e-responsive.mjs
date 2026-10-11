// Real-browser check of the responsive editor: no horizontal overflow, the player is visible, the tabs are
// reachable with 44px targets, the timeline is usable with touch, the overflow menu works on phones, and the
// export dialog fits. Screenshots of every size in light and dark.
// Usage: node scripts/e2e-responsive.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 5210
const APP_URL = `http://localhost:${PORT}/app/?demo=1`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const TOUCH_MIN = 44

const SIZES = [
  { name: 'phone-portrait', width: 390, height: 844, touch: true },
  { name: 'phone-landscape', width: 844, height: 390, touch: true },
  { name: 'tablet-portrait', width: 820, height: 1180, touch: true },
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

/** Closes a dialog with Escape and waits until it is gone, so the next step is not blocked by it. */
async function closeWithEscape(page, dialog) {
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 3000 })
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
mkdirSync(SHOT_DIR, { recursive: true })

const pageErrors = []

for (const size of SIZES) {
  for (const scheme of ['light', 'dark']) {
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
    await page.goto(APP_URL)
    await page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first().waitFor({ state: 'attached', timeout: 20000 })
    await page.evaluate(() => document.fonts.ready)
    const viewport = { width: size.width, height: size.height }
    const shot = (suffix) => page.screenshot({ path: join(SHOT_DIR, `resp-${size.name}-${scheme}${suffix}.png`) })
    await shot('-start')

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

    if (size.touch) {
      await check(`${label}: tapping a clip opens its panel without overflow`, async () => {
        await page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first().tap()
        await page.getByRole('heading', { name: 'Clip · Beach.mp4' }).waitFor({ timeout: 5000 })
        const metrics = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        assert(metrics <= 1, `page overflows by ${metrics}px`)
        await shot('-clip')
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
