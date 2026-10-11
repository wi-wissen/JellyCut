// End-to-end check of media import, the library panel and adding media to the timeline in a real Chromium.
// Usage: node scripts/e2e-import.mjs   (optional env SHOT_PATH=<png file> overrides the library screenshot path)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5191
const APP_URL = `http://localhost:${PORT}/app`
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'tests', 'fixtures')
const SHOT_PATH =
  process.env.SHOT_PATH ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad/library.png'
const workDir = mkdtempSync(join(tmpdir(), 'jellycut-import-'))

const MSG = {
  cannotDecode: 'This browser cannot read this file. Please use Chrome or Edge.',
  unsupportedFormat: 'This file type is not supported.',
  noMedia: 'This file has no picture or sound.',
  missing: 'File missing.'
}

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
    console.log(`FAIL ${name}: ${String(e.message).slice(0, 1500)}`)
  }
}

async function waitUntil(predicate, label, timeoutMs = 8000) {
  const start = Date.now()
  for (;;) {
    if (await predicate()) return
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 100))
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
const context = await browser.newContext({ viewport: { width: 1120, height: 700 }, locale: 'en-US', colorScheme: 'light' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('dialog', (d) => void d.accept())

await page.goto(APP_URL)
await page.locator('#project-menu-trigger').waitFor()

// Start from an empty project so the demo assets do not mix with the imports.
await page.locator('#project-menu-trigger').click()
await page.getByRole('menuitem', { name: 'New project' }).click()
if (await page.locator('#project-menu-panel').isVisible()) await page.keyboard.press('Escape')

const tile = (name) => page.locator('aside section').getByRole('button', { name })
// Audio files live in the Audio tab; video and images in Media.
const AUDIO_ONLY = new Set(['music.webm'])
const openFor = (name) => page.getByRole('button', { name: AUDIO_ONLY.has(name) ? 'Audio' : 'Media', exact: true }).click()
const tileText = async (name) => {
  await openFor(name)
  return (await tile(name).textContent()) ?? ''
}

/** Reads the editor and media stores through the mounted Vue app. */
function readState() {
  return page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__
    const pinia = app.config.globalProperties.$pinia.state.value
    const project = pinia.editor.history.present
    return {
      clips: project.clips.map((c) => ({ assetId: c.assetId, srcIn: c.srcIn, srcOut: c.srcOut, start: c.start })),
      music: project.music.map((m) => ({ assetId: m.assetId, srcOut: m.srcOut })),
      assets: project.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, duration: a.duration })),
      status: pinia.media.status
    }
  })
}

const assetId = async (name) => (await readState()).assets.find((a) => a.name === name)?.id

// Probe results and the formatting used by the tile, computed in the page.
const expected = await page.evaluate(async () => {
  const { probeFile } = await import('/src/engine/media/probe.ts')
  const load = async (name, type) => new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type })
  const format = (micros) => {
    const s = Math.round(micros / 1_000_000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  const out = {}
  for (const [name, type] of [['clip-a.webm', 'video/webm'], ['music.webm', 'audio/webm'], ['still.png', 'image/png'], ['clip-b-portrait.mp4', 'video/mp4'], ['frames.webm', 'video/webm']]) {
    const info = await probeFile(await load(name, type))
    out[name] = { duration: info.duration, label: info.kind === 'image' ? null : format(info.duration), problems: info.problems }
  }
  const avcSupported = await Promise.all(['avc1.42001f', 'avc1.4d401f', 'avc1.640028'].map((codec) =>
    VideoDecoder.isConfigSupported({ codec, codedWidth: 480, codedHeight: 640 }).then((r) => r.supported, () => false)
  ))
  out.h264Supported = avcSupported.some(Boolean)
  return out
})

// --- Library controls ---
await check('file input accepts several files of the supported types', async () => {
  const attrs = await page.locator('input[type=file]').evaluate((el) => ({ multiple: el.multiple, accept: el.accept }))
  assert(attrs.multiple, 'input must accept multiple files')
  for (const part of ['video/*', 'audio/*', 'image/*', '.mkv', '.mov']) {
    assert(attrs.accept.includes(part), `accept misses ${part}: ${attrs.accept}`)
  }
})

