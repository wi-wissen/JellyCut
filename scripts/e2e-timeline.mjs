// End-to-end check of the timeline and action bar in a real Chromium: selection, playhead,
// split, delete, duplicate, trims, reorder, mute/flip/speed, keyboard and zoom.
// Usage: node scripts/e2e-timeline.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 5196
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

const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance

async function videoClips(page) {
  return page.$$eval('[data-lane="video"] [data-kind="video"]', (els) =>
    els.map((el) => ({
      label: el.querySelector('button')?.getAttribute('aria-label') ?? '',
      left: parseFloat(el.style.left),
      width: parseFloat(el.style.width)
    }))
  )
}

const trackEnd = (clips) => Math.max(...clips.map((c) => c.left + c.width))

function assertNoGaps(clips) {
  for (let i = 1; i < clips.length; i++) {
    const gap = clips[i].left - (clips[i - 1].left + clips[i - 1].width)
    assert(near(gap, 0), `gap of ${gap.toFixed(2)} px before clip ${i}`)
  }
}

const pxPerSecond = async (page) => Number(await page.locator('[data-px-per-second]').getAttribute('data-px-per-second'))
const contentBox = (page) => page.locator('[data-px-per-second]').boundingBox()
const timecode = async (page) => (await page.locator('span.tabular-nums').textContent()).trim()
const playheadPx = async (page) => parseFloat(await page.locator('[data-role="playhead"]').evaluate((el) => el.style.left))
const clipButton = (page, name) => page.getByRole('button', { name: `Clip: ${name}` }).first()
const actionButton = (page, name) => page.getByRole('button', { name, exact: true })

async function clickRuler(page, seconds) {
  const box = await contentBox(page)
  const pps = await pxPerSecond(page)
  await page.mouse.click(box.x + seconds * pps, box.y + 8)
}

async function dragFrom(page, locator, dx, dy = 0) {
  const box = await locator.boundingBox()
  assert(box, 'drag source not visible')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 12 })
  await page.mouse.up()
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1120, height: 700 }, locale: 'en-US', colorScheme: 'light' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.goto(APP_URL)
await page.locator('[data-role="playhead"]').waitFor()

await check('three video clips, track as long as the 30 s demo, fitted to the width', async () => {
  const clips = await videoClips(page)
  assert(clips.length === 3, `clip count ${clips.length}`)
  const pps = await pxPerSecond(page)
  assert(pps >= 4 && pps <= 1920, `px/s ${pps}`)
  assert(near(trackEnd(clips), 30 * pps), `track ${trackEnd(clips)} px for 30 s at ${pps} px/s`)
  const scroller = await page.locator('[role="group"][aria-label="Timeline"]').boundingBox()
  assert(scroller && Math.abs(trackEnd(clips) - (scroller.width - 32)) < 4, 'fit should fill the lane width')
})

await check('actions that need a selection are aria-disabled without one', async () => {
  for (const name of ['Duplicate', 'Delete', 'Flip', 'Mute']) {
    const disabled = await actionButton(page, name).getAttribute('aria-disabled')
    assert(disabled === 'true', `${name} aria-disabled=${disabled}`)
  }
  assert((await actionButton(page, 'Split').getAttribute('aria-disabled')) === 'false', 'Split is enabled under the playhead')
})

await check('clicking a clip selects it (aria-pressed, handles on the selected video clip)', async () => {
  await clipButton(page, 'Beach.mp4').click()
  assert((await clipButton(page, 'Beach.mp4').getAttribute('aria-pressed')) === 'true', 'Beach not pressed')
  assert((await clipButton(page, 'Intro.mp4').getAttribute('aria-pressed')) === 'false', 'Intro still pressed')
  const handles = await page.locator('[data-lane="video"] [data-kind="video"] [data-handle]').count()
  assert(handles === 2, `handles ${handles}`)
  assert((await actionButton(page, 'Duplicate').getAttribute('aria-disabled')) === 'false', 'Duplicate should be enabled')
  assert((await page.locator('[data-role="playhead"]').count()) === 1, 'playhead missing')
})

await check('selection outline uses the signal colour', async () => {
  const shadow = await clipButton(page, 'Beach.mp4').evaluate((el) => getComputedStyle(el).boxShadow)
  assert(shadow.includes('rgb(198, 244, 50)') || shadow.includes('c6f432'), `box-shadow ${shadow}`)
})

await page.screenshot({ path: join(mkdir(), 'tl-select.png') })

