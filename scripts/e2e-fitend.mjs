// Real-browser check of the rule "overlays and texts end with the video": a new sticker near the end ends at
// the end, a drag past the end stops flush, deleting the last clip moves the items to the new end, and undo
// brings the lengths back. Uses the demo project (its video ends at 30 s). Usage: node scripts/e2e-fitend.mjs
// (exit code 1 when a check fails). Port 5370.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5370
const VIEW = { width: 1440, height: 900 }
const S = 1_000_000

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error', root })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: VIEW, locale: 'en', colorScheme: 'light' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failed++
}
const settle = (ms = 300) => page.waitForTimeout(ms)

/** Runs fn(editor, arg) in the page and returns its value (the editor store is reached through Pinia). */
const st = (fn, arg = null) =>
  page.evaluate(
    ([src, a]) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = pinia._s.get('editor')
      return new Function('ed', 'a', `return (${src})(ed, a)`)(ed, a)
    },
    [fn, arg]
  )

/** Overlay items and the video end as the store sees them, in whole seconds. */
const state = () =>
  st(`(ed) => ({
    end: ed.videoEndMicros / 1e6,
    overlays: ed.project.overlays.map((o) => ({ id: o.id, start: o.start / 1e6, end: (o.start + o.duration) / 1e6 })),
    clips: ed.project.clips.map((c) => c.id)
  })`)

const pxPerSecond = () => page.evaluate(() => Number(document.querySelector('[data-px-per-second]').dataset.pxPerSecond))

/** The overlay bar that starts nearest to `seconds` (bars are found by position, not by DOM order). */
const overlayBar = async (seconds) => {
  const pps = await pxPerSecond()
  const index = await page.evaluate((x) => {
    const bars = [...document.querySelectorAll('[data-lane="overlay"] [data-kind="overlay"]')]
    let best = 0
    bars.forEach((el, i) => {
      if (Math.abs(parseFloat(el.style.left) - x) < Math.abs(parseFloat(bars[best].style.left) - x)) best = i
    })
    return best
  }, seconds * pps)
  return page.locator('[data-lane="overlay"] [data-kind="overlay"]').nth(index)
}

/** Pointer drag of a timeline element by dx pixels (the timeline captures the pointer, so it may leave the box). */
async function dragBy(locator, dx) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('drag source not visible')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
}

const close = (a, b) => Math.abs(a - b) < 1e-3

await page.goto(`http://localhost:${PORT}/app/?demo=1`)
await page.waitForSelector('header')
await settle(500)

// --- 1. a sticker added near the end ends at the end ---
await st(`(ed) => { ed.setPlayhead(29.8 * 1e6); ed.addStickerAtPlayhead('⭐') }`)
let s1 = await state()
let near = s1.overlays[s1.overlays.length - 1]
check('add near the end: the sticker starts at 29.5 s and ends at the video end (30 s)', !!near && close(near.start, 29.5) && close(near.end, 30), JSON.stringify(near))
check('the video end is 30 s', close(s1.end, 30), String(s1.end))

// --- 2. a sticker in the middle, dragged past the end: it stops flush at the end ---
await st(`(ed) => { ed.setPlayhead(24 * 1e6); ed.addStickerAtPlayhead('⭐') }`)
await settle(200)
let s2 = await state()
const dragged = s2.overlays[s2.overlays.length - 1]
const pps = await pxPerSecond()
await dragBy(await overlayBar(24), 7.5 * pps)
await settle(200)
s2 = await state()
const moved = s2.overlays.find((o) => o.id === dragged.id)
check('drag past the end: the sticker stops flush at 30 s, keeping its 3 s length', !!moved && close(moved.end, 30) && close(moved.end - moved.start, 3), JSON.stringify(moved))

// The bar must not reach past the end marker either.
const endLine = await page.locator('[data-role="video-end"]').boundingBox()
const bar = await (await overlayBar(27)).boundingBox()
check('the bar ends at the video end marker', !!endLine && !!bar && bar.x + bar.width <= endLine.x + 2, `${JSON.stringify(bar)} vs ${JSON.stringify(endLine)}`)

// --- 3. trim the end handle past the end: it stops at the end ---
const handle = (await overlayBar(27)).locator('[data-handle="end"]')
if ((await handle.count()) > 0) {
  await dragBy(handle, 200)
  await settle(200)
  const s3 = await state()
  const trimmed = s3.overlays.find((o) => o.id === dragged.id)
  check('trim the end past the end: the sticker still ends at 30 s', !!trimmed && close(trimmed.end, 30), JSON.stringify(trimmed))
} else {
  check('trim handle of an overlay is shown', false, 'no end handle')
}

// --- 4. delete the last clip: the items follow the new end ---
const before = await state()
await page.locator('[data-lane="video"] [data-kind="video"] button').nth(2).click()
await page.keyboard.press('Delete')
await settle(300)
const s4 = await state()
check('delete the last clip: the video end is 20 s', close(s4.end, 20) && s4.clips.length === before.clips.length - 1, `${s4.end} ${s4.clips.join(',')}`)
const far = s4.overlays.find((o) => o.id === dragged.id)
const nearAfter = s4.overlays.find((o) => o.id === near.id)
check('delete the last clip: the sticker from the end moves flush to 20 s', !!far && close(far.start, 17) && close(far.end, 20), JSON.stringify(far))
check('delete the last clip: a sticker at 29.5 s moves flush to 20 s', !!nearAfter && close(nearAfter.end, 20), JSON.stringify(nearAfter))

// --- 5. undo: the clip and the overlay lengths come back ---
await page.getByRole('button', { name: 'Undo', exact: true }).first().click()
await settle(300)
const s5 = await state()
const restored = s5.overlays.find((o) => o.id === dragged.id)
check('undo: the last clip is back and the video ends at 30 s', s5.clips.length === before.clips.length && close(s5.end, 30), `${s5.end}`)
check('undo: the sticker is back at its trimmed position (ends at 30 s)', !!restored && close(restored.end, 30) && close(restored.start, 27), JSON.stringify(restored))

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
await server.close()
console.log(failed === 0 ? 'e2e-fitend: all checks passed' : `e2e-fitend: ${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