await check('the + tile opens the file chooser', async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add media' }).click()])
  assert(chooser, 'no file chooser')
})

// --- Import through the file input ---
const FIRST_BATCH = ['clip-a.webm', 'music.webm', 'still.png', 'clip-b-portrait.mp4']
await page.locator('input[type=file]').setInputFiles(FIRST_BATCH.map((n) => join(FIXTURES, n)))
for (const name of FIRST_BATCH) {
  await openFor(name)
  await tile(name).waitFor({ timeout: 15000 })
}

await check('tiles show the file names and the durations (m:ss)', async () => {
  for (const name of ['clip-a.webm', 'music.webm', 'clip-b-portrait.mp4']) {
    const text = await tileText(name)
    assert(text.includes(name), `${name} tile misses its name`)
    assert(text.includes(expected[name].label), `${name} tile misses duration ${expected[name].label}: "${text}"`)
  }
  assert(!(await tileText('still.png')).match(/\d:\d\d/), 'images must not show a duration')
})

await check('the h264 file shows the unsupported message exactly when this browser cannot decode it', async () => {
  const shown = (await tileText('clip-b-portrait.mp4')).includes(MSG.cannotDecode)
  const probeSaysNo = expected['clip-b-portrait.mp4'].problems.includes('cannot-decode-video')
  assert(shown === probeSaysNo, `message shown=${shown}, probe flags=${probeSaysNo}`)
  assert(shown === !expected.h264Supported, `message shown=${shown}, VideoDecoder supports h264=${expected.h264Supported}`)
  console.log(`INFO h264 in this browser: ${expected.h264Supported ? 'decodable' : 'not decodable'}`)
})

await check('thumbnails exist for the video and the image', async () => {
  for (const name of ['clip-a.webm', 'still.png']) {
    await openFor(name)
    await waitUntil(async () => ((await tile(name).locator('img').getAttribute('src')) ?? '').startsWith('data:image/'), `thumbnail of ${name}`, 15000)
  }
})

await page.waitForTimeout(300)
await page.screenshot({ path: SHOT_PATH })
console.log(`INFO library screenshot written to ${SHOT_PATH}`)

const before = await readState()
const idVideo = await assetId('clip-a.webm')
const idImage = await assetId('still.png')
const idMusic = await assetId('music.webm')

await check('clicking the video tile adds one clip (+1)', async () => {
  await openFor('clip-a.webm')
  await tile('clip-a.webm').click()
  await waitUntil(async () => (await readState()).clips.length === before.clips.length + 1, 'clip count')
  const added = (await readState()).clips.at(-1)
  assert(added.assetId === idVideo, 'the new clip must use the video asset')
  assert(added.srcOut === expected['clip-a.webm'].duration, `srcOut ${added.srcOut}`)
})

await check('clicking the image tile adds a 5 s clip', async () => {
  await openFor('still.png')
  await tile('still.png').click()
  await waitUntil(async () => (await readState()).clips.length === before.clips.length + 2, 'clip count')
  const added = (await readState()).clips.at(-1)
  assert(added.assetId === idImage, 'the new clip must use the image asset')
  assert(added.srcIn === 0 && added.srcOut === 5_000_000, `image clip ${added.srcIn}..${added.srcOut}`)
})

await check('clicking the audio tile adds one music item', async () => {
  await openFor('music.webm')
  await tile('music.webm').click()
  await waitUntil(async () => (await readState()).music.length === 1, 'music count')
  assert((await readState()).music[0].assetId === idMusic, 'music item must use the audio asset')
})

await check('clicking the unsupported tile adds nothing', async () => {
  if (!expected['clip-b-portrait.mp4'].problems.length) {
    console.log('INFO clip-b-portrait.mp4 is usable in this browser; check skipped')
    return
  }
  const clipsBefore = (await readState()).clips.length
  // Playwright would wait for an aria-disabled button; force the click so the no-op is really tested.
  await openFor('clip-b-portrait.mp4')
  await tile('clip-b-portrait.mp4').click({ force: true })
  await page.waitForTimeout(200)
  assert((await readState()).clips.length === clipsBefore, 'unsupported asset was added')
})

