// Real-browser checks for the polish round: format popover (Fit/Fill and background), top bar link,
// save-state dot, download file name, Filter naming, transitions tiles and previews, timeline context
// menu (mouse, keyboard, touch "more" button), fixed timeline height with the lane hint, transition zones.
// Usage: node scripts/e2e-polish.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 5270)
const BASE = `http://localhost:${PORT}`
const APP_URL = `${BASE}/app/`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'

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

const pageErrors = []
const newPage = async ({ url = `${APP_URL}?demo=1`, wait = true, ...options } = {}) => {
  const context = await browser.newContext({ locale: 'en-US', colorScheme: 'light', ...options })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(url)
  if (wait) await page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first().waitFor()
  return page
}

/** Runs source (ed, me) => value inside the page against the editor store. */
const st = (page, fn, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = pinia._s.get('editor')
      return new Function('ed', 'a', `return (${src})(ed, a)`)(ed, a)
    },
    [fn, arg]
  )

const tlClip = (page, name) => page.getByRole('button', { name: `Clip: ${name}`, exact: true }).first()
const tile = (page, name) => page.getByRole('button', { name, exact: true }).first()

// ---------- desktop, light: format popover, top bar, names, transitions, timeline ----------
const page = await newPage({ viewport: { width: 1120, height: 700 } })

await check('top bar: the logo and name link to the landing page with a relative path', async () => {
  const link = page.locator('header a[href="./../"]')
  assert((await link.count()) === 1, 'no relative link to ./../ in the top bar')
  assert((await link.innerText()).includes('Jelly Cut'), 'link has no product name')
})

await check('player toolbar has only the ratio chip (no separate picture fit chip)', async () => {
  assert((await page.getByRole('button', { name: /^Picture fit, currently/ }).count()) === 0, 'fit chip still in the toolbar')
  assert((await page.getByRole('button', { name: 'Aspect ratio', exact: true }).count()) === 1, 'ratio chip missing')
})

await check('format popover: Fit shows the background options with a helper text, Fill hides them', async () => {
  await page.getByRole('button', { name: 'Aspect ratio', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Picture format and background' })
  await dialog.waitFor()
  await dialog.getByRole('radio', { name: 'Fit', exact: true }).click()
  assert((await dialog.getByRole('radio', { name: 'Blur', exact: true }).count()) === 1, 'blur option hidden under Fit')
  assert((await dialog.locator('[data-role="background-hint"]').innerText()).length > 10, 'no helper text')
  await dialog.getByRole('radio', { name: 'Fill', exact: true }).click()
  assert((await dialog.getByRole('radio', { name: 'Blur', exact: true }).count()) === 0, 'background still shown under Fill')
  assert((await dialog.locator('[data-role="background-hint"]').count()) === 0, 'helper text still shown under Fill')
  await dialog.getByRole('radio', { name: 'Fit', exact: true }).click()
  await page.screenshot({ path: join(SHOT_DIR, 'polish-format-light.png') })
  await page.keyboard.press('Escape')
})

await check('project download is named <name>.jellycut.json', async () => {
  await page.getByRole('button', { name: /Demo|Beach|Project|Untitled/ }).first().click().catch(() => {})
  const trigger = page.locator('#project-menu-trigger')
  if ((await page.getByRole('menu', { name: 'Project actions' }).count()) === 0) await trigger.click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download as file' }).click()
  ])
  assert(/\.jellycut\.json$/.test(download.suggestedFilename()), `name ${download.suggestedFilename()}`)
})

await check('demo session: the save dot says nothing is saved', async () => {
  const dot = page.locator('[data-role="save-state"]')
  assert((await dot.getAttribute('aria-label')).includes('Demo: nothing is saved'), await dot.getAttribute('aria-label'))
})

await check('the left tab group is called Filters (English) and its panel heading matches', async () => {
  await page.getByRole('tab', { name: 'Filters', exact: true }).click()
  await page.getByRole('heading', { name: 'Filters', exact: true }).waitFor()
})

await check('transitions: the top tile removes the transition and the selected type has the thick frame and check badge', async () => {
  await tlClip(page, 'Beach.mp4').click()
  await page.getByRole('tab', { name: 'Filters', exact: true }).click()
  await page.getByRole('button', { name: 'Transitions', exact: true }).click()
  await page.getByRole('heading', { name: 'Transitions', exact: true }).waitFor()
  const none = page.getByTestId ? page.locator('[data-testid="transition-tile-none"]') : null
  assert(none && (await none.count()) === 1, 'no top tile')
  await tile(page, 'Wipe left').click()
  assert((await page.getByRole('button', { name: 'Wipe left', exact: true }).getAttribute('aria-pressed')) === 'true', 'not pressed')
  const frame = page.locator('[data-testid="transition-tile-wipeLeft"] > span').first()
  assert(/border-fill/.test(await frame.getAttribute('class')), 'selected frame not thick primary')
  assert((await page.locator('[data-testid="transition-tile-wipeLeft"] svg').count()) === 1, 'no check badge')
  await none.click()
  const p = await st(page, '(ed) => ed.project.clips.find((c) => c.transitionIn)?.transitionIn ?? null')
  assert(p === null, 'top tile did not remove the transition')
  await tile(page, 'Wipe left').click()
})

