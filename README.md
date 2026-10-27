# Jelly Cut

A simple video editor for schools that runs entirely in the browser: no account, no ads, no paywall, and the videos never leave the device.

- Documentation: [`docs/decisions.md`](docs/decisions.md) (decision log), [`docs/ui-layout.md`](docs/ui-layout.md) (editor layout), [`docs/performance.md`](docs/performance.md) (export time model and measurements), [`docs/sources-review.md`](docs/sources-review.md) (sources guide checklist), [`docs/logo-notes.md`](docs/logo-notes.md), [`docs/release-checklist.md`](docs/release-checklist.md) (before a release, known limits)
- Original requirements and mockups (frozen, not updated): [`docs/requirements-and-mockups.html`](docs/requirements-and-mockups.html)
- Working rules for contributors and AI assistants: [`CLAUDE.md`](CLAUDE.md)

## Stack

Vue 3 (Options API), TypeScript, Vite (multi-page build), Tailwind v4, Pinia, vue-i18n (German and English), Lucide icons (`lucide-vue-next`), Vitest, Playwright (real-browser checks), [Mediabunny](https://mediabunny.dev) 1.60.0 (pinned to this exact version; reads containers and writes MP4), WebCodecs, WebGL2, Web Audio.

## Architecture

```
src/core/       pure TypeScript, no DOM, no Vue, fully unit-tested
  project/      schema (version 1), validation, migrations, types
  timeline/     edit ops, split, trim, ripple, snapping, transitions, overlays, music, speed, freeze frames
  render/       Scene (what to draw at time t), built identically for preview and export; animations, sticker shapes
  audio/        mix planning, PCM mixing, gain, waveform peaks, pause detection
  export/       presets, file names, time model (costs, estimate, calibration, ETA)
  gif/          GIF writer (LZW, colour quantisation)
  history/      undo and redo
  io/           safe relative paths, media re-linking, autosave scheduling
  filters/, colors/, text/, credits/, learn/, demo/, record/   colour filters, palettes, font list,
                credit lines and licence list, help-page demos, example video, recording state
src/engine/     browser layer: WebGL2 compositor, preview, export (worker with OffscreenCanvas, or the main thread),
                media probing, exact frames (with caches for keyframe-sparse files), keyframes, waveform, sticker pictures, recording, example video
src/platform/   File System Access (project files, work folder), IndexedDB key-value store and media store (recordings), service worker registration
src/ui/         components/ and views/ (Vue), stores/ (Pinia), help/ and site/ (static pages), landing/, pwa/, styles/
src/app/, src/landing/, src/help/   entry points of the editor, the start page and the help pages
src/locales/    de.json and en.json (editor), pages/ (one file per page and language)
src/assets/     logo, Fluent Emoji stickers and animated sticker sheets (with licences and sources), help photos
```

Preview and export draw through the same `Scene` and the same `Compositor`, so what you see is what you export. All times are whole integer microseconds (`src/core/time.ts`). Cuts land on real source timestamps.

## Pages and build

The site is built by Vite as several real HTML pages (`vite.config.ts`). There is no client-side router.

| Page | Entry | Loads |
|---|---|---|
| `/` landing | `index.html`, `src/landing/main.ts` | no editor code |
| `/app/` editor | `app/index.html`, `src/app/main.ts` | the editor |
| `/help/` and `/help/<page>/` (nine pages) | `help/<dir>/index.html`, `src/help/main.ts` | only the view of its page |
| `/404.html` | `public/404.html` | static 404 page of GitHub Pages |

`base: './'` makes the site work under any domain or sub path. Help pages are found by their folder (`help/**/index.html`); their order and names are in `HELP_PAGES` (`src/ui/site/helpPages.ts`).

The build id (short git commit, `__APP_VERSION__` from `vite.config.ts`, `dev` if unknown) is shown quietly in the site footer and at the bottom of the project menu. Recordings always include the microphone (picker and level test in the Record tab). The browser's tracks are recorded as they are; the screen picture and the voice go straight into `MediaRecorder`, Web Audio mixes only voice + share sound and falls back to the voice when its context does not run. A canvas re-draw (30 fps, long side capped at 1920 px) is the remembered fallback after black or missing pictures. The finished file is measured (sound level, picture brightness) and findings plus copyable technical details are shown; see `docs/decisions.md`.

Deployment: `.github/workflows/ci.yml` runs typecheck, tests and build for pull requests and for pushes to branches other than `main`. `.github/workflows/pages.yml` does the same on `main` and then deploys `dist/` to GitHub Pages (pull requests only build). The custom domain is set in the repository settings. The real-browser scripts are not in CI; run them before a release (see [`docs/release-checklist.md`](docs/release-checklist.md)).

## Offline use (PWA)

- `public/manifest.webmanifest` (standalone, start URL `./app/`), icons in `public/icons/`.
- `public/sw.js` is a plain service worker. At build time, `vite.config.ts` writes the list of built files and a build id into `dist/sw.js`. The install step caches the whole build; page navigations are network-first (the cached page when offline); the editor's assets are cached when first fetched; media files and byte-range requests are never cached.
- A new build waits until the user accepts the "Update available" toast (`src/ui/pwa/UpdateToast.vue`); then it takes over and the page reloads. Registration and update logic: `src/platform/offline.ts`.

## Data and privacy

Nothing is uploaded. Videos, pictures and projects stay on the device:

- Media is read locally, decoded and drawn in the browser (WebCodecs, WebGL2, Web Audio) and exported to a file on the device. The example video is encoded in the browser as well.
- The editor autosaves the project in the browser's IndexedDB (`src/platform/localStore.ts`). Recordings and the generated example video exist only inside the app, so their files are also kept in this browser's private storage (IndexedDB, `src/platform/mediaStore.ts`) and come back after a reload; they never leave the device, the project menu shows their size, and they are deleted when the media is removed or a new project starts. Save a copy as a file from the Record panel to keep one outside the browser. A project file (`<name>.jellycut.json`) is written only when the user saves it, to a place they choose or to the downloads folder.
- The only requests the app makes are for the site's own files: pages, scripts, fonts and sticker pictures. There are no analytics. Links to other sites in the help pages are plain links.

## Assets and licences

- Fonts: Bebas Neue, Caveat, DM Mono, Fredoka, Inter, Lora, Pacifico, Sora, self-hosted through Fontsource, SIL Open Font License 1.1.
- Photos in `src/assets/photos` (sea turtle, reef background, cut-out turtle): generated with an AI image model (Google Gemini image model via OpenRouter) for this project; no third-party artwork is included. Check the provider's output terms before a commercial release.
- Sticker pictures: [Fluent Emoji](https://github.com/microsoft/fluentui-emoji), 3D style, by Microsoft, MIT licence. The licence text with the copyright notice is `src/assets/stickers/LICENSE-FluentEmoji.txt`; the source of each file is listed in `src/assets/stickers/SOURCES.txt`. The technology help page credits them.
- Animated stickers: [Fluent Emoji (animated)](https://github.com/microsoft/fluentui-emoji-animated) by Microsoft, MIT licence, pinned commit `daa0365c09795789ed2bc6e8b228c97736cb6669`. Only the small WebP sprite sheets in `src/assets/stickers-animated` are in this repo (not the Git LFS originals); the licence text is `src/assets/stickers-animated/LICENSE-FluentEmojiAnimated.txt`, the source of each file is in `SOURCES.txt` there. `node scripts/build-animated-stickers.mjs` rebuilds them (dev time only; needs curl and python3 with Pillow and numpy, adds no dependency; see "Animated stickers" in `docs/decisions.md`).
- Help photos in `src/assets/photos`: origin and licence still to be recorded (open item in the release checklist).
- Libraries (licences read from `node_modules`): Mediabunny MPL-2.0, lucide-vue-next ISC, Vue, Vue I18n, Pinia, Tailwind, Vite and Vitest MIT, Playwright (development only) Apache-2.0. The technology help page names them.

## Commands

```
npm run dev          # development server (port 5173)
npm run typecheck    # vue-tsc
npm test             # unit tests (Vitest, src/**/*.test.ts)
npm run build        # type check, then production build into dist/
node scripts/screenshot.mjs out.png [light|dark] [width] [height] [locale] [path]   # one screenshot of a page
node scripts/generate-palette.mjs   # regenerates src/core/colors/tailwindPalette.ts from the Tailwind theme
```

### Real-browser checks

The scripts in `scripts/e2e-*.mjs` drive Chromium with Playwright (`playwright-core`). Each one starts its own server on the port in the table (`strictPort`): the Vite development server, or the preview server of the build for `e2e-build.mjs` and `e2e-pwa.mjs`. A script exits with code 1 when a check fails.

- Chromium is looked up under `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`, the development container's location).
- Stop `npm run dev` first (port 5173 is used by `e2e-gif.mjs`). Run the scripts one at a time: 5183, 5250 and 5350 are shared by two scripts each.
- `e2e-build.mjs` and `e2e-pwa.mjs` test the production build and need `npm run build` first.
- Pages that need the demo project open `/app/?demo=1`; a demo session never touches the autosave. A plain `/app/` starts empty.
- The test Chromium decodes and encodes VP8/VP9/AV1 and Opus, but not H.264/AAC. The fixtures in `tests/fixtures` are VP9/Opus WebM clips, PNG stills and one H.264/AAC MP4 for the "cannot decode" path. `recorded-*.webm` are real MediaRecorder recordings (160 x 90, about 2.6 s, VP8 or VP9 + Opus, recorded in Firefox 157 and Chromium with a 1 s timeslice like the Record tab) plus one ffmpeg file that starts late (first picture at 0.3 s, no cues, one keyframe). No script in the repository regenerates them.
- Scripts marked "root page" use the start page URL as a harness and import modules from `src/` in the browser.

| Script | Port | Checks |
|---|---|---|
| **Editor, media and timeline** | | |
| `e2e-start.mjs` | 5176 | first start: empty project, example video, autosave, `?demo=1` |
| `e2e-project.mjs` | 5198 | save, open, autosave, project menu, undo and redo |
| `e2e-import.mjs` | 5191 | media import, library, adding to the timeline |
| `e2e-rotation.mjs` | 5470 | phone video with rotation metadata (`clip-c-rotated.mp4`): paused and playing picture agree, a clip turned by 90° fills the output |
| `e2e-media.mjs` | 5193 | media probe against the fixtures (root page) |
| `e2e-waveform.mjs` | 5185 | keyframe index and streaming waveform (root page) |
| `e2e-frames.mjs` | 5192 | frame-exact access to the frame numbers in the fixture (root page) |
| `e2e-finecut-recorded.mjs` | 5440 | fine cut and optimisation of a 30 s recording with one keyframe (recorded in the page at test time, cached in the temp folder; `REGEN=1`, `SECONDS=`, `CODEC=`): time until the fine cut is usable, steps, cache budgets, keyframes every second, same length, pictures and look, progress, Skip, rescue copy |
| `e2e-recorded-frames.mjs` | 5420 | clips recorded by MediaRecorder (`recorded-*.webm`): paused preview, fine cut and export are not black, safety net (media element) when the exact path fails; provider check in Firefox when installed (`MODES=none,throws,black` selects safety-net runs) |
| `e2e-media-remove.mjs` | 5183 | removing media from the library, with and without use |
| `e2e-relink.mjs` | 5182 | re-linking missing media, work folder, access again |
| `e2e-persist.mjs` | 5430 | recordings survive: fine cut and export keep the media ready, reload restores from the browser storage (no re-link), New project deletes the copy, quota error and rescue download, project file opened where the recording was never stored (`BROWSER=firefox` runs it in Firefox) |
| `e2e-record.mjs` | 5183 | Record tab with fake devices, microphone picker/test, self-healing, final-file checks, errors, screenshots (`E2E_PORT`; `BROWSER=firefox` runs it in Firefox, `ONLY=<regex>` selects checks) |
| `e2e-timeline.mjs` | 5196 | selection, split, trim, reorder, zoom, keyboard (`E2E_PORT`) |
| `e2e-panels.mjs` | 5189 | left column, player toolbar, one undo per slider drag (`E2E_PORT`) |
| `e2e-responsive.mjs` | 5210 | no overflow at several sizes, 44 px targets, touch lift (`E2E_PORT`) |
| `e2e-polish.mjs` | 5270 | format popover, save dot, file name, timeline menu and height (`E2E_PORT`) |
| `e2e-canvas.mjs` | 5181 | text and clips directly in the player |
| `e2e-hidpi.mjs` | 5179 | canvas drawn at device resolution |
| `e2e-preview.mjs` | 5188 | frame-exact seeking and playback |
| `e2e-playback.mjs` | 5180 | picture follows the playhead, also on a slow CPU |
| `e2e-finecut.mjs` | 5184 | fine cut overlay |
| `e2e-render.mjs` | 5194 | compositor pixels |
| `e2e-filters.mjs` | 5174 | colour filters: tiles, preview, export, autosave |
| `e2e-speedmodal.mjs` | 5350 | speed dialog, 0.1x to 100x, mute label (`E2E_PORT`) |
| `e2e-ownsound.mjs` | 5350 | own sound: record, move, trim, split, mute (`E2E_PORT`) |
| `e2e-freeze.mjs` | 5220 | freeze frame in preview and export |
| **Overlays and design** | | |
| `e2e-overlays.mjs` | 5230 | stickers, shapes, pen: preview pixels, exported frame, undo |
| `e2e-overlays2.mjs` | 5250 | opacity, animations, blur and pixelate areas, pictures and videos |
| `e2e-overlays3.mjs` | 5250 | vector stickers, directions, stacking, marker, picture timing |
| `e2e-zorder.mjs` | 5340 | true stacking order of areas and other overlays |
| `e2e-laneorder.mjs` | 5410 | stacking from the timeline: menu, shortcuts, lane drag, Escape, undo |
| `e2e-stickers.mjs` | 5360 | picture stickers: gallery, preview and export pixels, save and load |
| `e2e-animstickers.mjs` | 5390 | animated stickers: no sheet on first load, lazy sheets, whole loops, loop pixels in preview and export, snapping, save and load, fallback |
| `e2e-design.mjs` | 5310 | design tabs: shared sections, no position fields, arrow keys (`E2E_PORT`) |
| `e2e-fitend.mjs` | 5380 | overlays, texts and music end with the video: new items, drag, trim, delete the last clip, undo |
| **Export** | | |
| `e2e-export-worker.mjs` | 5187 | export in a worker, progress, cancel (root page) |
| `e2e-export.mjs` | 5190 | exported MP4 frame by frame and audio (root page) |
| `e2e-export-ui.mjs` | 5186 | export dialog, automatic saving, estimate range, ETA, cancel |
| `e2e-gif.mjs` | 5173 | animated GIF: decoded frames, loop, duration, dialog flow |
| **Site** | | |
| `e2e-landing.mjs` | 5290 | start page: links, theme, footer, reduced motion, no editor code |
| `e2e-help.mjs` | 5300 | help section: pages, navigation, overflow, theme persistence |
| `e2e-help-didactic.mjs` | 5320 | the four didactic help pages and their widgets |
| `e2e-help-editors.mjs` | 5330 | editors help page: table, cards, chooser |
| `e2e-credits.mjs` | 5175 | credits dialog, licence texts, sources guide links |
| **Production build** (after `npm run build`) | | |
| `e2e-build.mjs` | 5177 | smoke test of `dist/`: real pages, relative paths, worker export |
| `e2e-pwa.mjs` | 5260 | manifest, service worker, update toast, offline use, animated sheets not precached but cached on use |

`(E2E_PORT)` in the table means the port can be changed with the environment variable `E2E_PORT`; the default is the port shown.

## Adding a help page

1. Copy `help/rights/index.html` to `help/<dir>/index.html` and set `<body data-page="<slug>">`. The relative paths (`../../`) point to the site root.
2. Add `{ slug, dir: '<dir>/' }` to `HELP_PAGES` in `src/ui/site/helpPages.ts`. The list order is the reading order and the previous and next links.
3. Add a lazy view for the slug to `VIEWS` in `src/help/main.ts`. The type check fails until it exists.
4. Create `src/ui/views/help/<Name>View.vue` with `HelpLayout` (see `RightsView.vue`).
5. Add `help.<slug>.title` and the page texts to `src/locales/pages/help-<slug>.de.json` and `help-<slug>.en.json`.
6. Run `npm test` (`helpPages.test.ts` checks folders, titles and the chain) and `node scripts/e2e-help.mjs`, which reads `HELP_PAGES` too.

## Translations

- Every UI string is in German and English and comes from the locale files; components never hardcode text.
- Editor strings: `src/locales/de.json` and `en.json`. Page strings: `src/locales/pages/<name>.<de|en>.json`. All page files are merged automatically, in file name order, so a key belongs in one file only.
- `src/locales/locales.test.ts` checks that both languages have the same keys and placeholders.
- The language is German when a browser language starts with `de`, otherwise English (`src/ui/i18n.ts`).

## Browser support

Chrome and Edge first (school PCs). Firefox works with files instead of a work folder; iPad and Safari are untested. Known limits and the open device checks are listed in [`docs/release-checklist.md`](docs/release-checklist.md).