await check('Ctrl+Z removes the last addition only', async () => {
  await page.keyboard.press('Control+z')
  await waitUntil(async () => (await readState()).music.length === 0, 'undo of music')
  assert((await readState()).clips.length === before.clips.length + 2, 'undo must keep the clips')
})

// --- Drag and drop ---
await check('dragging files over the panel shows the drop highlight and dropping imports them', async () => {
  await page.evaluate(async () => {
    const blob = await (await fetch('/tests/fixtures/frames.webm')).blob()
    const file = new File([blob], 'frames.webm', { type: 'video/webm' })
    const data = new DataTransfer()
    data.items.add(file)
    const section = document.querySelector('aside section')
    section.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }))
    window.__dropData = data
  })
  await page.getByText('Drop files here to import them').waitFor({ timeout: 3000 })
  await page.evaluate(() => {
    const section = document.querySelector('aside section')
    section.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dropData, bubbles: true, cancelable: true }))
  })
  await openFor('frames.webm')
  await tile('frames.webm').waitFor({ timeout: 15000 })
  await waitUntil(async () => (await readState()).status[await assetId('frames.webm')] === 'ready', 'frames.webm ready')
  assert(!(await page.getByText('Drop files here to import them').isVisible()), 'highlight must go away after the drop')
})

// --- Garbage file ---
await check('a garbage file gives a friendly message and the app keeps working', async () => {
  const garbage = join(workDir, 'garbage.mp4')
  writeFileSync(garbage, randomBytes(4000))
  const clipsBefore = (await readState()).clips.length
  await page.locator('input[type=file]').setInputFiles(garbage)
  await openFor('garbage.mp4')
  await tile('garbage.mp4').waitFor({ timeout: 15000 })
  const text = await tileText('garbage.mp4')
  assert(text.includes(MSG.unsupportedFormat) || text.includes(MSG.noMedia), `no friendly message: "${text}"`)
  assert(!(await page.getByRole('alert').isVisible()), 'an unreadable file must not show the import error box')
  await openFor('clip-a.webm')
  await tile('clip-a.webm').click()
  await waitUntil(async () => (await readState()).clips.length === clipsBefore + 1, 'clip after garbage import')
})

// --- Autosave and reload ---
const beforeReload = await readState()
await page.waitForTimeout(1500)
await page.getByRole('img', { name: 'Autosave: saved' }).waitFor({ timeout: 8000 })
await page.reload()
await page.locator('#project-menu-trigger').waitFor()
// The re-link dialog opens once after a restore with missing media and would cover the tabs.
const relinkDialog = page.getByRole('dialog', { name: /Missing files|Dateien fehlen/ })
if (await relinkDialog.isVisible({ timeout: 3000 }).catch(() => false)) await page.keyboard.press('Escape')

await check('after a reload the assets are shown as missing with the re-link message', async () => {
  for (const name of ['clip-a.webm', 'music.webm', 'still.png', 'frames.webm']) {
    await openFor(name)
    await tile(name).waitFor({ timeout: 10000 })
    assert((await tileText(name)).includes(MSG.missing), `${name} misses the re-link message`)
  }
  const after = await readState()
  for (const [id, status] of Object.entries(after.status)) assert(status === 'missing', `${id} is ${status}`)
  assert(after.clips.length === beforeReload.clips.length, 'restored timeline must keep its clips')
  assert((await page.locator('aside section').getByRole('button', { name: /Add clip-a.webm to the timeline/ }).count()) === 0, 'missing tiles must not offer adding')
})

await check('no uncaught page errors', async () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '))
})

await context.close()
await browser.close()
await server.close()
rmSync(workDir, { recursive: true, force: true })

const failed = outcomes.filter((ok) => !ok).length
console.log(failed === 0 ? `ALL ${outcomes.length} CHECKS PASSED` : `${failed} of ${outcomes.length} CHECKS FAILED`)
process.exit(failed === 0 ? 0 : 1)