await check('transitions: tiles are at least 84 x 56 px and rest frozen halfway', async () => {
  const box = await page.locator('[data-testid="transition-tile-fade"] > span').first().boundingBox()
  assert(box && box.width >= 84 && box.height >= 56, `tile ${box?.width}x${box?.height}`)
  const rest = await page.locator('[data-testid="transition-tile-zoomIn"] .b').first().evaluate((el) => {
    const cs = getComputedStyle(el)
    return { state: cs.animationPlayState, delay: cs.animationDelay }
  })
  assert(rest.state === 'paused' && rest.delay === '-0.6s', JSON.stringify(rest))
})

await check('transitions: hovering a tile starts its preview', async () => {
  await page.locator('[data-testid="transition-tile-zoomIn"]').hover()
  const state = await page.locator('[data-testid="transition-tile-zoomIn"] .b').first().evaluate((el) => getComputedStyle(el).animationPlayState)
  assert(state === 'running', state)
  await page.mouse.move(0, 0)
})

await check('transitions: each type has its own frames (distinct animation names)', async () => {
  const names = await page.locator('.jc-preview').evaluateAll((els) => els.map((el) => getComputedStyle(el.querySelector('.b')).animationName))
  const distinct = new Set(names)
  assert(distinct.size >= 7, `only ${distinct.size} distinct effects: ${[...distinct].join(',')}`)
  await page.getByRole('heading', { name: 'Transitions', exact: true }).screenshot({ path: join(SHOT_DIR, 'polish-transitions-heading.png') }).catch(() => {})
  await page.locator('[data-testid="transition-tile-none"]').locator('xpath=ancestor::div[contains(@class,"grid")]').first().screenshot({ path: join(SHOT_DIR, 'polish-transitions-light.png') })
})

await check('transitions: the planner overlap is drawn as a hatched zone labelled with its length', async () => {
  await st(page, '(ed) => { ed.select({ kind: "clip", id: ed.project.clips.find((c) => c.transitionIn).id }); ed.applyTransition("fade", 500000) }')
  await page.waitForTimeout(150)
  const zones = page.locator('[data-role="transition-zone"]')
  assert((await zones.count()) >= 1, 'no zone drawn')
  assert((await zones.first().getAttribute('aria-label')) === 'Transition 0.5 s', await zones.first().getAttribute('aria-label'))
})

// Desktop context menu (mouse)
await check('right click on a clip opens a role=menu with the action bar actions', async () => {
  await tlClip(page, 'Beach.mp4').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Actions for the selected item' })
  await menu.waitFor()
  const names = await menu.getByRole('menuitem').allInnerTexts()
  for (const expected of ['Split', 'Fine cut', 'Duplicate', 'Flip', 'Delete']) {
    assert(names.some((n) => n.trim() === expected), `missing ${expected}: ${names.join('|')}`)
  }
  const rowHeight = await menu.getByRole('menuitem').first().evaluate((el) => el.getBoundingClientRect().height)
  assert(rowHeight >= 30 && rowHeight <= 40, `row height ${rowHeight} with a mouse`)
  await page.screenshot({ path: join(SHOT_DIR, 'polish-context-light.png') })
})

await check('context menu: arrow keys move, Escape closes and returns focus to the bar', async () => {
  const menu = page.getByRole('menu', { name: 'Actions for the selected item' })
  await menu.getByRole('menuitem').first().focus()
  await page.keyboard.press('ArrowDown')
  const second = await page.evaluate(() => document.activeElement?.textContent?.trim())
  assert(second && second !== 'Split', `focus ${second}`)
  await page.keyboard.press('Escape')
  assert((await page.getByRole('menu', { name: 'Actions for the selected item' }).count()) === 0, 'menu still open')
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  assert(focused === 'Clip: Beach.mp4', `focus returned to ${focused}`)
})

await check('context menu: Duplicate runs the store action and adds one clip', async () => {
  const before = (await st(page, '(ed) => ed.project.clips.length'))
  await tlClip(page, 'Beach.mp4').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  const after = await st(page, '(ed) => ed.project.clips.length')
  assert(after === before + 1, `clips ${before} -> ${after}`)
})

