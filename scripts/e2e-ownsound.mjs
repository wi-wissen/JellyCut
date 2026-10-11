// End-to-end check of own sound (a recording added to the timeline) in a real Chromium with fake devices:
// record with the fake microphone, add it to the timeline, drag it along the timeline (mouse, then a touch
// long press), trim its end, split it at the playhead, mute it from the item menu, and undo each step.
// Usage: E2E_PORT=5350 node scripts/e2e-ownsound.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 5350)
const APP_URL = `http://localhost:${PORT}/app/`
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
    return new Function('ed', `return (${code})(ed)`)(pinia._s.get('editor'))
  }, expr)
const music = (page) => editor(page, '(ed) => JSON.parse(JSON.stringify(ed.project.music.filter((m) => m.assetId !== "asset-music")))')
const ownSound = async (page) => (await music(page))[0]

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'
  ]
})
mkdirSync(SHOT_DIR, { recursive: true })
const pageErrors = []

async function freshPage(options = {}) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1120, height: 700 }, ...options })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(APP_URL)
  await page.getByRole('button', { name: 'Record', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('heading', { name: 'Record', exact: true }).waitFor()
  return { page, context }
}

const lane = (page) => page.locator('[data-lane="music"]')
const bar = (page) => lane(page).locator('button').first()

/** Records two seconds from the fake microphone and adds the result to the timeline. */
async function recordAndAdd(page) {
  await page.getByRole('button', { name: /^Microphone/ }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
  await new Promise((r) => setTimeout(r, 2000))
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).click()
  await bar(page).waitFor({ timeout: 5000 })
}

/** Drags the bar's centre to the right with the mouse, in steps, like a real drag. */
async function mouseDrag(page, dx) {
  const box = await bar(page).boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y)
  await page.mouse.up()
}

let recordedStart = 0

{
  const { page, context } = await freshPage()

  await check('the recording is added as own sound on the music lane', async () => {
    await recordAndAdd(page)
    const item = await ownSound(page)
    assert(item, 'no own sound item in the project')
    recordedStart = item.start
    assert((await bar(page).getAttribute('aria-label')).startsWith('Added audio'), 'bar label')
  })

  await check('the own sound bar is draggable with the mouse: its start changes', async () => {
    await bar(page).click()
    await mouseDrag(page, 140)
    const after = await ownSound(page)
    assert(after.start > recordedStart, `start ${after.start} not after ${recordedStart}`)
  })

  await check('one undo step puts the own sound back where it was', async () => {
    const moved = (await ownSound(page)).start
    await page.keyboard.press('Control+z')
    assert((await ownSound(page)).start === recordedStart, `undo start ${(await ownSound(page)).start}`)
    await page.keyboard.press('Control+y')
    assert((await ownSound(page)).start === moved, 'redo did not restore the moved start')
    await page.keyboard.press('Control+z')
  })

  await check('the end handle trims the own sound and undo restores it', async () => {
    await bar(page).click()
    const before = await ownSound(page)
    const handle = bar(page).locator('xpath=..').locator('[data-handle="end"]')
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 - (60 * i) / 6, box.y + box.height / 2)
    await page.mouse.up()
    const after = await ownSound(page)
    assert(after.srcOut < before.srcOut, `srcOut ${after.srcOut} not shorter than ${before.srcOut}`)
    assert(after.start === before.start, 'trimming the end moved the start')
    await page.keyboard.press('Control+z')
    assert((await ownSound(page)).srcOut === before.srcOut, 'undo did not restore the end')
  })

  await check('the item menu offers Split, Duplicate, Mute and Delete for own sound', async () => {
    await bar(page).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await menu.waitFor()
    for (const name of ['Split', 'Duplicate', 'Mute', 'Delete']) {
      assert((await menu.getByRole('menuitem', { name, exact: true }).count()) === 1, `no ${name}`)
    }
    await page.keyboard.press('Escape')
  })

  await check('Mute from the menu silences the own sound and the label changes to Unmute', async () => {
    await bar(page).click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: 'Mute', exact: true }).click()
    assert((await ownSound(page)).muted === true, 'not muted')
    await bar(page).click({ button: 'right' })
    const menu = page.getByRole('menu')
    assert((await menu.getByRole('menuitem', { name: 'Unmute', exact: true }).count()) === 1, 'no Unmute')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+z')
    assert((await ownSound(page)).muted !== true, 'undo did not unmute')
  })

  await check('split at the playhead cuts the own sound in two parts; undo joins them', async () => {
    const item = await ownSound(page)
    await editor(page, `(ed) => ed.setPlayhead(${item.start + Math.round((item.srcOut - item.srcIn) / 2)})`)
    await bar(page).click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: 'Split', exact: true }).click()
    assert((await music(page)).length === 2, `parts ${(await music(page)).length}`)
    await page.keyboard.press('Control+z')
    assert((await music(page)).length === 1, 'undo did not join the parts')
  })

  await page.screenshot({ path: join(SHOT_DIR, 'ownsound-desktop.png') })
  await context.close()
}

await check('a touch long press lifts the own sound and carries it along the timeline', async () => {
  const { page, context } = await freshPage({ hasTouch: true, viewport: { width: 1120, height: 700 } })
  await recordAndAdd(page)
  const before = (await ownSound(page)).start
  // The music lane sits at the bottom of the timeline; bring it into view before pressing.
  await bar(page).scrollIntoViewIfNeeded()
  const box = await bar(page).boundingBox()
  const cdp = await context.newCDPSession(page)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  await new Promise((r) => setTimeout(r, 600))
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (120 * i) / 10, y, id: 1 }] })
    await new Promise((r) => setTimeout(r, 16))
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const after = (await ownSound(page)).start
  assert(after > before, `touch start ${after} not after ${before}`)
  await context.close()
})

await check('no page errors were thrown', async () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '))
})

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
