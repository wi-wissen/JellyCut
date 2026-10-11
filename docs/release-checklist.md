# Release checklist

Run this before every release. Purposes of the real-browser scripts are in the [README](../README.md#real-browser-checks); this file gives the order and the known limits.

Released: ____________ by: ____________ commit: ____________

## 1. Automated checks

- [ ] `npm run typecheck` and `npm test` pass (CI runs them too).
- [ ] `npm run build` succeeds (CI runs it too).
- [ ] `node scripts/e2e-build.mjs` (port 5177) and `node scripts/e2e-pwa.mjs` (port 5260) pass. Both need the build from the step before.

## 2. Real-browser scripts (dev server)

Stop `npm run dev` first (it uses port 5173, which `e2e-gif.mjs` needs). Run the scripts one after another, not in parallel: several share a port (5183, 5250, 5350). Each script exits non-zero on a failed check.

- [ ] `e2e-start.mjs` (5176)
- [ ] `e2e-project.mjs` (5198)
- [ ] `e2e-import.mjs` (5191)
- [ ] `e2e-media.mjs` (5193)
- [ ] `e2e-waveform.mjs` (5185)
- [ ] `e2e-frames.mjs` (5192)
- [ ] `e2e-recorded-frames.mjs` (5420)
- [ ] `e2e-media-remove.mjs` (5183)
- [ ] `e2e-relink.mjs` (5182)
- [ ] `e2e-record.mjs` (5183)
- [ ] `e2e-timeline.mjs` (5196)
- [ ] `e2e-panels.mjs` (5189)
- [ ] `e2e-responsive.mjs` (5210)
- [ ] `e2e-polish.mjs` (5270)
- [ ] `e2e-canvas.mjs` (5181)
- [ ] `e2e-hidpi.mjs` (5179)
- [ ] `e2e-preview.mjs` (5188)
- [ ] `e2e-playback.mjs` (5180)
- [ ] `e2e-finecut.mjs` (5184)
- [ ] `e2e-render.mjs` (5194)
- [ ] `e2e-filters.mjs` (5174)
- [ ] `e2e-speedmodal.mjs` (5350)
- [ ] `e2e-ownsound.mjs` (5350)
- [ ] `e2e-freeze.mjs` (5220)
- [ ] `e2e-overlays.mjs` (5230)
- [ ] `e2e-overlays2.mjs` (5250)
- [ ] `e2e-overlays3.mjs` (5250)
- [ ] `e2e-zorder.mjs` (5340)
- [ ] `e2e-stickers.mjs` (5360)
- [ ] `e2e-animstickers.mjs` (5390)
- [ ] `e2e-design.mjs` (5310)
- [ ] `e2e-fitend.mjs` (5380)
- [ ] `e2e-export-worker.mjs` (5187)
- [ ] `e2e-export.mjs` (5190)
- [ ] `e2e-export-ui.mjs` (5186)
- [ ] `e2e-gif.mjs` (5173)
- [ ] `e2e-credits.mjs` (5175)
- [ ] `e2e-landing.mjs` (5290)
- [ ] `e2e-help.mjs` (5300)
- [ ] `e2e-help-didactic.mjs` (5320)
- [ ] `e2e-help-editors.mjs` (5330)

Screenshots written by the scripts (light and dark, desktop and phone) are looked at by a person once per release.

## 3. Sources and licences

- [ ] [`sources-review.md`](sources-review.md) checklist done: links, licence statements, Jelly Cut defaults, wording.
- [ ] `src/assets/stickers/LICENSE-FluentEmoji.txt` and `src/assets/stickers-animated/LICENSE-FluentEmojiAnimated.txt` are the MIT text with the Microsoft copyright line; `/help/tech/` still credits Fluent Emoji and Fluent Emoji (animated).
- [ ] Animated sticker sheets: the total in `src/assets/stickers-animated/catalogue.json` is at most 6 MB, `dist` has no `sticker-anim-` file in the `PRECACHE` list of `dist/sw.js` (the first install must not grow), and `e2e-pwa.mjs` passes.
- [ ] Fonts (Fontsource, SIL OFL 1.1) and npm dependencies (licences in the README) unchanged, or the README updated.
- [ ] Open: the photos in `src/assets/photos` (turtle, reef plate) have no recorded origin or licence. Record them (and their credit line, if one is needed) before the release.

## 4. Live site (after the Pages deployment)

- [ ] `/` (landing): the call to action opens `/app/`; the theme toggle works and is remembered on the help pages.
- [ ] `/app/`: an empty project with the start card; `/app/?demo=1` opens the demo project.
- [ ] `/help/` and every help page (`/help/<page>/`) open, in German and English, and the previous and next links reach all pages.
- [ ] Unknown path shows the 404 page.
- [ ] No request leaves the site while editing (browser DevTools, Network tab: only the site's own files).

## 5. PWA update test

- [ ] Open `/app/` from the live site once, wait for the service worker to install, reload once.
- [ ] Deploy a second build (any change). Reload: the "Update available" toast appears; "Reload" loads the new build.
- [ ] With the browser offline, reload `/app/` and a help page visited before: both load.
- [ ] Media files are not stored by the service worker (DevTools, Cache Storage).

## 6. Real-device checks still open

These cannot be run in the test Chromium. Each needs a person with the device, and the result goes into this list.

- [ ] Safari on macOS and iPad: layout, touch timeline, export (no File System Access API; downloads).
- [ ] Firefox: no work folder (files only), export in a foreground and a background tab (throttling).
- [ ] Hardware H.264 on a school PC (Chrome or Edge): H.264 MP4 import (decode) and export (encode) with AAC audio; the export time estimate after one export.
- [ ] 4K source (for example 3840 x 2160 H.264): import, preview playback and export to 1080p; check the time against [`performance.md`](performance.md).
- [ ] File System Access dialogs (Chrome, Edge): open and save a project, choose a work folder, cancel a picker, grant access again after a restart.
- [ ] Firefox: record 10 s (screen + voice), put the clip on the timeline, pause at several places (also after 1 s, 5 s and at the very start) and step with the frame buttons: the picture is never black; open the fine cut there. The console must not show `[jellycut] paused picture ... comes from the video element` (if it does, the exact path failed and the safety net was used: copy the line).
- [ ] Screen capture (Record tab): screen recording with the system dialog in Chrome/Edge and Firefox (whole screen, a window, a tab): picture not black, own voice audible in the editor and in the export, microphone test shows a level; a browser without screen capture (the button must be hidden). If something fails, copy the "Technical details".

## 7. Known limitations

Taken from the code comments, [`decisions.md`](decisions.md) and [`performance.md`](performance.md). Nothing here blocks a release by itself; each item should be unchanged or known to the maintainer.

**Export time and background tabs**

- Only the decode, draw and encode shares of the time model come from measurements. The other constants are guesses until a computer has been calibrated by its first exports. The shown range is +/- 50 % before that.
- The VP9 and AV1 factor (2.5) is a guess; only AVC was measured.
- An export in a hidden tab runs slower. The worker should avoid the throttling, but this is not measured yet (`performance.md`, "Not measured yet"). Exports with more than 10 % hidden time do not calibrate.
- Exports run in a worker only where `OffscreenCanvas` exists; otherwise on the main thread.

**Media and codecs**

- The test Chromium cannot decode or encode H.264 or AAC. H.264 import and export are checked only by hand (section 6).
- Sound of a video picture (picture-in-picture) is never mixed into the preview or the export.
- A freeze frame has speed 1 and no sound.
- Clips above 4x speed have no sound; clip speed ranges from 0.1x to 100x.
- A picture-in-picture video plays at 25 % to 200 % in the panel (the model accepts 0.1 to 4).

**Layers and text**

- Overlays and areas have no keyframes: each keeps its position and size for its whole length.
- Overlay and text rasters are capped at 4096 px per side; the output at 8192 px.
- Text in an export can only use the fonts bundled for the export worker (`src/ui/fontUrls.ts`); emoji typed into a text item use the system emoji font, so they look different per system.
- The gallery offers 128 picture stickers and 13 plain shapes; 60 of the pictures also have an animation (animated by default when added, switch per item). Pictures have no colour or outline. Older vector and emoji stickers still render but are no longer offered.
- An animated sticker is always a whole number of loops long (about 1 to 4 s each) and ends before the video end by less than one loop; an animation sheet is about 100 kB and is loaded the first time it is needed. Offline and not loaded before, the still picture is shown instead.
- A "mirrored edges" background is not part of version 1.

**Files, storage and browsers**

- Work folder and the open and save dialogs use the File System Access API (Chromium browsers). Elsewhere, files are downloaded and uploaded.
- Project files with a newer version than this build are refused.
- The autosave lives in the browser's IndexedDB of that browser profile; clearing site data removes it. Demo sessions never autosave.
- Recording depends on the browser's `MediaRecorder` formats; a browser without a supported format shows an error.
- GIF export refuses projects that are too long or too large before it starts.
- The sources guide and the licence list must be reviewed by hand before every release ([`sources-review.md`](sources-review.md)).