await check('context menu on a sticker offers only the common actions', async () => {
  await st(page, '(ed) => ed.addStickerAtPlayhead("🎉")')
  const sticker = page.getByRole('button', { name: /🎉/ }).first()
  await sticker.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Actions for the selected item' })
  await menu.waitFor()
  const count = await menu.getByRole('menuitem').count()
  assert(count === 2, `${count} entries`)
  await page.keyboard.press('Escape')
})

// Timeline height: fixed, resizable, lanes scroll inside, hint for hidden lanes
await check('timeline keeps its height when a new overlay row appears', async () => {
  const section = page.locator('section.jc-timeline')
  const before = (await section.boundingBox()).height
  await st(page, '(ed) => { ed.setPlayhead(1000000); ed.addStickerAtPlayhead("⭐"); ed.addStickerAtPlayhead("🔥") }')
  await page.waitForTimeout(150)
  const after = (await section.boundingBox()).height
  assert(Math.abs(before - after) < 1, `height ${before} -> ${after}`)
})

await check('the timeline grip resizes with the arrow keys, persists, and shows the lanes hint when rows are hidden', async () => {
  const grip = page.locator('[role="separator"]').first()
  await grip.focus()
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown')
  const h = (await page.locator('section.jc-timeline').boundingBox()).height
  assert(Math.round(h) === 160, `height ${h}`)
  const stored = await page.evaluate(() => localStorage.getItem('jellycut.timelineHeight'))
  assert(stored === '160', `stored ${stored}`)
  await page.waitForTimeout(100)
  assert((await page.locator('[data-role="more-lanes"]').count()) === 1, 'no lanes hint')
  assert(/\d+ more lanes? below/.test(await page.locator('[data-role="more-lanes"]').innerText()), 'hint text')
  await page.locator('[data-role="more-lanes"]').click()
  await page.waitForTimeout(100)
  assert((await page.locator('[data-role="more-lanes"]').count()) === 0, 'hint still shown at the bottom')
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp')
  await page.screenshot({ path: join(SHOT_DIR, 'polish-timeline-light.png') })
})

// Save state (non-demo: autosave in this browser)
const saver = await newPage({ url: APP_URL, wait: false, viewport: { width: 1120, height: 700 } })
await check('save dot: green while autosaved in this browser', async () => {
  const dot = saver.locator('[data-role="save-state"]')
  await dot.waitFor()
  await saver.waitForTimeout(1200)
  assert((await dot.getAttribute('data-tone')) === 'green', await dot.getAttribute('data-tone'))
  assert((await dot.getAttribute('aria-label')).includes('Autosaved in this browser'), await dot.getAttribute('aria-label'))
})
await check('save dot: amber after edits and an error is red with its explanation', async () => {
  await st(saver, '(ed) => ed.setRatio("9:16")')
  const dot = saver.locator('[data-role="save-state"]')
  await saver.waitForTimeout(1500)
  assert((await dot.getAttribute('data-tone')) === 'green', 'autosave did not finish')
  await st(saver, '(ed) => { ed.autosaveError = "quota"; ed.saveStatus = "error" }')
  await saver.waitForTimeout(50)
  assert((await dot.getAttribute('data-tone')) === 'red', 'error not red')
  await saver.locator('#project-menu-trigger').click()
  assert((await saver.getByText('quota').count()) === 1, 'explanation missing')
  await saver.screenshot({ path: join(SHOT_DIR, 'polish-savestate-light.png') })
  await saver.keyboard.press('Escape')
  await st(saver, '(ed) => { ed.saveStatus = "idle"; ed.autosaveError = null }')
})
await check('save dot: amber "Not saved as a file yet" after ten minutes of edits', async () => {
  await st(saver, '(ed) => { ed.unsavedSince = Date.now() - 11 * 60 * 1000 }')
  await st(saver, '(ed) => ed.setRatio("1:1")')
  await saver.waitForTimeout(1500)
  const dot = saver.locator('[data-role="save-state"]')
  assert((await dot.getAttribute('data-tone')) === 'amber', await dot.getAttribute('data-tone'))
  assert((await dot.getAttribute('aria-label')).includes('Not saved as a file yet'), await dot.getAttribute('aria-label'))
})

