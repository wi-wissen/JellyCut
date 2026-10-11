// Real-browser check of the rule "overlays, texts and music end with the video": a new sticker near the end ends
// at the end, a drag past the end stops flush, deleting the last clip moves the items to the new end, and undo
// brings the lengths back. Music: an imported file ends at the video end, a drag past the end stops flush, a trim
// past the end stops there, and deleting the last clip shortens it. Uses the demo project (its video ends at
// 30 s). Usage: node scripts/e2e-fitend.mjs (exit code 1 when a check fails). Port 5380.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5380
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

/** Music state as the store sees it, in seconds. */
const musicState = () =>
  st(`(ed) => ({
    end: ed.videoEndMicros / 1e6,
    music: ed.project.music.map((m) => ({ id: m.id, asset: m.assetId, start: m.start / 1e6, length: (m.srcOut - m.srcIn) / 1e6, end: (m.start + m.srcOut - m.srcIn) / 1e6 })),
    assets: ed.project.assets.map((a) => ({ id: a.id, name: a.name, duration: a.duration / 1e6 }))
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

// --- 6. imported music is cut at the video end (placed at 27 s; music.webm is 5 s, so it plays 3 s) ---
await st(`(ed) => ed.setPlayhead(27 * 1e6)`)
await page.locator('input[type=file]').first().setInputFiles([join(root, 'tests/fixtures', 'music.webm')])
await page.getByRole('button', { name: 'Audio', exact: true }).click()
await page.getByRole('button', { name: /^Add music\.webm to the timeline/ }).waitFor({ timeout: 20000 })
await page.getByRole('button', { name: /^Add music\.webm to the timeline/ }).click()
await settle(300)
const m6 = await musicState()
const musicAsset = m6.assets.find((a) => a.name === 'music.webm')
const imported = m6.music.find((m) => m.asset === musicAsset?.id)
const expectedLength = Math.min(musicAsset?.duration ?? 0, 3)
check('import music at 27 s: it is cut to the video end (30 s) and keeps the first 3 s of the file', !!imported && close(imported.start, 27) && close(imported.end, 30) && close(imported.length, expectedLength), JSON.stringify(imported))
const L = imported ? imported.length : 0
console.log(`INFO music.webm is ${musicAsset?.duration.toFixed(2)} s; the imported item plays ${L.toFixed(2)} s`)
check('import music: the item is shorter than its file (it was cut by the video end)', !!musicAsset && L < musicAsset.duration - 1e-3, `${L} of ${musicAsset?.duration}`)

/** The music bar that starts nearest to `seconds`, scrolled into view (the music lane is at the bottom). */
const musicBar = async (seconds) => {
  const pps = await pxPerSecond()
  const index = await page.evaluate((x) => {
    const bars = [...document.querySelectorAll('[data-lane="music"] [data-kind="music"]')]
    let best = 0
    bars.forEach((el, i) => {
      if (Math.abs(parseFloat(el.style.left) - x) < Math.abs(parseFloat(bars[best].style.left) - x)) best = i
    })
    return best
  }, seconds * pps)
  const bar = page.locator('[data-lane="music"] [data-kind="music"]').nth(index)
  await bar.scrollIntoViewIfNeeded()
  return bar
}

// --- 7. drag the imported music past the end: it stops flush and keeps its length ---
const pps6 = await pxPerSecond()
await dragBy(await musicBar(imported.start), 8 * pps6)
await settle(200)
const m7 = await musicState()
const dragMusic = m7.music.find((m) => m.id === imported.id)
check('drag past the end: the music stops flush at 30 s and keeps its length', !!dragMusic && close(dragMusic.end, 30) && close(dragMusic.length, L), JSON.stringify(dragMusic))
const musicEndLine = await page.locator('[data-role="video-end"]').boundingBox()
const musicBox = await (await musicBar(dragMusic.start)).boundingBox()
check('the music bar ends at the video end marker', !!musicEndLine && !!musicBox && musicBox.x + musicBox.width <= musicEndLine.x + 2, `${JSON.stringify(musicBox)} vs ${JSON.stringify(musicEndLine)}`)

// --- 8. trim the music end past the end: it does not grow beyond the video or the file ---
await (await musicBar(dragMusic.start)).click()
const musicHandle = (await musicBar(dragMusic.start)).locator('[data-handle="end"]')
if ((await musicHandle.count()) > 0) {
  await dragBy(musicHandle, 200)
  await settle(200)
  const m8 = await musicState()
  const trimmedMusic = m8.music.find((m) => m.id === imported.id)
  check('trim the music end past the end: the length stays and the music still ends at 30 s', !!trimmedMusic && close(trimmedMusic.length, L) && close(trimmedMusic.end, 30), JSON.stringify(trimmedMusic))
} else {
  check('trim handle of the music is shown when selected', false, 'no end handle')
}

// --- 9. delete the last clip: the music follows the new end, the demo bed too, and nothing is deleted ---
const beforeDelete = await musicState()
await page.locator('[data-lane="video"] [data-kind="video"] button').nth(2).click()
await page.keyboard.press('Delete')
await settle(300)
const m9 = await musicState()
const followed = m9.music.find((m) => m.id === imported.id)
const bed = m9.music.find((m) => m.id === 'music-1')
check('delete the last clip: the music ends at the new video end (20 s), keeping its length', close(m9.end, 20) && !!followed && close(followed.end, 20) && close(followed.length, L), JSON.stringify(followed))
check('delete the last clip: the demo music bed is cut to 20 s and not deleted', !!bed && close(bed.end, 20) && close(bed.length, 20), JSON.stringify(bed))
check('delete the last clip: no music item is removed', m9.music.length === beforeDelete.music.length, `${m9.music.length} vs ${beforeDelete.music.length}`)

// --- 10. undo: the music returns to its length and end ---
await page.getByRole('button', { name: 'Undo', exact: true }).first().click()
await settle(300)
const m10 = await musicState()
const back = m10.music.find((m) => m.id === imported.id)
check('undo: the imported music ends at 30 s again with its length', close(m10.end, 30) && !!back && close(back.end, 30) && close(back.length, L), JSON.stringify(back))
check('undo: the demo music bed is back to 30 s', close(m10.music.find((m) => m.id === 'music-1')?.end ?? 0, 30))

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
await server.close()
console.log(failed === 0 ? 'e2e-fitend: all checks passed' : `e2e-fitend: ${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
