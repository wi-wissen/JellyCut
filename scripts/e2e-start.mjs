// End-to-end check of the first start in a real Chromium: an empty project with the empty-state card,
// the browser-made example video (imported, thumbnailed, on the timeline, picture and playback), the
// export dialog, autosave across a reload, the ?demo=1 demo project, and the first import replacing
// the card. Writes light and dark screenshots of the empty state and of the editor.
// Usage: node scripts/e2e-start.mjs   (env SHOT_DIR overrides the screenshot folder)
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 5176
const APP_URL = `http://localhost:${PORT}/app/`
const SHOT_DIR =
  process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const FIXTURE = join(import.meta.dirname, '..', 'tests/fixtures/clip-a.webm')
const MISSING_TEXT = /missing|fehlt/i

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

/** Reads the Pinia stores of the running editor: the editor, the media and the example store. */
const stores = (page, fn) =>
  page.evaluate(`(() => {
    const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    return (${fn})(p._s.get('editor'), p._s.get('media'), p._s.get('exampleVideo'))
  })()`)

const videoAssets = (page) => stores(page, '(ed, me) => ed.project.assets.filter((a) => a.kind === "video").map((a) => ({ id: a.id, status: me.statusOf(a.id), thumb: Boolean(me.thumbnails[a.id]) }))')

async function waitUntil(fn, timeoutMs, label) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** Mean brightness (0..255) of the player picture, read from a screenshot of the canvas. */
async function pictureBrightness(page) {
  const buf = await page.getByRole('img', { name: 'Video preview' }).screenshot()
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const c = new OffscreenCanvas(32, 18)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0, 32, 18)
    const d = ctx.getImageData(0, 0, 32, 18).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3
    return sum / (32 * 18)
  }, buf.toString('base64'))
}

async function autosaveRecord(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        try {
          const req = indexedDB.open('jellycut', 1)
          req.onerror = () => resolve(null)
          req.onsuccess = () => {
            const db = req.result
            const get = db.transaction('kv', 'readonly').objectStore('kv').get('autosave')
            get.onsuccess = () => {
              db.close()
              resolve(get.result ?? null)
            }
            get.onerror = () => resolve(null)
          }
        } catch {
          resolve(null)
        }
      })
  )
}

const exampleButton = (page) => page.getByRole('button', { name: 'Create an example video', exact: true })

/** Opens the app and waits until the editor is mounted (the export button is part of the top bar). */
async function openApp(context, url = APP_URL) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url)
  await page.locator('#export-button').waitFor()
  return { page, errors }
}

async function createExample(page) {
  const seen = { creating: false, maxPercent: 0 }
  await exampleButton(page).click()
  await waitUntil(
    async () => {
      const s = await stores(page, '(ed, me, ex) => ({ status: ex.status, percent: ex.percent, ready: ed.project.clips.length, assets: ed.project.assets.length })')
      if (s.status === 'creating') seen.creating = true
      seen.maxPercent = Math.max(seen.maxPercent, s.percent ?? 0)
      if (s.status === 'failed') throw new Error('example creation failed')
      return s.status === 'idle' && s.ready === 2 && s.assets === 2
    },
    60_000,
    'the example video'
  )
  await waitUntil(async () => {
    const assets = await videoAssets(page)
    return assets.length === 2 && assets.every((a) => a.status === 'ready' && a.thumb)
  }, 30_000, 'thumbnails of both example assets')
  return seen
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
})
const shot = (name) => join(SHOT_DIR, name)

// 1) Light: first visit, empty state, example video, editor, playback, export dialog, reload.
const lightContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light', acceptDownloads: true })
const light = await openApp(lightContext)
const page = light.page

await check('first visit: empty card with both buttons, player hint, no dialog, nothing reported missing', async () => {
  await page.getByText('Start with a video', { exact: true }).waitFor()
  assert((await page.getByRole('button', { name: 'Add media', exact: true }).count()) === 1, 'Add media button missing')
  assert((await exampleButton(page).count()) === 1, 'example button missing')
  assert((await page.getByRole('dialog').count()) === 0, 'a dialog is open on first visit')
  assert((await page.getByRole('alert').count()) === 0, 'an alert is shown on first visit')
  assert((await page.getByText('No video yet').count()) === 1, 'player hint missing')
  assert((await page.getByText('Your files stay on this computer.').count()) === 1, 'files-stay sentence missing')
  const text = await page.evaluate(() => document.body.innerText)
  assert(!MISSING_TEXT.test(text), `"missing" text on first visit: ${text.match(MISSING_TEXT)?.[0]}`)
  assert((await page.locator('[data-lane="video"]').count()) >= 1, 'timeline lanes are not visible')
  assert((await stores(page, '(ed) => ed.project.assets.length + ed.project.clips.length')) === 0, 'start project is not empty')
})

await page.screenshot({ path: shot('start-empty-light.png') })

let progress = null
await check('example video: 2 assets with thumbnails, 2 clips, about 10 s, progress was shown', async () => {
  progress = await createExample(page)
  assert(progress.creating, 'the button never showed the creating state')
  const assets = await videoAssets(page)
  assert(assets.length === 2, `assets ${assets.length}`)
  const total = await stores(page, '(ed) => ed.totalDuration')
  assert(Math.abs(total - 10_000_000) <= 150_000, `duration ${total} micros`)
  console.log(`      progress reached ${progress.maxPercent} %`)
})

