// Fine cut overlay in a real browser: frame-exact stepping, keyframe and pause jumps, cut and undo, keyboard isolation, layout.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
mkdirSync(SHOTS, { recursive: true })

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: 5184, strictPort: true } })
await server.listen()
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
})

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' :: ' + detail}`)
  if (!ok) failed++
}
const FRAME_MS = 33_333
const FRAME_TOL = 1_500

async function openPage(options) {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))
  await page.goto('http://localhost:5184/app/')
  await page.waitForSelector('header')
  return { context, page, errors }
}

// Reads editor and fine cut store state. fn receives (editor, fineCut) and must return serialisable data.
const readState = (page, fn) =>
  page.evaluate(
    `(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; return (${fn})(p._s.get('editor'), p._s.get('fineCut'), p._s.get('media')) })()`
  )
const setPlayhead = (page, micros) => readState(page, `(ed) => ed.setPlayhead(${micros})`)

async function newProjectWith(page, fileName) {
  await page.locator('header button[aria-haspopup]').first().click()
  await page.getByRole('menuitem', { name: /New project|Neues Projekt/ }).click()
  await page.locator('input[type=file]').first().setInputFiles(join(root, 'tests/fixtures', fileName))
  await page.waitForFunction(
    (name) => {
      const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
      const ed = p._s.get('editor')
      const media = p._s.get('media')
      const asset = ed.project.assets.find((a) => a.name === name)
      return !!asset && media.status[asset.id] === 'ready'
    },
    fileName,
    { timeout: 20000 }
  )
  await page.getByRole('button', { name: new RegExp(fileName.replace('.', '\\.')) }).first().click()
  await page.waitForFunction(() => {
    const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    return p._s.get('editor').project.clips.length === 1
  })
}

/** Waits until every queued fine cut job has finished and the waveform is settled. */
async function settle(page, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const idle = await readState(page, `(ed, fc) => fc.pendingJobs === 0 && !fc.waveformLoading`)
    if (idle) return true
    await page.waitForTimeout(40)
  }
  return false
}

/**
 * Sampled pixels of each canvas: distinct opaque colours (capped at 50) and the share of pixels with alpha > 0.
 * A drawn image has several colours; a blank canvas has none.
 */
const canvasStats = (page, selector) =>
  page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((c) => {
      if (!c.width || !c.height) return { w: c.width, h: c.height, colours: 0, painted: 0 }
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const seen = new Set()
      let painted = 0
      let samples = 0
      const step = Math.max(1, Math.floor(data.length / 4 / 4000)) * 4
      for (let i = 0; i < data.length; i += step) {
        samples++
        if (data[i + 3] > 0) painted++
        if (data[i + 3] > 0 && seen.size < 50) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
      }
      return { w: c.width, h: c.height, colours: seen.size, painted: painted / samples }
    })
  }, selector)
const drawn = (s) => s.colours >= 2

const pressKey = async (page, key, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key)
    await page.waitForTimeout(15)
  }
}

const near = (a, b, tol) => Math.abs(a - b) <= tol
const extraErrors = []

// ---------- Desktop: scenarios a to k ----------
const desk = await openPage({ viewport: { width: 1280, height: 800 }, locale: 'en', colorScheme: 'light' })
const { page, errors } = desk
await newProjectWith(page, 'talk.webm')
await setPlayhead(page, 700_000)
await page.locator('#fine-cut-button').click()
const dialog = page.getByRole('dialog', { name: 'Fine cut' })
await dialog.waitFor({ state: 'visible', timeout: 5000 })
const loaded = await settle(page)
await page.waitForTimeout(400)

// (a) Layout content: two frames, waveform, one pause, keyframe tiles
const hintOnFirstOpen = await page.locator('[data-testid="fine-hint"]').count()
check('(a) the one-time hint is shown on the first open', hintOnFirstOpen === 1, String(hintOnFirstOpen))
const frames = await canvasStats(page, '[data-testid="fine-frame"]')
check('(a) both frame images are drawn (non-blank canvases)', frames.length === 2 && frames.every((f) => f.w > 0 && drawn(f)), JSON.stringify(frames))
const wave = await canvasStats(page, '[data-testid="fine-waveform"]')
check('(a) waveform canvas is drawn and not blank after loading', loaded && wave.length === 1 && wave[0].painted > 0.05, JSON.stringify({ loaded, wave }))
const pauses = await page.locator('[data-pause]').count()
check('(a) exactly one pause highlight is shown', pauses === 1, String(pauses))
const keyTiles = await page.locator('[data-testid="fine-tile"][data-key="true"]').count()
const tiles = await page.locator('[data-testid="fine-tile"]').count()
check('(a) the frame strip shows keyframe tiles', keyTiles >= 1 && tiles >= 16, `key=${keyTiles} tiles=${tiles}`)
const tileStats = await canvasStats(page, '[data-testid="fine-tile"] canvas')
check('(a) strip tiles are decoded into canvases', tileStats.filter(drawn).length >= 8, JSON.stringify(tileStats.slice(0, 4)))
await page.screenshot({ path: `${SHOTS}/finecut-desktop-light.png` })

const cutAt = () => readState(page, `(ed, fc) => fc.cutTime`)
const frameNo = () => readState(page, `(ed, fc) => fc.frameIndex`)
const t0 = await cutAt()
const f0 = await frameNo()
check('(a) the cut starts on the playhead (0.7 s)', near(t0, 700_000, 1_000), String(t0))
const snapSwitch = page.getByRole('switch', { name: /Snap to keyframes/ })
check('(e) snapping to keyframes is on by default', (await snapSwitch.getAttribute('aria-checked')) === 'true')

// (b) Frame steps. A single step with snap on: no keyframe within 3 frames of 0.733 s, so it is exact.
await page.locator('[role=dialog]').focus()
await pressKey(page, 'ArrowRight')
await settle(page)
const t1 = await cutAt()
const f1 = await frameNo()
check('(b) ArrowRight moves the cut by one source frame (33.3 ms)', near(t1 - t0, FRAME_MS, FRAME_TOL), `delta=${t1 - t0}`)
check('(b) ArrowRight increases the displayed source frame number by one', f1 === f0 + 1, `${f0} -> ${f1}`)
// Ten-frame steps are checked with snap off: a Shift step that crosses the keyframe at 1.0 s would be pulled onto it.
await snapSwitch.click()
await page.locator('[role=dialog]').focus()
await pressKey(page, 'Shift+ArrowRight')
await settle(page)
const t2 = await cutAt()
const f2 = await frameNo()
check('(b) Shift+ArrowRight moves ten frames', near(t2 - t1, 10 * FRAME_MS, 3_000) && f2 === f1 + 10, `delta=${t2 - t1} frames ${f1}->${f2}`)
await pressKey(page, 'ArrowLeft')
await settle(page)
const t3 = await cutAt()
check('(b) ArrowLeft steps back one frame', near(t2 - t3, FRAME_MS, FRAME_TOL) && near(t3 - t1, 9 * FRAME_MS, 3_000), `t1=${t1} t2=${t2} t3=${t3}`)
await pressKey(page, 'Shift+ArrowLeft')
await settle(page)
const back = await cutAt()
check('(b) Shift+ArrowLeft from one frame past the start returns to the start frame', back === t0, `start=${t0} now=${back}`)

// (c) Keyframe jumps (keyframes every 1 s in talk.webm)
await pressKey(page, 'k')
await settle(page)
const k1 = await cutAt()
check('(c) K jumps to the next keyframe at 1.0 s (+-3 ms)', near(k1, 1_000_000, 3_000), String(k1))
await page.keyboard.down('Shift')
await page.keyboard.press('K')
await page.keyboard.up('Shift')
await settle(page)
const k0 = await cutAt()
check('(c) Shift+K goes back to the keyframe at 0; the cut lands on the first cuttable frame (33 ms, edge rule)', near(k0, FRAME_MS, FRAME_TOL), `got ${k0}`)
await setPlayhead(page, 700_000)
await page.waitForTimeout(50)
// Keyboard focus remains inside the overlay; the cut is reset by stepping to the start frame.
await readState(page, `(ed, fc) => { fc.close(); ed.setPlayhead(700000); return true }`)
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
await page.locator('[role=dialog]').focus()

// (d) Pause jumps (snap is still off here)
await pressKey(page, 'p')
await settle(page)
const p1 = await cutAt()
check('(d) P jumps to the pause start at about 1.0 s', near(p1, 1_000_000, 40_000), String(p1))
await pressKey(page, 'p')
await settle(page)
const p2 = await cutAt()
check('(d) a second P stays where it is (no pause further on)', p2 === p1, `${p1} -> ${p2}`)
await page.keyboard.down('Shift')
await page.keyboard.press('P')
await page.keyboard.up('Shift')
await settle(page)
const p3 = await cutAt()
check('(d) Shift+P from the pause start stays (no earlier pause in talk.webm)', p3 === p1, `${p1} -> ${p3}`)

// (e) Snap to keyframes: on (default) stops on the keyframe, off passes it
await readState(page, `(ed, fc) => { fc.close(); ed.setPlayhead(700000); return true }`)
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
await page.locator('[role=dialog]').focus()
await snapSwitch.click()
check('(e) the snap switch is on again', (await snapSwitch.getAttribute('aria-checked')) === 'true')
await page.locator('[role=dialog]').focus()
let presses = 0
for (; presses < 10; presses++) {
  const now = await cutAt()
  if (now === 1_000_000) break
  await pressKey(page, 'ArrowRight')
  await settle(page)
}
const landed = await cutAt()
check('(e) with snap on, stepping towards the keyframe stops exactly on it', landed === 1_000_000, `landed=${landed} after ${presses + 1} presses`)
await pressKey(page, 'ArrowRight')
await settle(page)
const past = await cutAt()
check('(e) with snap on, the next step leaves the keyframe', past > 1_000_000 && past - 1_000_000 < 2 * FRAME_MS, String(past))
await snapSwitch.click()
const snapNow = await snapSwitch.getAttribute('aria-checked')
check('(e) the snap switch turns off', snapNow === 'false', snapNow)
await page.locator('[role=dialog]').focus()
await readState(page, `(ed, fc) => { fc.close(); ed.setPlayhead(700000); return true }`)
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
await page.locator('[role=dialog]').focus()
await pressKey(page, 'ArrowRight', 10)
await settle(page)
const passed = await cutAt()
check('(e) with snap off, ten steps from 0.7 s pass the keyframe at 1.0 s', near(passed, 700_000 + 10 * FRAME_MS, 3_000) && passed > 1_000_000, String(passed))
await snapSwitch.click()
check('(e) snap is back on for the remaining checks', (await snapSwitch.getAttribute('aria-checked')) === 'true')
await page.locator('[role=dialog]').focus()

// Focus trap: Tab never leaves the overlay
await page.locator('[role=dialog]').focus()
let trapOk = true
for (let i = 0; i < 30; i++) {
  await page.keyboard.press('Tab')
  if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) trapOk = false
}
check('(l) Tab stays inside the overlay (focus trap)', trapOk)
await page.keyboard.press('Shift+Tab')
await page.locator('[role=dialog]').focus()

// (i) Global shortcuts must not leak into the editor while the overlay is open
const clipsBefore = await readState(page, `(ed) => ed.project.clips.length`)
const pastBefore = await readState(page, `(ed) => ed.history.past.length`)
await page.keyboard.press('Space')
await page.waitForTimeout(300)
const playing = await readState(page, `(ed) => ed.isPlaying`)
check('(i) Space does not start playback while the overlay is open', playing === false)
await page.keyboard.press('Delete')
await page.waitForTimeout(100)
const clipsAfterDelete = await readState(page, `(ed) => ed.project.clips.length`)
check('(i) Delete does not delete the clip while the overlay is open', clipsAfterDelete === clipsBefore && clipsBefore === 1, `${clipsBefore} -> ${clipsAfterDelete}`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(100)
const pastAfterUndo = await readState(page, `(ed) => ed.history.past.length`)
check('(i) Ctrl+Z does not change the project while the overlay is open', pastAfterUndo === pastBefore, `${pastBefore} -> ${pastAfterUndo}`)

// (g) Escape closes without changes
const pastEsc = await readState(page, `(ed) => ed.history.past.length`)
await page.keyboard.press('Escape')
await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
const closedEsc = (await dialog.count()) === 0
const pastEscAfter = await readState(page, `(ed) => ed.history.past.length`)
check('(g) Escape closes the overlay and changes nothing', closedEsc && pastEsc === pastEscAfter && clipsAfterDelete === 1, `closed=${closedEsc}`)
const focusBack = await page.evaluate(() => document.activeElement?.id)
check('(g) focus returns to the Fine cut button', focusBack === 'fine-cut-button', String(focusBack))

// (f) Enter cuts: one undo step, two contiguous clips, playhead on the cut, overlay closed
await setPlayhead(page, 1_000_000)
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
await page.locator('[role=dialog]').focus()
await pressKey(page, 'ArrowRight', 3)
await settle(page)
const cutBefore = await cutAt()
await page.keyboard.press('Enter')
await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
await page.waitForTimeout(200)
const afterCut = await readState(page, `(ed) => ({ clips: ed.project.clips.map((c) => ({ id: c.id, start: c.start, end: c.start + Math.round((c.srcOut - c.srcIn) / c.speed), srcIn: c.srcIn, srcOut: c.srcOut })), playhead: ed.playheadMicros })`)
check('(f) Enter splits the clip into two clips', afterCut.clips.length === 2, JSON.stringify(afterCut.clips.length))
const [left, right] = afterCut.clips
check('(f) the two clips are contiguous', left && right && left.end === right.start, JSON.stringify(afterCut.clips))
check('(f) the split point equals the displayed cut time (+-1 us)', left && near(left.end, cutBefore, 1), `split=${left?.end} cut=${cutBefore}`)
check('(f) the playhead moved to the cut', near(afterCut.playhead, cutBefore, 1), String(afterCut.playhead))
check('(f) the overlay is closed', (await dialog.count()) === 0)
const focusAfterCut = await page.evaluate(() => document.activeElement?.id)
check('(f) focus returns to the Fine cut button after cutting', focusAfterCut === 'fine-cut-button', String(focusAfterCut))
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
const afterUndo = await readState(page, `(ed) => ed.project.clips.length`)
check('(f) one Ctrl+Z restores a single clip', afterUndo === 1, String(afterUndo))

// (m) Leaving: the big labelled back button, Escape, a click on empty space, the header's main action
await readState(page, `(ed, fc) => { fc.close(); ed.setPlayhead(300000); return true }`)
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
const backButton = page.locator('[data-testid="fine-back"]')
const backBox = await backButton.boundingBox()
const dialogBox = await dialog.boundingBox()
check('(m) the back button is labelled "Back to editor" and sits at the top left', (await backButton.innerText()).includes('Back to editor') && backBox.x - dialogBox.x < 120 && backBox.y - dialogBox.y < 80, JSON.stringify(backBox))
check('(m) the back button is large (48 px high or more)', backBox.height >= 47, String(backBox.height))
check('(m) there is no second "Done" exit', (await page.getByRole('button', { name: 'Done', exact: true }).count()) === 0)
check('(m) the header main action reads "Cut here" when a cut is possible', (await page.locator('[data-testid="fine-primary"]').innerText()).trim() === 'Cut here')
const clipsM = await readState(page, `(ed) => ed.project.clips.length`)
const pastM = await readState(page, `(ed) => ed.history.past.length`)
await page.mouse.click(dialogBox.x + 4, dialogBox.y + dialogBox.height - 4)
await page.waitForTimeout(150)
check('(m) a click on empty space outside the content changes nothing and keeps the view open', (await dialog.count()) === 1 && (await readState(page, `(ed) => ed.history.past.length`)) === pastM)
await page.keyboard.press('Escape')
await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
check('(m) Escape closes without a change', (await dialog.count()) === 0 && (await readState(page, `(ed) => ed.project.clips.length`)) === clipsM && (await readState(page, `(ed) => ed.history.past.length`)) === pastM)
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
await page.locator('[data-testid="fine-back"]').click()
await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
check('(m) the back button closes without a change', (await dialog.count()) === 0 && (await readState(page, `(ed) => ed.history.past.length`)) === pastM)
check('(m) closing puts the focus back on the Fine cut button', (await page.evaluate(() => document.activeElement?.id)) === 'fine-cut-button')

// (m2) The one-time hint: dismissed once, remembered in localStorage, not shown again.
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
check('(m2) the hint is still there before it is dismissed', (await page.locator('[data-testid="fine-hint"]').count()) === 1)
await page.getByRole('button', { name: 'Got it' }).click()
check('(m2) dismissing the hint removes it', (await page.locator('[data-testid="fine-hint"]').count()) === 0)
const stored = await page.evaluate(() => localStorage.getItem('jellycut.fineCut'))
check('(m2) the dismissal is stored in localStorage', stored !== null && JSON.parse(stored).hintSeen === true, String(stored))
await page.locator('[data-testid="fine-back"]').click()
await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
await page.locator('#fine-cut-button').click()
await dialog.waitFor({ state: 'visible' })
await settle(page)
check('(m2) the hint stays hidden on the next open', (await page.locator('[data-testid="fine-hint"]').count()) === 0)
await page.locator('[data-testid="fine-back"]').click()
await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)

// (j) Narrow layout at 390 x 800 is a separate page; (k) errors checked at the end
await desk.context.close()

const phone = await openPage({ viewport: { width: 390, height: 800 }, locale: 'en', colorScheme: 'light', isMobile: false })
await newProjectWith(phone.page, 'talk.webm')
await setPlayhead(phone.page, 700_000)
await phone.page.locator('#fine-cut-button').click()
await phone.page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'visible' })
await settle(phone.page)
await phone.page.waitForTimeout(400)
const layout = await phone.page.evaluate(() => {
  const d = document.querySelector('[role=dialog]')
  const pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
  const dialogOverflow = d.scrollWidth - d.clientWidth
  const buttons = [...d.querySelectorAll('button')].filter((b) => b.offsetParent !== null)
  const outside = buttons.filter((b) => {
    const r = b.getBoundingClientRect()
    return r.left < -0.5 || r.right > window.innerWidth + 0.5
  }).map((b) => b.textContent.trim())
  const small = buttons.filter((b) => b.getBoundingClientRect().height < 43.5 && b.textContent.trim()).map((b) => b.textContent.trim())
  return { pageOverflow, dialogOverflow, outside, small, count: buttons.length }
})
check('(j) at 390 px there is no horizontal page overflow', layout.pageOverflow <= 0 && layout.dialogOverflow <= 0, JSON.stringify(layout))
check('(j) all control buttons are inside the screen width', layout.outside.length === 0, layout.outside.join(', '))
check('(j) labelled buttons are at least 44 px high', layout.small.length === 0, layout.small.join(', '))
const shotDialog = await canvasStats(phone.page, '[data-testid="fine-frame"]')
check('(j) frames are drawn at phone width', shotDialog.length === 2 && shotDialog.every(drawn), JSON.stringify(shotDialog))
await phone.page.screenshot({ path: `${SHOTS}/finecut-phone-light.png` })
await phone.page.emulateMedia({ colorScheme: 'dark' })
await phone.page.waitForTimeout(300)
await phone.page.screenshot({ path: `${SHOTS}/finecut-phone-dark.png` })
await phone.page.emulateMedia({ colorScheme: 'light' })
await phone.context.close()

// (h) A file without sound
const dark = await openPage({ viewport: { width: 1280, height: 800 }, locale: 'en', colorScheme: 'dark' })
await newProjectWith(dark.page, 'frames.webm')
await setPlayhead(dark.page, 500_000)
await dark.page.locator('#fine-cut-button').click()
await dark.page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'visible' })
await settle(dark.page)
await dark.page.waitForTimeout(400)
const noSound = await dark.page.getByText('No sound in this file').count()
check('(h) a file without audio shows "No sound in this file"', noSound === 1, String(noSound))
const nextPauseDisabled = await dark.page.getByRole('button', { name: 'Next pause' }).isDisabled()
const prevPauseDisabled = await dark.page.getByRole('button', { name: 'Previous pause' }).isDisabled()
check('(h) the pause buttons are disabled without sound', nextPauseDisabled && prevPauseDisabled)
await dark.page.locator('[role=dialog]').focus()
const cutOn = (p) => readState(p, `(ed, fc) => fc.cutTime`)
const cutNoSound = await cutOn(dark.page)
await dark.page.keyboard.press('p')
await settle(dark.page)
check('(h) P does nothing without sound', (await cutOn(dark.page)) === cutNoSound)
await dark.page.keyboard.press('k')
await settle(dark.page)
const kNoSound = await cutOn(dark.page)
check('(h) keyframe jumps still work without sound (K from 0.5 s goes to 1.0 s)', near(kNoSound, 1_000_000, 3_000), String(kNoSound))
await dark.page.screenshot({ path: `${SHOTS}/finecut-desktop-dark.png` })
const darkFrames = await canvasStats(dark.page, '[data-testid="fine-frame"]')
check('(h) both frame images are drawn in dark mode', darkFrames.length === 2 && darkFrames.every(drawn), JSON.stringify(darkFrames))
await dark.context.close()

// (n) Picture missing: the picture areas explain it, with a button back to the editor. (o) No clip under the playhead.
const missing = await openPage({ viewport: { width: 1440, height: 900 }, locale: 'en', colorScheme: 'light' })
missing.page.on('dialog', (d) => d.accept())
await newProjectWith(missing.page, 'talk.webm')
await missing.page.waitForTimeout(1500)
await missing.page.reload()
await missing.page.waitForSelector('header')
// The re-link dialog opens by itself for a missing used file; close it to reach the editor.
await missing.page.getByRole('dialog', { name: /Missing files/ }).waitFor({ timeout: 8000 })
await missing.page.keyboard.press('Escape')
await missing.page.waitForTimeout(400)
await setPlayhead(missing.page, 700_000)
await missing.page.locator('#fine-cut-button').click()
const mdialog = missing.page.getByRole('dialog', { name: 'Fine cut' })
await mdialog.waitFor({ state: 'visible', timeout: 5000 })
await missing.page.waitForTimeout(400)
const unavailable = missing.page.locator('[data-testid="fine-unavailable"]')
check('(n) a missing file is explained in the picture area', (await unavailable.count()) === 1 && (await unavailable.innerText()).includes('The video file is not available. Re-link it in the library.'))
check('(n) no empty picture boxes are shown in its place', (await missing.page.locator('[data-testid="fine-frame"]').count()) === 0)
check('(n) the header main action reads "Back" when no cut is possible', (await missing.page.locator('[data-testid="fine-primary"]').innerText()).trim() === 'Back')
check('(n) the Fine cut button stays enabled: the clip is there, only its file is not', (await missing.page.locator('#fine-cut-button').getAttribute('aria-disabled')) === 'false')
await missing.page.screenshot({ path: `${SHOTS}/finecut2-missing-1440-light.png` })
await unavailable.getByRole('button', { name: 'Back to editor' }).click()
await mdialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
check('(n) the picture area button closes the view', (await mdialog.count()) === 0)

await missing.page.locator('header button[aria-haspopup]').first().click()
await missing.page.getByRole('menuitem', { name: /New project/ }).click()
await missing.page.waitForTimeout(300)
const noClipButton = missing.page.locator('#fine-cut-button')
check('(o) with no clip under the playhead, Fine cut is disabled with a tooltip', (await noClipButton.getAttribute('aria-disabled')) === 'true' && (await noClipButton.getAttribute('title')) === 'Move the playhead onto a video clip first', String(await noClipButton.getAttribute('title')))
await noClipButton.click({ force: true })
check('(o) the disabled Fine cut button opens nothing', (await missing.page.getByRole('dialog', { name: 'Fine cut' }).count()) === 0)
await missing.context.close()

// (p) Screenshots for the review: 1440 x 900 and 1920 x 1080, light and dark, with the hint.
for (const [w, h] of [[1440, 900], [1920, 1080]]) {
  for (const scheme of ['light', 'dark']) {
    const shot = await openPage({ viewport: { width: w, height: h }, locale: 'en', colorScheme: scheme })
    shot.page.on('dialog', (d) => d.accept())
    await newProjectWith(shot.page, 'talk.webm')
    await setPlayhead(shot.page, 700_000)
    await shot.page.locator('#fine-cut-button').click()
    await shot.page.getByRole('dialog', { name: 'Fine cut' }).waitFor({ state: 'visible' })
    await settle(shot.page)
    await shot.page.waitForTimeout(400)
    const pictures = await canvasStats(shot.page, '[data-testid="fine-frame"]')
    check(`(p) ${w}x${h} ${scheme}: both pictures are drawn`, pictures.length === 2 && pictures.every(drawn), JSON.stringify(pictures))
    const overflow = await shot.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`(p) ${w}x${h} ${scheme}: no horizontal page overflow`, overflow <= 0, String(overflow))
    await shot.page.screenshot({ path: `${SHOTS}/finecut2-${w}-${scheme}.png` })
    extraErrors.push(...shot.errors)
    await shot.context.close()
  }
}

check('(k) no uncaught page errors or console errors', errors.length === 0 && extraErrors.length === 0, [...errors, ...extraErrors].join(' | ').slice(0, 800))
await browser.close()
await server.close()
if (failed) {
  console.log(`${failed} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('ALL CHECKS PASSED')
