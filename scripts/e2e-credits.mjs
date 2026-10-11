// Real-browser check of credits (requirement E-01): the dialog from the project menu and from a library tile,
// status badges, the generated text, copying, one undo per typing burst, invalid links, focus handling, and the
// guide page in German and English (links, table of contents, no overflow at 390 px).
// Usage: node scripts/e2e-credits.mjs
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5175
const ORIGIN = `http://localhost:${PORT}`
const APP_URL = `${ORIGIN}/app/`
const GUIDE_URL = `${ORIGIN}/help/sources/`
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-JellyCut/8ac8332d-b077-5711-8558-272fe1bb4e47/scratchpad'
const fixture = (name) => join(root, 'tests/fixtures', name)
mkdirSync(SHOT_DIR, { recursive: true })

const outcomes = []
function check(name, ok, detail = '') {
  outcomes.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` (${detail})`}`)
}

function findChromium() {
  const r = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${r}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(r).find((d) => d.startsWith('chromium-'))
  return `${r}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && pageErrors.push(m.text()))
// The New project action asks before discarding unsaved changes.
page.on('dialog', (d) => d.accept())

/** Reads from the Pinia stores in the page: fnSrc is (editor, media) => value. */
const read = (fnSrc) =>
  page.evaluate((src) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    return new Function(`return (${src})`)()(pinia._s.get('editor'), pinia._s.get('media'))
  }, fnSrc)

/** Runs an editor store action in the page (for undo, which the dialog does not offer). */
const act = (fnSrc) =>
  page.evaluate((src) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    return new Function(`return (${src})`)()(pinia._s.get('editor'))
  }, fnSrc)

const PROJECT = '(ed) => ({ assets: ed.project.assets, clips: ed.project.clips.length, music: ed.project.music.length, past: ed.history.past.length })'
const assetCredit = (name) => `(ed) => (ed.project.assets.find((a) => a.name === '${name}') ?? {}).credit ?? null`

const dialog = () => page.getByRole('dialog', { name: 'Credits' })
const section = (name) => dialog().getByRole('region', { name })
const preview = () => dialog().locator('textarea')

// Setup: new project, both fixtures imported and put on the timeline.
await page.goto(APP_URL)
await page.waitForSelector('header')
await page.locator('#project-menu-trigger').click()
await page.getByRole('menuitem', { name: /New project/ }).click()
await page.locator('input[type=file]').first().setInputFiles([fixture('frames.webm'), fixture('music.webm')])
await page.getByRole('button', { name: /^Add frames\.webm to the timeline/ }).waitFor({ timeout: 20000 })
await page.getByRole('button', { name: /^Add frames\.webm to the timeline/ }).click()
await page.getByRole('button', { name: 'Audio', exact: true }).click()
await page.getByRole('button', { name: /^Add music\.webm to the timeline/ }).waitFor({ timeout: 20000 })
await page.getByRole('button', { name: /^Add music\.webm to the timeline/ }).click()
await page.getByRole('button', { name: 'Media', exact: true }).click()
await page.waitForTimeout(300)
const setup = await read(PROJECT)
check('setup: frames.webm on the timeline and music.webm as music', setup.clips === 1 && setup.music === 1, JSON.stringify(setup))

// 1. Dialog from the project menu.
await page.locator('#project-menu-trigger').click()
await page.getByRole('menuitem', { name: /^Credits/ }).click()
await dialog().waitFor({ timeout: 4000 })
check('menu item opens the credits dialog', await dialog().isVisible())
check('dialog is labelled and modal', (await dialog().getAttribute('aria-modal')) === 'true' && (await dialog().getAttribute('aria-labelledby')) === 'credits-dialog-title')
check('dialog lists both media in use', (await section('frames.webm').count()) === 1 && (await section('music.webm').count()) === 1)
check('unlicensed media show "Details missing"', (await section('frames.webm').getByText('Details missing', { exact: true }).count()) === 1 && (await section('music.webm').getByText('Details missing', { exact: true }).count()) === 1)
check('focus lands in the dialog on open', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))
await page.screenshot({ path: join(SHOT_DIR, 'credits-dialog-initial-light-1440.png') })

