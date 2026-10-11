// End-to-end check of the context-sensitive left column and the player toolbar in a real Chromium:
// clip panel, transitions, text tab and text properties, ratio popover, fit/fill, music panel,
// one undo step per slider drag, and screenshots (light and dark) of the main panels.
// Usage: node scripts/e2e-panels.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 5189
const APP_URL = `http://localhost:${PORT}/app`
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

/** Pinia state of the editor store: the present project and the undo depth. */
const snapshot = (page) =>
  page.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const editor = pinia.state.value.editor
    return {
      project: JSON.parse(JSON.stringify(editor.history.present)),
      past: editor.history.past.length,
      selection: editor.selection ? { ...editor.selection } : null
    }
  })
const project = async (page) => (await snapshot(page)).project
const clipNamed = (proj, name) => {
  const asset = proj.assets.find((a) => a.name === name)
  return proj.clips.find((c) => c.assetId === asset?.id)
}
const tlClip = (page, name) => page.getByRole('button', { name: `Clip: ${name}`, exact: true }).first()
const undo = (page) => page.keyboard.press('Control+z')

/** Moves the thumb with the mouse from one fraction of the slider width to another (one drag). */
async function dragSlider(page, slider, fromFrac, toFrac) {
  // A real user scrolls the panel first; the clip and text panels scroll inside the left column.
  await slider.scrollIntoViewIfNeeded()
  const box = await slider.boundingBox()
  assert(box, 'slider not visible')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * fromFrac, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 10 })
  await page.mouse.up()
}

const near = (a, b, tol) => Math.abs(a - b) <= tol

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
mkdirSync(SHOT_DIR, { recursive: true })

const pageErrors = []
const newPage = async (options) => {
  const context = await browser.newContext({ locale: 'en-US', ...options })
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.goto(APP_URL)
  await page.getByRole('button', { name: 'Clip: Beach.mp4', exact: true }).first().waitFor()
  return page
}

// ---------- light theme: the full flow ----------
const page = await newPage({ viewport: { width: 1120, height: 700 }, colorScheme: 'light' })

await check('media tab shows the library by default, no properties panel', async () => {
  await page.getByRole('heading', { name: 'Media', exact: true }).waitFor()
  assert((await page.getByRole('button', { name: 'Back to library' }).count()) === 0, 'properties panel visible')
})

await check('selecting a video clip shows the clip panel with its header', async () => {
  await tlClip(page, 'Beach.mp4').click()
  await page.getByRole('heading', { name: 'Clip · Beach.mp4' }).waitFor()
  assert((await page.getByRole('heading', { name: 'Media', exact: true }).count()) === 0, 'library still shown')
  await page.screenshot({ path: join(SHOT_DIR, 'panel-clip-light.png') })
})

await check('back link returns to the library and clears the selection', async () => {
  await page.getByRole('button', { name: 'Back to library' }).click()
  await page.getByRole('heading', { name: 'Media', exact: true }).waitFor()
  assert((await snapshot(page)).selection === null, 'selection not cleared')
  await tlClip(page, 'Beach.mp4').click()
  await page.getByRole('heading', { name: 'Clip · Beach.mp4' }).waitFor()
})

await check('the clip panel has no per-clip Fit/Fill control (fit is project-wide)', async () => {
  assert((await page.getByRole('group', { name: 'Picture in format' }).count()) === 0, 'per-clip fit group still there')
  assert((await page.locator('aside').getByRole('button', { name: 'Fill', exact: true }).count()) === 0, 'Fill button in the clip panel')
})

await check('zoom drag lands in transform.scale and is one undo step', async () => {
  const before = await snapshot(page)
  await dragSlider(page, page.locator('aside').getByRole('slider', { name: 'Zoom' }), 0.5, 0.9)
  const after = await snapshot(page)
  const scale = clipNamed(after.project, 'Beach.mp4').transform.scale
  assert(scale > 2.5, `scale ${scale}`)
  assert(after.past - before.past === 1, `undo steps for one drag: ${after.past - before.past}`)
  await undo(page)
  assert(clipNamed(await project(page), 'Beach.mp4').transform.scale === 1, 'undo did not restore scale')
})

await check('volume drag lands in clip.volume and is one undo step', async () => {
  const before = await snapshot(page)
  await dragSlider(page, page.locator('aside').getByRole('slider', { name: 'Volume' }), 0.25, 0.4)
  const after = await snapshot(page)
  const volume = clipNamed(after.project, 'Beach.mp4').volume
  assert(near(volume, 0.8, 0.06), `volume ${volume}`)
  assert(after.past - before.past === 1, `undo steps for one drag: ${after.past - before.past}`)
  await undo(page)
  assert(clipNamed(await project(page), 'Beach.mp4').volume === 1, 'undo did not restore volume')
})

