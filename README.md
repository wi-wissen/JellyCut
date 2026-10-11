# Jelly Cut

A simple video editor for schools that runs entirely in the browser: no account, no ads, no paywall, and the videos never leave the device.

- Requirements, decisions and mockups: [`docs/requirements-and-mockups.html`](docs/requirements-and-mockups.html), [`docs/decisions.md`](docs/decisions.md), [`docs/ui-layout.md`](docs/ui-layout.md)
- Working rules for contributors and AI assistants: [`CLAUDE.md`](CLAUDE.md)

## Stack

Vue 3 (Options API), TypeScript, Vite, Tailwind v4, Pinia, vue-i18n (German and English), Vitest, [Mediabunny](https://mediabunny.dev) (container reading and MP4 writing, pinned to an exact version), WebCodecs, WebGL2, Web Audio. Fonts are self-hosted through Fontsource (all SIL OFL).

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
```

Preview and export draw through the same `Scene` and the same `Compositor`, so what you see is what you export. All times are whole integer microseconds. Cuts land on real source timestamps.

## Commands

```
npm run dev          # development server
npm run typecheck    # vue-tsc
npm test             # unit tests (Vitest)
npm run build        # production build (editor and help pages are lazy-loaded chunks)
```

Real-browser checks (Playwright + Chromium + the Vite dev server). Each script exits non-zero on failure:

```
node scripts/e2e-project.mjs      # save, open, autosave, undo/redo
node scripts/e2e-timeline.mjs     # timeline editing
node scripts/e2e-import.mjs       # media import
node scripts/e2e-preview.mjs      # frame-exact seeking, playback
node scripts/e2e-render.mjs       # compositor pixels
node scripts/e2e-export.mjs       # exported files, frame by frame, audio
node scripts/e2e-export-worker.mjs
node scripts/e2e-export-ui.mjs
node scripts/e2e-panels.mjs
node scripts/e2e-waveform.mjs
```

The test Chromium decodes and encodes VP8/VP9/AV1 and Opus but not H.264/AAC. Fixtures in `tests/fixtures` are generated with ffmpeg (VP9/Opus WebM); one H.264 MP4 checks the "cannot decode" path. Real Chrome/Edge also encode H.264.

## Browser support

Chrome and Edge first (school PCs). Firefox works with files instead of a work folder; iPad/Safari is untested.