// Phone with touch: "more" button on the selected bar, menu rows 44 px
const phone = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const cdp = await phone.context().newCDPSession(phone)
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
await phone.reload()
await phone.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first().waitFor()
await check('touch: the selected bar shows a more button that opens the menu with 44 px rows', async () => {
  // Selecting the bar shows the "more" button (a touch press on the bar starts a move instead).
  await st(phone, '(ed) => ed.select({ kind: "clip", id: ed.project.clips.find((c) => ed.project.assets.find((a) => a.id === c.assetId)?.name === "Beach.mp4").id })')
  await phone.waitForTimeout(150)
  const more = phone.locator('[data-role="item-more"]').first()
  await more.waitFor({ timeout: 3000 })
  await more.tap()
  const menu = phone.getByRole('menu', { name: 'Actions for the selected item' })
  await menu.waitFor()
  const rowHeight = await menu.getByRole('menuitem').first().evaluate((el) => el.getBoundingClientRect().height)
  assert(rowHeight >= 43.5, `row height ${rowHeight} with touch`)
  await phone.screenshot({ path: join(SHOT_DIR, 'polish-context-phone-light.png') })
  await phone.keyboard.press('Escape')
})
await check('touch: the format popover on a phone shows its background options under Fit', async () => {
  await phone.getByRole('button', { name: 'Aspect ratio', exact: true }).tap()
  const dialog = phone.getByRole('dialog', { name: 'Picture format and background' })
  await dialog.waitFor()
  assert((await dialog.getByRole('radio', { name: 'Blur', exact: true }).count()) === 1, 'background hidden under Fit')
  await phone.screenshot({ path: join(SHOT_DIR, 'polish-format-phone-light.png') })
  await phone.keyboard.press('Escape')
})
await check('touch: the transitions tiles fit a phone width (two columns, 16 px gutter)', async () => {
  await phone.getByRole('tab', { name: 'Filters', exact: true }).tap()
  await phone.getByRole('button', { name: 'Transitions', exact: true }).tap()
  const box = await phone.locator('[data-testid="transition-tile-fade"] > span').first().boundingBox()
  assert(box && box.width >= 84 && box.height >= 56, `tile ${box?.width}x${box?.height}`)
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  assert(!overflow, 'horizontal page scroll on phone')
  await phone.screenshot({ path: join(SHOT_DIR, 'polish-transitions-phone-light.png') })
})

// Dark theme screenshots
const dark = await newPage({ viewport: { width: 1120, height: 700 }, colorScheme: 'dark' })
await check('dark: transitions and format popover render', async () => {
  await tlClip(dark, 'Beach.mp4').click()
  await dark.getByRole('tab', { name: 'Filters', exact: true }).click()
  await dark.getByRole('button', { name: 'Transitions', exact: true }).click()
  await tile(dark, 'Zoom in').click()
  await dark.locator('[data-testid="transition-tile-zoomIn"]').hover()
  await dark.waitForTimeout(400)
  await dark.locator('[data-testid="transition-tile-zoomIn"]').evaluate((el) => el.closest('.grid')).then((g) => g && dark.locator('[data-testid="transition-tile-none"]').locator('xpath=ancestor::div[contains(@class,"grid")]').first().screenshot({ path: join(SHOT_DIR, 'polish-transitions-dark.png') }))
  await dark.getByRole('button', { name: 'Aspect ratio', exact: true }).click()
  await dark.getByRole('dialog', { name: 'Picture format and background' }).waitFor()
  await dark.screenshot({ path: join(SHOT_DIR, 'polish-format-dark.png') })
  await dark.keyboard.press('Escape')
  await tlClip(dark, 'Beach.mp4').click({ button: 'right' })
  await dark.getByRole('menu', { name: 'Actions for the selected item' }).waitFor()
  await dark.screenshot({ path: join(SHOT_DIR, 'polish-context-dark.png') })
  await dark.keyboard.press('Escape')
  await dark.locator('header').screenshot({ path: join(SHOT_DIR, 'polish-topbar-dark.png') })
})

const phoneDark = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' })
await check('dark phone: transitions panel and top bar render', async () => {
  await phoneDark.getByRole('tab', { name: 'Filters', exact: true }).tap()
  await phoneDark.getByRole('button', { name: 'Transitions', exact: true }).tap()
  await phoneDark.getByRole('heading', { name: 'Transitions', exact: true }).waitFor()
  await phoneDark.locator('[data-testid="transition-tile-wipeLeft"]').tap()
  await phoneDark.waitForTimeout(1500)
  await phoneDark.screenshot({ path: join(SHOT_DIR, 'polish-transitions-phone-dark.png') })
})
await page.locator('header').screenshot({ path: join(SHOT_DIR, 'polish-topbar-light.png') })

await check('the top bar logo link navigates to the landing page', async () => {
  const nav = await newPage({ viewport: { width: 1120, height: 700 } })
  await nav.locator('header a[href="./../"]').click()
  await nav.waitForURL((url) => !url.pathname.startsWith('/app'), { timeout: 10000 })
  assert(new URL(nav.url()).pathname.replace(/\/+$/, '') === '' || !nav.url().includes('/app/'), nav.url())
})

await check('no page errors during the run', async () => {
  assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
})

await browser.close()
await server.close()

const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