await check('"Original audio" switch mutes and unmutes the clip', async () => {
  const sw = page.getByRole('switch', { name: 'Original audio' })
  await sw.click()
  assert((await sw.getAttribute('aria-checked')) === 'false', 'switch still on')
  assert(clipNamed(await project(page), 'Beach.mp4').muted === true, 'not muted')
  await sw.click()
  assert((await sw.getAttribute('aria-checked')) === 'true', 'switch still off')
  assert(clipNamed(await project(page), 'Beach.mp4').muted === false, 'still muted')
})

await check('tempo slider steps over SPEED_STEPS and shows 1.5x', async () => {
  const slider = page.locator('aside').getByRole('slider', { name: 'Tempo' })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  assert(clipNamed(await project(page), 'Beach.mp4').speed === 1.5, `speed ${clipNamed(await project(page), 'Beach.mp4').speed}`)
  assert((await slider.getAttribute('aria-valuetext')) === '1.5x', `valuetext ${await slider.getAttribute('aria-valuetext')}`)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  assert(clipNamed(await project(page), 'Beach.mp4').speed === 1, 'speed not back to 1')
})

await check('first clip shows the no-cut hint and no transition button', async () => {
  await tlClip(page, 'Intro.mp4').click()
  await page.getByRole('heading', { name: 'Clip · Intro.mp4' }).waitFor()
  await page.getByText('The first clip has no cut before it.', { exact: false }).waitFor()
  assert((await page.getByRole('button', { name: 'Change', exact: true }).count()) === 0, 'change button on first clip')
})