// 2. Fill a CC BY medium: badge changes and the text carries all parts.
const frames = section('frames.webm')
await frames.getByLabel('Title', { exact: true }).fill('Sunset beach')
await frames.getByLabel('Author', { exact: true }).fill('Lena Example')
await frames.getByLabel('Source', { exact: true }).fill('Pixabay')
await frames.getByLabel('Link', { exact: true }).fill('https://pixabay.com/videos/sunset-beach-1/')
await frames.getByLabel('Licence', { exact: true }).selectOption('cc-by-4.0')
await frames.getByText('Complete', { exact: true }).waitFor({ timeout: 3000 })
check('badge: complete once title, author, source, link and licence are set', (await frames.getByText('Complete', { exact: true }).count()) === 1)
const text1 = await preview().inputValue()
const wanted = [
  'Images and videos',
  'Sunset beach by Lena Example',
  'source: Pixabay (https://pixabay.com/videos/sunset-beach-1/)',
  'licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
  'Music',
  'Edited with Jelly Cut'
]
check('generated text contains author, source, licence and URLs', wanted.every((w) => text1.includes(w)) && !text1.includes('undefined'), text1)
check('music is still incomplete, so the text says so by its missing line', text1.includes('music.webm'))

// 3. Own work and CC0 need no credit: badge and text.
await frames.getByLabel('Licence', { exact: true }).selectOption('own-work')
check('badge: own work says no credit needed', (await frames.getByText('No credit needed', { exact: true }).count()) === 1)
const music = section('music.webm')
await music.getByLabel('Licence', { exact: true }).selectOption('cc0-1.0')
check('badge: CC0 says no credit needed', (await music.getByText('No credit needed', { exact: true }).count()) === 1)
await dialog().getByText('The media in use need no credit text.').waitFor({ timeout: 3000 })
check('text is empty when nothing needs credit (own work and CC0)', (await preview().inputValue()) === '')
check('copy is disabled when there is nothing to copy', await dialog().getByRole('button', { name: 'Copy text' }).isDisabled())
await frames.getByLabel('Licence', { exact: true }).selectOption('cc-by-4.0')
await music.getByLabel('Licence', { exact: true }).selectOption('cc-by-4.0')
await frames.getByText('Complete', { exact: true }).waitFor({ timeout: 3000 })
check('text returns when a CC BY licence is chosen again', (await preview().inputValue()).includes('Sunset beach by Lena Example'))

// 4. Copy writes the text to the clipboard.
const expected = await preview().inputValue()
await dialog().getByRole('button', { name: 'Copy text' }).click()
await dialog().getByText('Copied', { exact: true }).waitFor({ timeout: 3000 })
const clip = await page.evaluate(() => navigator.clipboard.readText())
check('copy writes the generated text to the clipboard', clip === expected, clip.slice(0, 80))
check('copy shows a polite status message', (await dialog().locator('[role=status]').innerText()).trim() === 'Copied')

// 5. One undo per typing burst.
const musicTitle = music.getByLabel('Title', { exact: true })
const before = (await read(PROJECT)).past
await musicTitle.click()
await musicTitle.pressSequentially('Sunset loop', { delay: 15 })
await musicTitle.press('Tab')
await page.waitForTimeout(150)
const afterTyping = (await read(PROJECT)).past
check('typing a burst adds exactly one undo step', afterTyping - before === 1, `${before} -> ${afterTyping}`)
check('the typed title is stored', (await read(assetCredit('music.webm')))?.title === 'Sunset loop')
await act('(ed) => ed.undo()')
await page.waitForTimeout(100)
check('one undo removes the whole burst', (await read(assetCredit('music.webm')))?.title === undefined)
await act('(ed) => ed.redo()')
await page.waitForTimeout(100)
check('redo restores the burst', (await read(assetCredit('music.webm')))?.title === 'Sunset loop')

// 6. Invalid link: friendly message, nothing stored.
const link = frames.getByLabel('Link', { exact: true })
await link.fill('pixabay.com/videos/x')
const alert = frames.getByRole('alert')
await alert.waitFor({ timeout: 3000 })
check('invalid link shows a friendly message', (await alert.innerText()).includes('https://'))
check('invalid link is not stored', (await read(assetCredit('frames.webm')))?.url === 'https://pixabay.com/videos/sunset-beach-1/')
check('invalid link is marked for assistive technology', (await link.getAttribute('aria-invalid')) === 'true')
await link.fill('javascript:alert(1)')
check('javascript: links are rejected too', (await frames.getByRole('alert').count()) === 1)
await link.press('Tab')
await page.waitForTimeout(100)
check('leaving an invalid link restores the stored one', (await link.inputValue()) === 'https://pixabay.com/videos/sunset-beach-1/' && (await frames.getByRole('alert').count()) === 0)
await link.fill('https://pixabay.com/videos/sunset-beach-2/')
check('a valid link is stored', (await read(assetCredit('frames.webm')))?.url === 'https://pixabay.com/videos/sunset-beach-2/')
await link.press('Tab')

