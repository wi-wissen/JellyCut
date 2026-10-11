// End-to-end check of the speed dialog and the mute label in a real Chromium: presets and own speed (0.1x to
// 100x), validation messages, Enter, Escape, focus trap and focus return, one undo step, the sound note above 4x,
// the context menu "Mute" / "Unmute" label, and screenshots (desktop and phone, light and dark).
// Usage: E2E_PORT=5350 node scripts/e2e-speedmodal.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 5350)
const APP_URL = `http://localhost:${PORT}/app/?demo=1`
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

/** Runs code against the editor store (getters and actions included). */
const editor = (page, expr) =>
  page.evaluate((code) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const ed = pinia._s.get('editor')
    return new Function('ed', `return (${code})(ed)`)(ed)
  }, expr)
const beachClip = '(ed) => ed.project.clips.find((c) => ed.project.assets.find((a) => a.id === c.assetId).name === "Beach.mp4")'
const clipSpeed = (page) => editor(page, `(ed) => (${beachClip})(ed).speed`)
const clipMuted = (page) => editor(page, `(ed) => (${beachClip})(ed).muted`)

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
mkdirSync(SHOT_DIR, { recursive: true })

const pageErrors = []

async function openEditor({ scheme = 'light', viewport = { width: 1120, height: 700 } } = {}) {
  const context = await browser.newContext({ locale: 'en-US', viewport, colorScheme: scheme })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(APP_URL)
  await page.locator('[data-lane="video"] button', { hasText: 'Beach.mp4' }).first().waitFor({ timeout: 20000 })
  return { page, context }
}

const beachBar = (page) => page.locator('[data-lane="video"] button', { hasText: 'Beach.mp4' }).first()
const speedButton = (page) => page.getByRole('button', { name: /^Speed:/ })
const dialog = (page) => page.getByRole('dialog', { name: 'Change tempo' })
const input = (page) => page.locator('#speed-custom-input')

async function openDialog(page) {
  await beachBar(page).click()
  await speedButton(page).click()
  await dialog(page).waitFor()
}