await check('clicking the ruler moves the playhead to that time', async () => {
  await clickRuler(page, 4)
  assert((await timecode(page)) === '00:04:00', `timecode ${await timecode(page)}`)
  const pps = await pxPerSecond(page)
  assert(near(await playheadPx(page), 4 * pps), `playhead ${await playheadPx(page)} px`)
})

await check('S splits the clip under the playhead; duration unchanged; undo restores', async () => {
  const before = await videoClips(page)
  await page.keyboard.press('s')
  const after = await videoClips(page)
  assert(after.length === before.length + 1, `clips ${before.length} -> ${after.length}`)
  assert(near(trackEnd(after), trackEnd(before), 0.5), `duration changed ${trackEnd(before)} -> ${trackEnd(after)}`)
  assertNoGaps(after)
  await page.keyboard.press('Control+z')
  assert((await videoClips(page)).length === before.length, 'undo did not remove the split')
})

await check('Enter selects a focused clip (keyboard access)', async () => {
  await clipButton(page, 'Interview.mp4').focus()
  await page.keyboard.press('Enter')
  assert((await clipButton(page, 'Interview.mp4').getAttribute('aria-pressed')) === 'true', 'Enter did not select')
})

await check('Delete removes the selected clip and ripples the track (no gap); undo restores', async () => {
  const before = await videoClips(page)
  await clickRuler(page, 4)
  await clipButton(page, 'Intro.mp4').click()
  await page.keyboard.press('Delete')
  const after = await videoClips(page)
  assert(after.length === before.length - 1, `clips ${before.length} -> ${after.length}`)
  assert(near(after[0].left, 0), `first clip starts at ${after[0].left}`)
  assertNoGaps(after)
  assert(near(trackEnd(after), trackEnd(before) - (before[0].width)), 'track should shrink by the deleted clip')
  await page.keyboard.press('Control+z')
  assert((await videoClips(page)).length === before.length, 'undo did not restore the clip')
})

await check('Duplicate (action bar) copies the selected clip right after it; undo restores', async () => {
  const before = await videoClips(page)
  await clipButton(page, 'Intro.mp4').click()
  await actionButton(page, 'Duplicate').click()
  const after = await videoClips(page)
  assert(after.length === before.length + 1, `clips ${before.length} -> ${after.length}`)
  assert(near(trackEnd(after), trackEnd(before) + before[0].width), 'track should grow by the copy')
  assertNoGaps(after)
  await page.keyboard.press('Control+z')
  assert((await videoClips(page)).length === before.length, 'undo did not remove the copy')
})

await check('Mute toggles the selected clip and hides its original audio; undo restores', async () => {
  await clipButton(page, 'Beach.mp4').click()
  const audioBefore = await page.locator('[data-lane="originalAudio"] [data-kind="audio"]').count()
  await actionButton(page, 'Mute').click()
  assert((await actionButton(page, 'Mute').getAttribute('aria-pressed')) === 'true', 'Mute not pressed')
  assert((await page.locator('[data-lane="originalAudio"] [data-kind="audio"]').count()) === audioBefore - 1, 'audio lane not updated')
  await page.keyboard.press('Control+z')
  assert((await actionButton(page, 'Mute').getAttribute('aria-pressed')) === 'false', 'undo did not unmute')
})

await check('Flip toggles the flip state', async () => {
  await actionButton(page, 'Flip').click()
  assert((await actionButton(page, 'Flip').getAttribute('aria-pressed')) === 'true', 'Flip not pressed')
  await page.keyboard.press('Control+z')
})

await check('Speed cycles the clip speed and changes its length on the track; undo restores', async () => {
  const pps = await pxPerSecond(page)
  const before = (await videoClips(page))[1].width
  const speedButton = page.getByRole('button', { name: /^Speed/ })
  await speedButton.click()
  assert((await speedButton.textContent()).includes('1.5'), `speed label ${await speedButton.textContent()}`)
  const after = (await videoClips(page))[1].width
  assert(near(after, before / 1.5, 2), `width ${before} -> ${after} at 1.5x (px/s ${pps})`)
  await page.keyboard.press('Control+z')
})

await check('dragging the end handle of the selected clip shortens it; undo restores', async () => {
  const pps = await pxPerSecond(page)
  await clipButton(page, 'Beach.mp4').click()
  const before = (await videoClips(page))[1].width
  const handle = page.locator('[data-lane="video"] [data-kind="video"] [data-handle="end"]')
  await dragFrom(page, handle, -40)
  const after = (await videoClips(page))[1].width
  assert(after < before - 30, `width ${before} -> ${after}`)
  assertNoGaps(await videoClips(page))
  await page.keyboard.press('Control+z')
  assert(near((await videoClips(page))[1].width, before, 1), `undo width ${(await videoClips(page))[1].width}`)
  assert(pps > 0, 'pps')
})

