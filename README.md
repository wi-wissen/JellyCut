# Jelly Cut

A simple video editor for schools that runs entirely in the browser: no account, no ads, no paywall, and the videos never leave the device.

- Requirements, decisions and mockups: [`docs/requirements-and-mockups.html`](docs/requirements-and-mockups.html), [`docs/decisions.md`](docs/decisions.md), [`docs/ui-layout.md`](docs/ui-layout.md)
- Working rules for contributors and AI assistants: [`CLAUDE.md`](CLAUDE.md)

## Stack

Vue 3 (Options API), TypeScript, Vite, Tailwind v4, Pinia, vue-i18n (German and English), Vitest, [Mediabunny](https://mediabunny.dev) (container reading and MP4 writing, pinned to an exact version), WebCodecs, WebGL2, Web Audio. Fonts are self-hosted through Fontsource (all SIL OFL). The picture stickers are [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (3D style) by Microsoft, MIT licence, copyright notice in [`src/assets/stickers/LICENSE-FluentEmoji.txt`](src/assets/stickers/LICENSE-FluentEmoji.txt); the app credits them on its technology help page.

## Architecture

```
src/core/     pure TypeScript, no DOM, fully unit-tested
  project/    schema, validation, migrations, types
  timeline/   split, trim, ripple, snapping, transitions planner, ops
  render/     Scene (what to draw at time t), built identically for preview and export
  audio/      mix planning, PCM mixing, waveform peaks, pause detection
  export/     presets, bitrates, file names
  history/    undo/redo
  io/         safe relative paths, media re-linking, autosave scheduling
src/engine/   browser layer: WebGL2 compositor, preview, export (runs in a worker),
              media probing, exact frame access, keyframes, waveform
src/platform/ File System Access API, IndexedDB
src/ui/       Vue components and Pinia stores
src/landing/, src/app/, src/help/   entry points of the three real pages
```

The site is built from three real HTML pages (no client-side router, no 404 fallback needed): `index.html` (landing page), `app/index.html` (the editor) and `help/sources/index.html` (guide). The landing and help pages never load the editor code. `vite.config.ts` uses `base: './'`, so the site works under any domain or sub path. Deployment: `.github/workflows/pages.yml` (GitHub Pages from Actions; the custom domain is set in the repository settings).

Preview and export draw through the same `Scene` and the same `Compositor`, so what you see is what you export. All times are whole integer microseconds. Cuts land on real source timestamps.

## Commands

```
npm run dev          # development server
npm run typecheck    # vue-tsc
npm test             # unit tests (Vitest)
npm run build        # production build (editor and help pages are lazy-loaded chunks)
```

Real-browser checks (Playwright + Chromium + the Vite dev server). Each script exits non-zero on failure:
The editor starts with an empty project. Tests that need the built-in demo project open `/app/?demo=1`; a demo session never touches the autosave.

```
node scripts/e2e-project.mjs      # save, open, autosave, undo/redo
node scripts/e2e-timeline.mjs     # timeline editing
node scripts/e2e-import.mjs       # media import
node scripts/e2e-preview.mjs      # frame-exact seeking, playback
node scripts/e2e-render.mjs       # compositor pixels
node scripts/e2e-filters.mjs      # colour filters: tiles, preview, export, autosave
node scripts/e2e-export.mjs       # exported files, frame by frame, audio
node scripts/e2e-export-worker.mjs
node scripts/e2e-export-ui.mjs
node scripts/e2e-gif.mjs          # animated GIF: decoded frames, loop, duration, dialog flow
node scripts/e2e-panels.mjs
node scripts/e2e-waveform.mjs
node scripts/e2e-playback.mjs     # picture follows the playhead, also on a slow CPU
node scripts/e2e-hidpi.mjs        # canvas drawn at device resolution
node scripts/e2e-canvas.mjs       # editing text and clips directly in the player
node scripts/e2e-overlays.mjs      # stickers, shapes and pen strokes: preview pixels, export frame, undo
node scripts/e2e-overlays2.mjs     # opacity, animations, blur/pixelate areas, pictures and videos: preview and export pixels
node scripts/e2e-overlays3.mjs     # vector stickers, slide directions, stacking order, marker pen, picture timing: preview and export pixels
node scripts/e2e-stickers.mjs     # picture stickers: gallery tabs and search, preview and export pixels, save/load, old vector stickers (port 5360)
node scripts/e2e-design.mjs       # design tabs: shared item sections, no position fields, arrow keys, pen, stacking, rounded areas (port 5310)
node scripts/e2e-finecut.mjs
node scripts/e2e-record.mjs
node scripts/e2e-relink.mjs
node scripts/e2e-media-remove.mjs
node scripts/e2e-start.mjs        # first start: empty project, example video, autosave, ?demo=1
node scripts/e2e-pwa.mjs          # production build: manifest, service worker, update toast, offline use (port 5260)
node scripts/e2e-polish.mjs        # format popover, top bar link, save dot, file name, transitions tiles, timeline menu and height (port 5270)
npm run build && node scripts/e2e-build.mjs   # smoke test of the production build
```

The test Chromium decodes and encodes VP8/VP9/AV1 and Opus but not H.264/AAC. Fixtures in `tests/fixtures` are generated with ffmpeg (VP9/Opus WebM); one H.264 MP4 checks the "cannot decode" path. Real Chrome/Edge also encode H.264.

## Browser support

Chrome and Edge first (school PCs). Firefox works with files instead of a work folder; iPad/Safari is untested.