await check('transitions: Wipe left on the second clip sets transitionIn', async () => {
  await tlClip(page, 'Beach.mp4').click()
  await page.getByRole('button', { name: 'Change', exact: true }).click()
  await page.getByRole('heading', { name: 'Transitions', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Wipe left', exact: true }).click()
  const beach = clipNamed(await project(page), 'Beach.mp4')
  assert(beach.transitionIn?.type === 'wipeLeft', `type ${beach.transitionIn?.type}`)
  assert(beach.transitionIn?.duration === 500_000, `duration ${beach.transitionIn?.duration}`)
  assert((await page.getByRole('button', { name: 'Wipe left', exact: true }).getAttribute('aria-pressed')) === 'true', 'tile not pressed')
})

await check('transitions: a selected first clip gets no transition (the target is a later clip)', async () => {
  await tlClip(page, 'Intro.mp4').click()
  await page.getByRole('heading', { name: 'Transitions', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Wipe right', exact: true }).click()
  const proj = await project(page)
  assert(clipNamed(proj, 'Intro.mp4').transitionIn === null, 'first clip got a transition')
  assert(clipNamed(proj, 'Beach.mp4').transitionIn?.type === 'wipeRight', 'target was not the next clip')
})

await page.getByRole('heading', { name: 'Transitions', exact: true }).waitFor()
await page.screenshot({ path: join(SHOT_DIR, 'panel-transitions-light.png') })

await page.getByRole('tab', { name: 'Material', exact: true }).click()
await check('record tab shows the record panel', async () => {
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: /^Microphone/ }).waitFor()
  await page.getByRole('button', { name: 'Media', exact: true }).click()
  await page.getByRole('heading', { name: 'Media', exact: true }).waitFor()
})

await page.getByRole('tab', { name: 'Design', exact: true }).click()
await check('text tab: Add text adds a text at the playhead and shows the text panel', async () => {
  const before = (await project(page)).texts.length
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.getByRole('button', { name: 'Add text', exact: true }).click()
  const proj = await project(page)
  assert(proj.texts.length === before + 1, `texts ${before} -> ${proj.texts.length}`)
  await page.getByRole('heading', { name: 'Text · "Text"' }).waitFor()
  await page.getByRole('button', { name: 'Text: Text', exact: true }).waitFor()
})

await check('typing in the content field updates the text; a typing burst is one undo step', async () => {
  const area = page.getByRole('textbox', { name: 'Content' })
  await area.fill('Hello')
  await page.keyboard.press('Tab')
  const before = await snapshot(page)
  await area.click()
  await page.keyboard.press('End')
  await page.keyboard.type('!!!', { delay: 30 })
  await page.keyboard.press('Tab')
  const after = await snapshot(page)
  assert(after.project.texts.at(-1).text === 'Hello!!!', `text ${after.project.texts.at(-1).text}`)
  assert(after.past - before.past === 1, `undo steps for one burst: ${after.past - before.past}`)
  await undo(page)
  assert((await project(page)).texts.at(-1).text === 'Hello', 'undo did not restore text')
  await page.getByRole('textbox', { name: 'Content' }).fill('Hello')
  await page.keyboard.press('Tab')
})

await check('font select changes style.font', async () => {
  await page.getByRole('combobox', { name: 'Font' }).selectOption('Pacifico')
  assert((await project(page)).texts.at(-1).style.font === 'Pacifico', 'font not changed')
})

await check('size drag changes style.size in one undo step', async () => {
  const before = await snapshot(page)
  await dragSlider(page, page.getByRole('slider', { name: 'Size' }), 0.3, 0.6)
  const after = await snapshot(page)
  const size = after.project.texts.at(-1).style.size
  assert(size > 100 && size < 300, `size ${size}`)
  assert(after.past - before.past === 1, `undo steps for one drag: ${after.past - before.past}`)
})

await check('colour swatch and outline switch', async () => {
  await page.getByRole('button', { name: 'Text colour #c6f432' }).click()
  assert((await project(page)).texts.at(-1).style.color === '#c6f432', 'colour not set')
  const sw = page.getByRole('switch', { name: 'Outline' })
  await sw.click()
  assert((await project(page)).texts.at(-1).style.outline === null, 'outline not removed')
  await sw.click()
  assert((await project(page)).texts.at(-1).style.outline === '#14121f', 'outline not restored')
})

await check('position: Bottom button and the vertical fine slider', async () => {
  await page.getByRole('button', { name: 'Bottom', exact: true }).click()
  assert((await project(page)).texts.at(-1).pos.y === 0.85, 'y not 0.85')
  assert((await page.getByRole('button', { name: 'Bottom', exact: true }).getAttribute('aria-pressed')) === 'true', 'not pressed')
  await page.getByRole('slider', { name: 'Vertical' }).focus()
  await page.keyboard.press('ArrowLeft')
  assert(near((await project(page)).texts.at(-1).pos.y, 0.84, 0.001), 'fine slider did not move')
})

await check('animation selects set animIn and animOut', async () => {
  await page.getByRole('combobox', { name: 'In', exact: true }).selectOption('pop')
  await page.getByRole('combobox', { name: 'Out', exact: true }).selectOption('slideUp')
  const t = (await project(page)).texts.at(-1)
  assert(t.animIn === 'pop' && t.animOut === 'slideUp', `anim ${t.animIn}/${t.animOut}`)
})

await check('start and duration fields take seconds in 0.1 steps', async () => {
  const start = page.getByRole('spinbutton', { name: 'Start (s)' })
  assert((await start.getAttribute('step')) === '0.1', 'step is not 0.1')
  await start.fill('1.5')
  await start.press('Tab')
  await page.getByRole('spinbutton', { name: 'Duration (s)' }).fill('2.5')
  await page.getByRole('spinbutton', { name: 'Duration (s)' }).press('Tab')
  const t = (await project(page)).texts.at(-1)
  assert(t.start === 1_500_000 && t.duration === 2_500_000, `start ${t.start} duration ${t.duration}`)
})

await page.getByRole('heading', { name: /^Text · / }).waitFor()
await page.screenshot({ path: join(SHOT_DIR, 'panel-text-light.png') })

await check('ratio popover: 9:16 sets 1080x1920; colour background is stored', async () => {
  await page.getByRole('button', { name: 'Aspect ratio', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Picture format and background' })
  await dialog.waitFor()
  await dialog.getByRole('radio', { name: /^9:16/ }).click()
  const format = (await project(page)).format
  assert(format.ratio === '9:16' && format.width === 1080 && format.height === 1920, `format ${JSON.stringify(format)}`)
  await dialog.getByRole('radio', { name: 'Colour', exact: true }).click()
  await dialog.getByLabel('Background colour').fill('#336699')
  const bg = (await project(page)).format.background
  assert(bg.type === 'color' && bg.color === '#336699', `background ${JSON.stringify(bg)}`)
  await page.screenshot({ path: join(SHOT_DIR, 'panel-ratio-light.png') })
})

await check('ratio popover: Escape closes it and returns focus to the chip', async () => {
  await page.keyboard.press('Escape')
  assert((await page.getByRole('dialog', { name: 'Picture format and background' }).count()) === 0, 'still open')
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  assert(focused === 'Aspect ratio', `focus on ${focused}`)
})

await check('ratio popover: an outside click closes it', async () => {
  await page.getByRole('button', { name: 'Aspect ratio', exact: true }).click()
  await page.getByRole('dialog', { name: 'Picture format and background' }).waitFor()
  await page.locator('h2').first().click()
  assert((await page.getByRole('dialog', { name: 'Picture format and background' }).count()) === 0, 'still open')
})

await check('picture fit switch sets Fill and Fit for every clip, whatever is selected', async () => {
  await page.getByRole('button', { name: 'Back to library' }).click()
  const chip = page.getByRole('button', { name: /^Picture fit, currently/ })
  await chip.click()
  await page.getByRole('radio', { name: 'Fill', exact: true }).click()
  await page.keyboard.press('Escape')
  let p = await project(page)
  assert(p.format.fit === 'fill' && p.clips.every((c) => c.transform.fit === 'fill'), `fits ${p.clips.map((c) => c.transform.fit)}`)
  await chip.click()
  await page.getByRole('radio', { name: 'Fit', exact: true }).click()
  await page.keyboard.press('Escape')
  p = await project(page)
  assert(p.format.fit === 'fit' && p.clips.every((c) => c.transform.fit === 'fit'), `fits ${p.clips.map((c) => c.transform.fit)}`)
})

await check('music: selecting a music item shows its panel; volume drag and fade-in change the item', async () => {
  await page.getByRole('tab', { name: 'Material', exact: true }).click()
  await page.getByRole('button', { name: 'Audio', exact: true }).click()
  await page.getByRole('button', { name: 'Added audio: Sunset loop.mp3', exact: true }).click()
  await page.getByRole('heading', { name: 'Own sound · Sunset loop.mp3' }).waitFor()
  const before = await snapshot(page)
  await dragSlider(page, page.getByRole('slider', { name: 'Volume' }), 0.2, 0.4)
  const after = await snapshot(page)
  assert(after.past - before.past === 1, `undo steps for one drag: ${after.past - before.past}`)
  assert(after.project.music[0].volume > 0.6 && after.project.music[0].volume <= 2, `volume ${after.project.music[0].volume}`)
  const fade = page.getByRole('slider', { name: 'Fade in' })
  await fade.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  assert((await project(page)).music[0].fadeIn === 300_000, `fadeIn ${(await project(page)).music[0].fadeIn}`)
  await page.getByRole('button', { name: 'Back to library' }).click()
})

await check('no uncaught page errors during the light flow', async () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '))
})

// ---------- dark theme: the four main panels ----------
const dark = await newPage({ viewport: { width: 1120, height: 700 }, colorScheme: 'dark' })
await check('dark: clip panel, text properties, transitions and ratio popover render', async () => {
  await tlClip(dark, 'Beach.mp4').click()
  await dark.getByRole('heading', { name: 'Clip · Beach.mp4' }).waitFor()
  await dark.screenshot({ path: join(SHOT_DIR, 'panel-clip-dark.png') })
  await dark.getByRole('button', { name: 'Change', exact: true }).click()
  await dark.getByRole('heading', { name: 'Transitions', exact: true }).waitFor()
  await dark.screenshot({ path: join(SHOT_DIR, 'panel-transitions-dark.png') })
  await dark.getByRole('tab', { name: 'Design', exact: true }).click()
  await dark.getByRole('button', { name: 'Text', exact: true }).click()
  await dark.getByRole('button', { name: 'Add text', exact: true }).click()
  await dark.getByRole('heading', { name: /^Text · / }).waitFor()
  await dark.screenshot({ path: join(SHOT_DIR, 'panel-text-dark.png') })
  await dark.getByRole('button', { name: 'Aspect ratio', exact: true }).click()
  await dark.getByRole('dialog', { name: 'Picture format and background' }).waitFor()
  await dark.screenshot({ path: join(SHOT_DIR, 'panel-ratio-dark.png') })
})

// ---------- narrow stage: the popover stays inside the stage ----------
const narrow = await newPage({ viewport: { width: 760, height: 640 }, colorScheme: 'light' })
await check('ratio popover stays inside the stage on a narrow window', async () => {
  await narrow.getByRole('button', { name: 'Aspect ratio', exact: true }).click()
  const dialog = narrow.getByRole('dialog', { name: 'Picture format and background' })
  await dialog.waitFor()
  const stage = await narrow.locator('section').filter({ has: narrow.locator('canvas[role="img"]') }).first().boundingBox()
  const box = await dialog.boundingBox()
  assert(stage && box, 'stage or popover not measurable')
  assert(box.x >= stage.x - 0.5, `left ${box.x} < stage ${stage.x}`)
  assert(box.x + box.width <= stage.x + stage.width + 0.5, `right ${box.x + box.width} > stage ${stage.x + stage.width}`)
  assert(box.y >= stage.y - 0.5 && box.y + box.height <= stage.y + stage.height + 0.5, 'popover leaves the stage vertically')
  await narrow.screenshot({ path: join(SHOT_DIR, 'panel-ratio-narrow.png') })
})

await browser.close()
await server.close()

const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