// 7. Keyboard: Escape closes and focus goes back to the menu trigger.
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached', timeout: 3000 })
check('Escape closes the dialog', (await dialog().count()) === 0)
check('focus returns to the project menu after closing', await page.evaluate(() => document.activeElement?.id === 'project-menu-trigger'))

// 8. Dialog from a library tile, focused on that medium (music sits in the Audio tab).
await page.getByRole('button', { name: 'Audio', exact: true }).click()
await page.getByRole('button', { name: 'Credits for music.webm' }).click()
await dialog().waitFor({ timeout: 3000 })
const focused = await page.evaluate(() => document.activeElement?.getAttribute('id') ?? '')
const musicAssetId = (await read('(ed) => ed.project.assets.find((a) => a.name === "music.webm").id'))
check('tile button opens the dialog and focuses that medium', focused === `credit-title-${musicAssetId}`, focused)
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached', timeout: 3000 })
check('focus returns to the tile button', await page.evaluate((id) => document.activeElement?.id === `credit-button-${id}`, musicAssetId))

// 9. Focus trap: Tab from the last control wraps to the first.
await page.getByRole('button', { name: 'Media', exact: true }).click()
await page.getByRole('button', { name: 'Credits for frames.webm' }).click()
await dialog().waitFor({ timeout: 3000 })
await dialog().getByRole('button', { name: 'Close' }).focus()
await page.keyboard.press('Tab')
check('Tab wraps inside the dialog', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))
check('touch targets are at least 44 px', await dialog().locator('button:visible, input:visible, select:visible').evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 43.5)))
await dialog().getByRole('button', { name: 'Close' }).click()
await dialog().waitFor({ state: 'detached', timeout: 3000 })

// 9b. Export hint: shown in the done state while a medium needs credit; non-blocking, dismissible, opens credits.
const exportPhase = () => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('export').phase)
const exportDialog = () => page.getByRole('dialog', { name: /Export video/ })
const hint = () => exportDialog().getByRole('button', { name: 'Open credits', exact: true })
/** Opens the export dialog (or uses the open one), starts and waits for the done state. */
async function runExport(openFirst) {
  if (openFirst) await page.locator('#export-button').click()
  await exportDialog().waitFor({ timeout: 4000 })
  for (let i = 0; i < 150 && (await exportPhase()) !== 'ready'; i++) await page.waitForTimeout(100)
  await page.getByRole('button', { name: 'Start export', exact: true }).click()
  for (let i = 0; i < 600 && (await exportPhase()) !== 'done'; i++) await page.waitForTimeout(100)
  return (await exportPhase()) === 'done'
}
check('export finishes with media that need credit', await runExport(true))
check('export hint is shown when a used medium needs credit', (await hint().count()) === 1)
check('export hint does not block: Save stays enabled', await exportDialog().getByRole('button', { name: 'Save', exact: true }).isEnabled())
await hint().click()
await dialog().waitFor({ timeout: 3000 })
check('hint button opens the credits dialog above the export dialog', (await dialog().isVisible()) && (await exportDialog().count()) === 1)
await page.keyboard.press('Escape')
await dialog().waitFor({ state: 'detached', timeout: 3000 })
check('Escape closes only the credits dialog', (await exportDialog().count()) === 1 && (await exportPhase()) === 'done')
check('focus returns to the hint button', await page.evaluate(() => document.activeElement?.id === 'export-credits-hint-button'))
await exportDialog().getByRole('button', { name: 'Hide', exact: true }).click()
check('hiding the hint removes it', (await hint().count()) === 0)
await exportDialog().getByRole('button', { name: 'Close', exact: true }).click()
await exportDialog().waitFor({ state: 'detached', timeout: 3000 })

// Nothing needs credit any more (own work on every medium): the done state shows no hint.
await page.evaluate(async () => {
  const { patchAssetCredit } = await import('/src/core/credits/credits.ts')
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const ed = pinia._s.get('editor')
  for (const a of ed.project.assets) ed.commitProject(patchAssetCredit(ed.project, a.id, { license: 'own-work' }))
})
check('export without credit-needing media: no hint', (await runExport(true)) && (await hint().count()) === 0)
await exportDialog().getByRole('button', { name: 'Close', exact: true }).click()
await exportDialog().waitFor({ state: 'detached', timeout: 3000 })