// ---------- functional checks, desktop light ----------
{
  const { page, context } = await openEditor({ scheme: 'light' })

  await check('Speed opens a modal dialog with the input focused and nothing prefilled', async () => {
    await openDialog(page)
    assert((await dialog(page).getAttribute('aria-modal')) === 'true', 'aria-modal missing')
    assert((await input(page).inputValue()) === '', 'input is prefilled')
    assert((await input(page).getAttribute('placeholder')) === 'e.g. 20', `placeholder ${await input(page).getAttribute('placeholder')}`)
    assert((await page.evaluate(() => document.activeElement?.id)) === 'speed-custom-input', 'input not focused')
  })

  await check('seven quick choice chips, each at least 44 px high, normal speed pressed', async () => {
    const chips = dialog(page).locator('[data-speed]')
    assert((await chips.count()) === 7, `chips ${await chips.count()}`)
    const texts = await chips.allTextContents()
    assert(texts.join(' ') === '0.25x 0.5x 0.75x 1x 1.5x 2x 4x', texts.join(' '))
    for (let i = 0; i < 7; i++) {
      const box = await chips.nth(i).boundingBox()
      assert(box && box.height >= 44, `chip ${i} height ${box?.height}`)
    }
    assert((await dialog(page).locator('[data-speed="1"]').getAttribute('aria-pressed')) === 'true', '1x not pressed')
  })

  await check('the modal screenshot (desktop, light)', async () => {
    await page.screenshot({ path: join(SHOT_DIR, 'ux3-speed-modal-desktop-light.png') })
  })

  await check('101 is refused with the range message; speed unchanged', async () => {
    await input(page).fill('101')
    await input(page).press('Enter')
    assert((await dialog(page).count()) === 1, 'dialog closed on an invalid value')
    const alert = await dialog(page).getByRole('alert').textContent()
    assert(alert.includes('0.1') && alert.includes('100'), `alert "${alert}"`)
    assert((await clipSpeed(page)) === 1, 'speed changed')
  })

  await check('0.05 is out of range and "fast" is not a number', async () => {
    await input(page).fill('0.05')
    assert((await dialog(page).getByRole('alert').textContent()).includes('0.1'), 'range message for 0.05')
    await input(page).fill('fast')
    assert((await dialog(page).getByRole('alert').textContent()).includes('number only'), 'invalid message for fast')
  })

  await check('20 applies on Enter, closes, and one undo step restores 1x', async () => {
    await input(page).fill('20')
    await input(page).press('Enter')
    await dialog(page).waitFor({ state: 'detached' })
    assert((await clipSpeed(page)) === 20, `speed ${await clipSpeed(page)}`)
    assert((await speedButton(page).textContent()).includes('20'), 'action bar does not show 20')
    await page.keyboard.press('Control+z')
    assert((await clipSpeed(page)) === 1, `undo speed ${await clipSpeed(page)}`)
  })

  await check('focus returns to the Speed button after the dialog closes', async () => {
    await openDialog(page)
    await page.keyboard.press('Escape')
    await dialog(page).waitFor({ state: 'detached' })
    assert((await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).startsWith('Speed:'), 'focus not back on Speed')
  })

  await check('boundaries 0.1 and 100 are accepted; 4.5 shows the no-sound note', async () => {
    await openDialog(page)
    await input(page).fill('0.1')
    await input(page).press('Enter')
    await dialog(page).waitFor({ state: 'detached' })
    assert((await clipSpeed(page)) === 0.1, `0.1 -> ${await clipSpeed(page)}`)
    await openDialog(page)
    await input(page).fill('100')
    await input(page).press('Enter')
    await dialog(page).waitFor({ state: 'detached' })
    assert((await clipSpeed(page)) === 100, `100 -> ${await clipSpeed(page)}`)
    await openDialog(page)
    await input(page).fill('4,5')
    assert((await dialog(page).locator('[data-role="speed-silent"]').count()) === 1, 'no sound note above 4x')
    await input(page).fill('4')
    assert((await dialog(page).locator('[data-role="speed-silent"]').count()) === 0, 'sound note at exactly 4x')
    await page.keyboard.press('Escape')
    await dialog(page).waitFor({ state: 'detached' })
    assert((await clipSpeed(page)) === 100, 'Escape changed the speed')
  })

  await check('Tab stays inside the dialog', async () => {
    await openDialog(page)
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
      assert(inside, `focus left the dialog after ${i + 1} Tab presses`)
    }
    await page.keyboard.press('Escape')
    await dialog(page).waitFor({ state: 'detached' })
  })

  await check('a quick choice applies at once and closes the dialog', async () => {
    await openDialog(page)
    await dialog(page).locator('[data-speed="2"]').click()
    await dialog(page).waitFor({ state: 'detached' })
    assert((await clipSpeed(page)) === 2, `speed ${await clipSpeed(page)}`)
  })

  await check('the item menu says "Mute" and, once the clip is muted, "Unmute"', async () => {
    await beachBar(page).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await menu.waitFor()
    assert((await menu.getByRole('menuitem', { name: 'Mute', exact: true }).count()) === 1, 'no Mute entry')
    await menu.getByRole('menuitem', { name: 'Mute', exact: true }).click()
    assert((await clipMuted(page)) === true, 'clip not muted')
    await beachBar(page).click({ button: 'right' })
    const again = page.getByRole('menu')
    await again.waitFor()
    assert((await again.getByRole('menuitem', { name: 'Unmute', exact: true }).count()) === 1, 'no Unmute entry')
    assert((await again.getByRole('menuitem', { name: 'Mute', exact: true }).count()) === 0, 'Mute still shown while muted')
    await page.screenshot({ path: join(SHOT_DIR, 'ux3-menu-muted-desktop-light.png') })
    await page.keyboard.press('Escape')
  })

  await check('the action bar mute button shows "Unmute" while the clip is muted', async () => {
    await beachBar(page).click()
    const bar = page.locator('.jc-actionbar')
    assert((await bar.getByRole('button', { name: 'Unmute', exact: true }).count()) === 1, 'no Unmute button in the action bar')
    await bar.getByRole('button', { name: 'Unmute', exact: true }).click()
    assert((await clipMuted(page)) === false, 'clip still muted')
    assert((await bar.getByRole('button', { name: 'Mute', exact: true }).count()) === 1, 'Mute label not back')
  })

  await context.close()
}

// ---------- screenshots: light and dark, desktop and phone ----------
for (const scheme of ['light', 'dark']) {
  for (const [label, viewport] of [
    ['desktop', { width: 1120, height: 700 }],
    ['phone', { width: 390, height: 844 }]
  ]) {
    await check(`screenshots: modal and muted menu (${label}, ${scheme})`, async () => {
      const { page, context } = await openEditor({ scheme, viewport })
      await openDialog(page)
      await input(page).fill('abc')
      await page.screenshot({ path: join(SHOT_DIR, `ux3-speed-modal-${label}-${scheme}.png`) })
      await page.keyboard.press('Escape')
      await dialog(page).waitFor({ state: 'detached' })
      await beachBar(page).click()
      await editor(page, '(ed) => ed.toggleMuteSelected()')
      await beachBar(page).click({ button: 'right' })
      await page.getByRole('menu').waitFor()
      await page.screenshot({ path: join(SHOT_DIR, `ux3-menu-muted-${label}-${scheme}.png`) })
      await context.close()
    })
  }
}

await check('no page errors were thrown', async () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '))
})

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