await check('empty card is gone once media exists', async () => {
  assert((await page.getByText('Start with a video', { exact: true }).count()) === 0, 'card still shown')
})

await check('the picture at the playhead is not black (frame 2 s)', async () => {
  await stores(page, '(ed) => ed.setPlayhead(2000000)')
  const brightness = await waitUntil(async () => {
    const b = await pictureBrightness(page)
    return b > 20 ? b : null
  }, 8000, 'a visible picture')
  console.log(`      mean brightness ${brightness.toFixed(1)} / 255`)
})

await check('playback advances the playhead, space pauses it', async () => {
  await page.evaluate(() => document.activeElement?.blur())
  await stores(page, '(ed) => ed.setPlayhead(0)')
  await page.keyboard.press('Space')
  await page.waitForTimeout(1500)
  const moving = await stores(page, '(ed) => ({ playing: ed.isPlaying, t: ed.playheadMicros })')
  await page.keyboard.press('Space')
  const paused = await stores(page, '(ed) => ({ playing: ed.isPlaying, t: ed.playheadMicros })')
  assert(moving.playing && moving.t > 800_000, `playhead ${JSON.stringify(moving)}`)
  assert(!paused.playing, 'space did not pause')
})

await page.screenshot({ path: shot('start-editor-light.png') })

await check('export dialog opens and closes', async () => {
  await page.locator('#export-button').click()
  await page.getByRole('dialog').getByText('Export video', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
})

await check('reload keeps the project (autosave); media shows as missing after a reload', async () => {
  await page.waitForTimeout(1500)
  await page.reload()
  await page.locator('#export-button').waitFor()
  const after = await stores(page, '(ed) => ({ clips: ed.project.clips.length, assets: ed.project.assets.length })')
  assert(after.clips === 2 && after.assets === 2, JSON.stringify(after))
  const assets = await videoAssets(page)
  assert(assets.every((a) => a.status === 'missing'), `statuses ${JSON.stringify(assets)}`)
  console.log(`      relink banner shown: ${(await page.getByRole('status').filter({ hasText: /file|Datei|Medi/i }).count()) > 0}`)
})

await check('no uncaught errors in the light session', async () => {
  assert(light.errors.length === 0, light.errors.join(' | '))
})
await lightContext.close()

// 2) Dark: the empty state and the editor with the example.
const darkContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'dark' })
const dark = await openApp(darkContext)
await check('dark: empty card visible', async () => {
  await dark.page.getByText('Start with a video', { exact: true }).waitFor()
  await dark.page.screenshot({ path: shot('start-empty-dark.png') })
})
await check('dark: example video created and shown', async () => {
  await createExample(dark.page)
  await dark.page.waitForTimeout(500)
  await dark.page.screenshot({ path: shot('start-editor-dark.png') })
})
await check('no uncaught errors in the dark session', async () => {
  assert(dark.errors.length === 0, dark.errors.join(' | '))
})
await darkContext.close()

// 3) ?demo=1 loads the demo project and never writes the autosave.
const demoContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' })
const demo = await openApp(demoContext, `${APP_URL}?demo=1`)
await check('?demo=1 loads the demo project (3 clips, 30 s) without the empty card', async () => {
  const s = await stores(demo.page, '(ed) => ({ name: ed.project.name, clips: ed.project.clips.length, total: ed.totalDuration })')
  assert(s.name === 'Summer trip' && s.clips === 3 && Math.abs(s.total - 30_000_000) < 1000, JSON.stringify(s))
  assert((await demo.page.getByText('Start with a video', { exact: true }).count()) === 0, 'card shown in demo')
})
await check('a demo session never writes the autosave', async () => {
  await stores(demo.page, '(ed) => ed.renameProject("Demo rename")')
  await demo.page.waitForTimeout(1500)
  assert((await autosaveRecord(demo.page)) === null, 'demo wrote an autosave record')
})
await check('no uncaught errors in the demo session', async () => {
  assert(demo.errors.length === 0, demo.errors.join(' | '))
})
await demoContext.close()

// 4) First import replaces the empty state.
const importContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' })
const imported = await openApp(importContext)
await check('the first import removes the empty state and adds the asset', async () => {
  await imported.page.getByText('Start with a video', { exact: true }).waitFor()
  await imported.page.locator('input[type=file][multiple]').first().setInputFiles(FIXTURE)
  await imported.page.getByText('Start with a video', { exact: true }).waitFor({ state: 'detached', timeout: 30_000 })
  const count = await stores(imported.page, '(ed) => ed.project.assets.length')
  assert(count === 1, `assets ${count}`)
  const text = await imported.page.evaluate(() => document.body.innerText)
  assert(!MISSING_TEXT.test(text), 'missing text after import')
})
await check('no uncaught errors in the import session', async () => {
  assert(imported.errors.length === 0, imported.errors.join(' | '))
})
await importContext.close()

await browser.close()
await server.close()

const failed = outcomes.filter((ok) => !ok).length
console.log(`\n${outcomes.length - failed} of ${outcomes.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