// 10. Responsive and dark layout of the dialog, then the guide page.
await page.emulateMedia({ colorScheme: 'dark' })
await page.getByRole('button', { name: 'Credits for frames.webm' }).click()
await dialog().waitFor({ timeout: 3000 })
await page.screenshot({ path: join(SHOT_DIR, 'credits-dialog-dark-1440.png') })
await page.keyboard.press('Escape')
await page.emulateMedia({ colorScheme: 'light' })
await page.setViewportSize({ width: 390, height: 800 })
await page.waitForTimeout(200)
await page.locator('#project-menu-trigger').click()
await page.getByRole('menuitem', { name: /^Credits/ }).click()
await dialog().waitFor({ timeout: 3000 })
check('dialog fits a 390 px wide screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await page.screenshot({ path: join(SHOT_DIR, 'credits-dialog-light-390.png') })
await page.keyboard.press('Escape')
await page.setViewportSize({ width: 1440, height: 900 })

// Guide page, German and English. A fresh context per language sets the browser language.
async function guideCheck(locale, lang, title) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()))
  await p.goto(GUIDE_URL)
  await p.waitForSelector('h1')
  check(`guide (${locale}): renders with the title`, (await p.locator('h1').innerText()).trim() === title)
  check(`guide (${locale}): lang attribute follows the locale`, (await p.evaluate(() => document.documentElement.lang)) === lang)

  const external = await p.locator('main a[href^="http"]').evaluateAll((els) =>
    els.map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' }))
  )
  const wantedLinks = [
    'https://pixabay.com', 'https://www.pexels.com', 'https://unsplash.com', 'https://commons.wikimedia.org', 'https://openverse.org',
    'https://www.pexels.com/videos/', 'https://pixabay.com/videos/', 'https://pixabay.com/music/',
    'https://freemusicarchive.org/home'
  ]
  check(`guide (${locale}): no links to the removed sources`, !external.some((l) => /freesound|incompetech/.test(l.href)))
  check(`guide (${locale}): every listed source is linked (${external.length} links)`, wantedLinks.every((h) => external.some((l) => l.href === h)))
  check(`guide (${locale}): external links open in a new tab with noopener`, external.length > 0 && external.every((l) => l.target === '_blank' && l.rel.split(' ').includes('noopener') && l.rel.split(' ').includes('noreferrer')), JSON.stringify(external.filter((l) => !(l.target === '_blank' && l.rel.includes('noopener')))))
  check(`guide (${locale}): each external link has a visible indicator`, (await p.locator('main a[target=_blank] svg').count()) === external.length)

  const backHref = await p.getByRole('link', { name: /Open app|App öffnen/ }).first().getAttribute('href')
  check(`guide (${locale}): open-app link points to the editor`, backHref === '../../app/')
  const startHref = await p.getByRole('link', { name: 'Jelly Cut', exact: true }).getAttribute('href')
  check(`guide (${locale}): link to the landing page`, startHref === '../../')

  // Table of contents: every anchor scrolls its section to the top.
  const anchors = await p.locator('nav a[href^="#"]').evaluateAll((els) => els.map((a) => a.getAttribute('href')))
  check(`guide (${locale}): table of contents has all 7 sections`, anchors.length === 7, anchors.join(' '))
  let anchorsOk = true
  for (const id of anchors) {
    await p.locator(`nav a[href="${id}"]`).first().click()
    await p.waitForTimeout(80)
    const top = await p.evaluate((h) => document.querySelector(h).getBoundingClientRect().top, id)
    // The last sections cannot scroll to the top of a short page; they must still be in view.
    if (!(p.url().endsWith(id) && top >= -2 && top < (await p.evaluate(() => window.innerHeight)) - 40)) {
      anchorsOk = false
      console.log(`   anchor ${id}: top ${top}`)
    }
  }
  check(`guide (${locale}): table of contents anchors work`, anchorsOk)

  await p.setViewportSize({ width: 390, height: 800 })
  await p.waitForTimeout(150)
  check(`guide (${locale}): no horizontal overflow at 390 px`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await p.evaluate(() => document.documentElement.scrollWidth))
  await p.screenshot({ path: join(SHOT_DIR, `credits-guide-${lang}-light-390.png`), fullPage: true })
  await p.emulateMedia({ colorScheme: 'dark' })
  await p.setViewportSize({ width: 1440, height: 900 })
  await p.screenshot({ path: join(SHOT_DIR, `credits-guide-${lang}-dark-1440.png`), fullPage: true })
  await p.emulateMedia({ colorScheme: 'light' })
  await p.setViewportSize({ width: 1440, height: 900 })
  await p.screenshot({ path: join(SHOT_DIR, `credits-guide-${lang}-light-1440.png`), fullPage: true })
  check(`guide (${locale}): no uncaught errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await guideCheck('de-DE', 'de', 'Freie Bilder, Musik und Videos')
await guideCheck('en-US', 'en', 'Free images, music and videos')

check('editor: no uncaught errors', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
await server.close()
const failed = outcomes.filter((ok) => !ok).length
console.log(`${outcomes.length - failed}/${outcomes.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