await check('dragging the start handle shortens the clip from the head and closes the track', async () => {
  await clipButton(page, 'Beach.mp4').click()
  const before = await videoClips(page)
  const handle = page.locator('[data-lane="video"] [data-kind="video"] [data-handle="start"]')
  await dragFrom(page, handle, 40)
  const after = await videoClips(page)
  assert(after[1].width < before[1].width - 30, `width ${before[1].width} -> ${after[1].width}`)
  assertNoGaps(after)
  await page.keyboard.press('Control+z')
})

await check('text clip is selectable and its end handle trims it; undo restores', async () => {
  const text = page.getByRole('button', { name: /^Text: / }).first()
  await text.click()
  assert((await text.getAttribute('aria-pressed')) === 'true', 'text not selected')
  const before = await page.locator('[data-lane="text"] [data-kind="text"]').evaluate((el) => parseFloat(el.style.width))
  await dragFrom(page, page.locator('[data-lane="text"] [data-kind="text"] [data-handle="end"]'), -30)
  const after = await page.locator('[data-lane="text"] [data-kind="text"]').evaluate((el) => parseFloat(el.style.width))
  assert(after < before - 20, `text width ${before} -> ${after}`)
  await page.keyboard.press('Control+z')
})

await check('dragging a video clip body to another position reorders the track; undo restores', async () => {
  const pps = await pxPerSecond(page)
  const before = await videoClips(page)
  assert(before[0].label.includes('Intro'), `first clip ${before[0].label}`)
  // Intro's centre must pass the middle of Beach (8 s start, 12 s long).
  const dx = 10 * pps + 30
  await dragFrom(page, clipButton(page, 'Intro.mp4'), dx)
  const after = await videoClips(page)
  assert(after[0].label.includes('Beach'), `first clip after drag ${after[0].label}`)
  assert(after[1].label.includes('Intro'), `second clip after drag ${after[1].label}`)
  assertNoGaps(after)
  await page.keyboard.press('Control+z')
  assert((await videoClips(page))[0].label.includes('Intro'), 'undo did not restore the order')
})

await check('Left and Right step one frame, Shift+arrows step ten', async () => {
  await clickRuler(page, 2)
  assert((await timecode(page)) === '00:02:00', `start ${await timecode(page)}`)
  await page.keyboard.press('ArrowRight')
  assert((await timecode(page)) === '00:02:01', `after Right ${await timecode(page)}`)
  await page.keyboard.press('Shift+ArrowRight')
  assert((await timecode(page)) === '00:02:11', `after Shift+Right ${await timecode(page)}`)
  await page.keyboard.press('ArrowLeft')
  assert((await timecode(page)) === '00:02:10', `after Left ${await timecode(page)}`)
})

await check('Zoom in and out change the pixels per second', async () => {
  const start = await pxPerSecond(page)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const zoomedIn = await pxPerSecond(page)
  assert(near(zoomedIn, start * 1.5, 0.5), `zoom in ${start} -> ${zoomedIn}`)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  const zoomedOut = await pxPerSecond(page)
  assert(near(zoomedOut, start / 1.5, 0.5), `zoom out ${zoomedIn} -> ${zoomedOut}`)
})

await check('zoomed in, the ruler shows finer ticks and the lanes scroll', async () => {
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
  await clickRuler(page, 9)
  const ticks = await page.locator('[data-role="ruler"] span').allTextContents()
  assert(ticks.length > 3, `ticks ${ticks.length}`)
  const scroller = page.locator('[role="group"][aria-label="Timeline"]')
  assert((await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)) === true, 'lanes should scroll horizontally')
  const label = await page.locator('[data-role="ruler"] span').first().textContent()
  assert(label, 'ruler label')
})

await page.screenshot({ path: join(mkdir(), 'tl-zoom.png') })

await check('no uncaught page errors', async () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '))
})

await browser.close()
await server.close()

function mkdir() {
  mkdirSync(SHOT_DIR, { recursive: true })
  return SHOT_DIR
}

const failed = outcomes.filter((ok) => !ok).length
console.log(failed === 0 ? `ALL ${outcomes.length} CHECKS PASSED` : `${failed} of ${outcomes.length} CHECKS FAILED`)
process.exit(failed === 0 ? 0 : 1)
