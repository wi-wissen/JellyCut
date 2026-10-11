# Decisions

## Fit mode with blurred background (F-01)

When a clip is shown with "Fit" (the whole picture visible, bars where the aspect ratios differ), the bars are not black. The default project background is `{ type: 'blur' }`.

Rendering rule (same code path for preview and export, inside `drawFrame()`):

1. Draw the current frame scaled to **cover** the whole output (centered, cropped), as the background layer.
2. Blur that layer strongly (large radius relative to the output height, about 4-6 % of the height) and dim it slightly (about 10-15 %), so the foreground stays the focus.
3. Draw the frame again scaled to **fit** on top, sharp, with the clip's own transform (scale, position, rotation, flip) applied.
4. With "Fill" the picture already covers everything, so the background layer is skipped.

Implementation (WebGL2, `Compositor.drawBlurBackground`): the cover layer is copied at 1/8 resolution, blurred with a separable Gaussian (sigma 5 % of the output height), dimmed to 88 % (gain 0.88) and stretched back up. This is cheap enough for real-time preview and export.

Background options in the UI: "Blur" (default) and "Colour" (a colour picker; `{ type: 'color', color }`). A third option "Mirrored edges" is possible later and is not part of V1.

The background belongs to the project format (one choice for the whole project), not to single clips.

## Freeze frame (L-05, standbild)

- A freeze frame is a normal video clip with `still: <source time>` (src/core/project/types.ts). It shows that one frame for its whole length, so the frame and the video asset stay the same and no new media file is needed.
- Its length is `srcOut - srcIn` at speed 1, exactly like an image clip; `srcIn/srcOut` only give the length, so trims, splits and ripple work unchanged. Speed is fixed at 1, and the frame has no audio (`muted`, and the audio mixer skips it).
- The picture comes from `sourceTimeAt()` (core/timeline/edit.ts), used by the Scene for preview and export alike. Transitions use the same handle rules as images and need no change.
- "Standbild am Abspielkopf" splits the clip under the playhead and puts a 2 s frame between the halves (at the very start of a clip the frame goes in front of it, without a split); the frame copies the clip's transform and look. It is not a separate frame grab, so no extra decoding or storage is needed.

## Overlays: stickers, shapes and pen strokes (L-03, L-04)

- One list, `project.overlays`, holds three kinds: `sticker`, `shape` (rect, ellipse, arrow) and `stroke`. All share start, duration, anchor (`pos`), `scale` and `rotation`. The unused `stickers` and `drawings` lists stay as placeholders.
- Superseded in part: stickers were emoji at this step, drawn with the system emoji font. They are now vector shapes (Overlays 3) and, in the gallery, Fluent Emoji pictures (Picture stickers). Emoji stickers in old files still load.
- Lengths are fractions of the output height. Positions are fractions of the output. Preview and export use the same box (`core/render/overlayLayout.ts`), so the player's handles match the pixels.
- A stroke stores its points relative to its own bounding-box centre, in height units. It keeps its shape when the format changes.
- Each item is rasterised to a 2D canvas (as text is) and composited in WebGL. Superseded by Overlays 5: items are composited in list order, interleaved with the areas. The texture cache is limited by count and by pixels, since a stroke's box can cover the whole picture.
- The project version stays 1. The `overlays` list has existed since version 1 and was always empty, so no migration is needed. New items are validated strictly.
- Drawing mode is a tab state: leaving the pen tab ends it (Design tabs: it stays on after each stroke until Done). Pen colour and width are not part of the project and are not undoable. Each finished stroke is one undo step.
- Blur and pixelate areas, pictures and videos and the animations are in the next section.

## Overlays 2: opacity, animations, blur areas, pictures and videos (L-02, L-03, L-04)

- **Opacity** (all kinds): `opacity` 0..1, absent means 1. The drawn alpha is opacity times the animation alpha.
- **Entrance, exit and loop animations** (all kinds): see Overlays 3 below (directions). `loop` is `wiggle` or absent. The in and out states come from the same function as text (`spanState` in core/render/scene.ts; default length 400 ms, halved for short items). The wiggle swings the rotation by 8 degrees with a period of 0.9 s, for the whole time the item is on screen. Animations are pure scene data, so preview and export show the same frame.
- **Blur and pixelate areas** (`kind: 'region'`, L-04): a rectangle or ellipse (`shape`) with `effect` `blur` or `pixelate` and `strength` 0..1. Each area works on the picture below it in the stacking order (see Overlays 5: it is no longer a post-process of the video alone). Blur is a Gaussian on the 1/8-size copy (the same method as the background); sigma is `(0.004 + 0.06 * strength)` of the output height. Pixelate averages a 4 x 4 grid of samples per cell; cell size is `(0.008 + 0.08 * strength)` of the output height. Both run in the same `Compositor.draw()` for preview and export. No keyframes: an area keeps its position for its whole length.
- **Pictures and videos** (`kind: 'media'`, L-02): an image or video of the library, placed like a sticker (`pos`, `scale`, `rotation`, `opacity`). The box is `width` x `height` (fractions of the output height) and the picture is cropped to fill it. `radius` gives rounded corners and `border` / `borderColor` a border inside the edge. Frames come from `ExactFrameProvider` (paused preview and export, shared through `engine/render/sceneFrames.ts`). Playing uses one muted `<video>` element per picture, driven like the clips.
- **Sound of a video picture is never mixed in.** The audio planner and the mixer only know clips and music, so the sound of a picture stays out of the export and the preview. The panel says so. A picture that shows a video keeps its frame after the end of the video.
- Overlays never change the export duration or the transitions planner. Superseded for texts: texts no longer set the length either; see "Overlays end with the video" (only clips set it).
- Removing an asset removes the pictures that show it, in the same undo step. Asset cleanup and the removal prompt count pictures as use, so their source files are kept.
- The project version stays 1. All new fields are optional, so existing files load unchanged and need no migration. The schema validates the new fields strictly, like the old ones.

## Overlays 3: vector stickers, directions, layer order, marker, picture timing (L-02, L-03, L-04)

- **Animations have a direction.** `animIn` is one of `fade`, `pop`, `slideFromTop|Bottom|Left|Right` (entrance); `animOut` is `fade`, `pop`, `slideToTop|Bottom|Left|Right` (exit). The name says what happens: "from top" comes in from above, "to top" leaves upwards. Texts and overlays share the same names (core/render/animations.ts). The legacy `slideUp` is renamed on load (`migrateProject`, every version): in = from bottom, out = to bottom, which is what it played before.
- **Vector stickers** (the gallery now offers picture stickers first, see Picture stickers). `kind: 'sticker'` has either `shape` + `color` + `outline` (the built-in set in core/render/stickerShapes.ts, drawn with Path2D, the same on every OS) or the legacy `emoji`, which stays valid. Emoji are still possible through the Text tool (they are text there, drawn with the system font).
- **Regions are a tool, not a sticker.** The data stays `kind: 'region'` (saved files are unchanged); the UI gives them their own tool tab. Shapes: `rect`, `ellipse`, `roundRect` (corner `radius`), and `rotation` as for every item.
- **Stacking.** `project.overlays` is back to front: a later item is drawn on top of an earlier one. Texts are always drawn above all overlays. The timeline row packing (`packRows`) is display only and never changes the order. Ops: `bringForward`, `sendBackward`, `bringToFront`, `sendToBack` (one step swaps with the neighbour in the list). Each is one undo step.
- **Pen opacity and marker.** A stroke may have `opacity` (absent means 1) and `cap: 'flat'`. Its opacity is applied to the whole stroke, which is one path rasterised once, so overlapping parts of one stroke do not darken. The marker preset ('Textmarker') is a wide, flat-ended, yellow stroke at 40 % opacity.
- **Pictures in the picture.** `srcIn` (start in the asset, microseconds) and `speed` (the model accepts 0.1 to 4, absent means 1; the panel offers 25 % to 200 %). The scene's `srcTime` is `srcIn + elapsed * speed`, held at the last frame. Preview and export use the same value. The item's length on the timeline does not change.
- The project version stays 1. All new fields are optional; the schema validates them strictly.

## Design tabs: one way to work with every item (UI)

- Creating an item selects it, and its settings replace the tab's gallery in the same place. Every item has the same sections in the same order: Content, Look, Timing, Animation, Order, Actions. Text uses the same sections; its Order section only says that text is always on top.
- Positions are never typed. Items move by dragging in the preview (guides for centre, thirds and quarters stay) or with the arrow keys (Shift for bigger steps). Size and turning are done with the handles.
- The pen stays on after each stroke until Done (or until another tab opens). Strokes are selected like other items after Done.
- Picture-in-picture shapes are presets: Square, Rounded and Round (a circle of the centre square, radius at half the box). Rounded blur or pixelate areas are rounded in the shader too.
- The timeline keeps overlay rows compact on a mouse (28 px). Overlaps beyond four rows share a last row; the selected bar is drawn on top.

## Picture stickers: Fluent Emoji 3D (Overlays 4)

- **Choice: Microsoft Fluent Emoji, 3D style** (github.com/microsoft/fluentui-emoji, MIT, "Copyright (c) Microsoft Corporation"). Obligation: keep the copyright and permission notice with copies, so `src/assets/stickers/LICENSE-FluentEmoji.txt` ships in the repo and the tech help page credits it (name and licence as links). No credit is needed inside exported videos, no ShareAlike.
- **Rejected:** OpenMoji (CC BY-SA 4.0: ShareAlike on adaptations, and its FAQ asks for a credit in videos), Twemoji (CC BY 4.0 would work but needs a credit line, flatter look), Noto Emoji (Apache 2.0/OFL, plain blobs look), Kenney (CC0 emotes and animal packs: licence ideal, but small, game-style sets without the breadth of categories), Phosphor/Tabler (MIT icons, no colour). The Fluent "Color"/"Flat" SVGs are cleaner but less cute; 3D is colourful, soft and reads on light and dark video.
- **Files:** (superseded in part: 128 stickers now, see "Animated stickers") 88 stickers at 256 x 256, converted PNG to lossy WebP (q88, alpha kept) because 256-colour PNG banded visibly and the original PNGs are about 40 kB each (3.5 MB); now about 0.5 MB in total, precached by the service worker (adds that much to the first install). Skin-tone-less (yellow default) hands only; the id to Fluent folder mapping is in `src/assets/stickers/SOURCES.txt`.
- **Model:** `StickerOverlay.imageId` (catalog id, `core/render/stickerImages.ts`) is a third variant of a sticker, next to `emoji` and `shape` (exactly one of the three is set); ids never change; no migration. The engine decodes with fetch + `createImageBitmap` (works in the export worker) and `sceneFrames` waits for them, so paused preview and export frames are complete. Picture stickers have no colour or outline. The 13 plain shapes (star, heart, check, cross, arrows, bubbles, !, ?, badges) stay in the gallery's 'Formen' tab because they take a colour; the other vector shapes are no longer offered but still render in old projects.

## Overlays 5: true stacking order for blur and pixelate areas (replaces "areas only affect the video")

- **Regions are layers, not a post-process.** `Scene.overlays` is one list in project order (back to front) with every kind in it, regions included. The compositor walks it in that order: stickers, shapes, strokes and pictures are drawn onto the picture composed so far; a region blurs or pixelates everything composed so far (video and the overlays lower in the list) inside its shape.
- What is higher in the list is drawn on top of the area and stays sharp; what is lower is processed with the video. "Bring to front" / "send to back" therefore change the picture, for areas as for every other kind. Texts are still always on top of everything and are never blurred.
- Technique: with at least one region the picture is built in two off-screen pages that swap roles (a region reads one and writes the other, never the same). The last region writes to the screen and the overlays above it are drawn there. Without a region nothing is drawn off screen, as before.
- Preview (playing and paused) and export share `Compositor.draw()` and the scene, so the order rule is the same everywhere; `scripts/e2e-zorder.mjs` measures it (sticker above / below an area, reorder, blur and pixelate, picture-in-picture next to both, preview and exported frame).
- Old files keep their list order, so a region that was the last item now also covers the stickers below it. No migration and no schema change.

## Overlays end with the video

- The video ends where the last video or picture clip ends (planned, transitions included; `videoEnd()` in core/timeline/fit.ts). Music, texts and overlays never set the end. Export length is the clips only.
- Overlay, text and music items never extend past that end: a new item starts at the playhead (at most 0.5 s before the end) and ends there at the latest; a move stops flush at the end and keeps its length; a trim stops at the end.
- Whenever the video changes (delete, trim, split, speed, transitions, undo of those), `fitToVideo()` shortens items that reach past the end and moves items that start after it so they end there. It runs in `commitProject` and when a project is opened or restored, and it returns the same object when nothing changes.
- Without clips nothing is clamped, so a title can be added first. Undo returns the pre-change project, so the lengths come back with the clip.
- Music is included: imported music and own recordings end with the video too. A music item is shortened by its end (`srcOut`); its start in the file (`srcIn`) stays, so the first part of the audio plays and the fades follow the new end.
- Why shortening and not muting: a muted item would keep playing its silent length and could not fade out at the video end; a shortened one keeps its fades and its bar shows the real length, as a cut-off item does.
- Consequence for export: the length is the clips only (`exportDuration()` in core/export/format.ts). Music can no longer extend the video, so a project with music and no clips has nothing to export.

## Animated stickers: Fluent Emoji animated (Overlays 6)

- **Source and licence.** [microsoft/fluentui-emoji-animated](https://github.com/microsoft/fluentui-emoji-animated), MIT, "Copyright (c) Microsoft Corporation" (`src/assets/stickers-animated/LICENSE-FluentEmojiAnimated.txt`). Pinned commit `daa0365c09795789ed2bc6e8b228c97736cb6669`. The upstream repo stores its 256 x 256 animated PNGs (28 to 73 frames of 42 ms, looping) in Git LFS; we do **not** use LFS. The originals are never committed. `scripts/build-animated-stickers.mjs` (dev time only, not shipped, no dependency: node, curl, python3 with Pillow and numpy) downloads the chosen files through media.githubusercontent.com, samples them and writes the small sheets, `catalogue.json`, `SOURCES.txt` (id to upstream path and commit) and the licence file. No credit is needed inside exported videos (MIT); the technology help page names "Fluent Emoji (animated)" with a link, README and `docs/sources-review.md` list it.
- **Selection by popularity.** Data: the Unicode Consortium's emoji frequency list (https://home.unicode.org/emoji/emoji-frequency/, data labelled 2019 / Unicode 12.0, ranked by the median frequency across several sources; page read on 2026-10-11). It gives a rank and a group per emoji: group g is at most 1/2^g of the frequency of rank 1 (the "frequency" in the table). It is the only public list with a clear provenance that was reachable; it is old, so newer emoji are missing. Steps: (1) map the ranked emoji to the animated set by codepoints (variation selector ignored, default skin tone only): 495 of 1468 have an animation, 67 of the first 76 ranks; (2) drop what does not suit a school app (sexual or suggestive, drugs, alcohol, weapons or violence, offensive gestures, religious or political symbols): 🙏 (6), 😏 (47), 👊 (75) among the first ranks, others further down; (3) drop loops that jump or do not move, measured on the decoded frames at 64 px: the step from the last frame back to the first must be an ordinary step (difference last to first below 3 times the mean frame-to-frame difference) and the mean frame difference must be at least 0.6 of 255: 😘 (9), 💗 (45) and 💓 (50) jump, 💔 (16) hardly moves; (4) the first 60 remain, down to rank 76. The script checks (3) on every build.
- **Our 88 stickers.** 20 of the 43 that have an animation are in the top 60 (their animation replaces the still one when the switch is on, `laugh` included; the style change is accepted). The other 23 stay still-only, among them rainbow (95), star (93), heart with arrow (105), cake (110), wave (139), dog (148) and the fox (690: rare, so no animation). Adding one later: put it in `scripts/animated-stickers.selection.json` and run the script; about 95 kB each.
- **New stickers.** 40 popular animated emoji had no still sticker. Their Fluent 3D picture (microsoft/fluentui-emoji, same commit as before) was converted like the others (256 x 256, WebP q88) so every animated sticker has a still tile and a still fallback. They have German and English labels and sit in the 'Gesichter' category (25; a separate 'Smileys' category was merged into it) or in 'Herzen & Gesten' (13), 'Tiere' (1) and 'Schule & Medien' (1) (the script's selection file names the category of each). The gallery now offers 128 picture stickers; ids never change.
- **Files.** One WebP sprite sheet per animated sticker: at most 48 frames (stride 2 above 48), 128 px cells in a grid of ceil(sqrt(n)) columns, lossy with alpha (q62, alpha q80). Real total: 5.92 MB for 60 sheets (budget 6 MB; 41 to 207 kB each, mean 96 kB). The file name prefix `sticker-anim-` is what the service worker keys on.
- **Model.** `StickerOverlay.animated?: boolean`, valid only with an `imageId` that has an animation (schema, ops and tests); absent means the still picture, so old projects are unchanged and no migration is needed. `OverlayPatch.animated` toggles it (one undo step).
- **Loop semantics.** The catalogue stores per sticker `frames`, `frameMicros` and `loopMicros = frames * frameMicros` in whole microseconds. The frame shown at time t is `floor(((t - start) mod loop) * frames / loop)` in integer arithmetic (`animatedFrameIndex`, `core/render/stickerAnimations.ts`); the scene carries it as `OverlayLayer.frame`, so preview, paused preview and export pick the same cell. An animated sticker's length is always a whole number of loops: 3 loops when added (never fewer than one); a trim, a typed length or a start trim snaps to the nearest count (a start trim keeps the end); a move keeps the length. The video-end invariant (`placeSpan`, `moveSpan`, `fitSpan` in `core/timeline/fit.ts`, now with an optional loop) rounds **down** to whole loops, so the sticker ends a little before the video end and never mid-motion; only when less than one loop fits does it run to the video end. `fitToVideo` also normalises a hand-edited length. Switching the animation on shortens an existing item to whole loops (at least one); switching it off keeps the length. The timeline bar reads "Name · 3 ×".
- **Engine.** One texture per sheet (uploaded once through a 2D canvas, like every overlay; LRU by pixels, 12 M pixels) and a sub-rectangle of texture coordinates per frame, inset by half a texel so filtering never reads the neighbour cell; the same quad and program as still stickers. Cheaper than rasterising the cell into an overlay texture on every frame change. Until the sheet is decoded, or when it cannot be loaded (offline and never cached), the still picture is drawn.
- **Lazy loading.** Sheets are separate files, requested only (1) by a gallery tile that is on screen while 'Animated' is on, (2) when an animated sticker is added, (3) when a project with animated stickers is opened or restored (also undo), (4) awaited by `sceneFrames` before a paused preview frame and every export frame (`loadSceneStickers`). During playback the still picture is shown until the sheet is decoded, so nothing stalls. The asset URLs come from an eager `import.meta.glob(..., { query: '?url' })`, which only yields hashed strings; no sheet is fetched on the first page load (`e2e-animstickers.mjs` checks the request log).
- **Service worker.** Sheets are in `dist` but not in the precache (the first install gains nothing). `serviceWorkerPlugin` injects their list; the worker serves them cache first from a cache of their own (`jellycut-animated-stickers`, not tied to a build because the names carry a content hash, pruned of files a new build no longer has) after the first successful load. Offline and not cached, the request fails and the still picture stays. `e2e-pwa.mjs` checks all of this.
- **UI.** The global 'Animiert' switch of the gallery (and its localStorage key) was dropped. A tap adds a sticker that has an animation as an animated one (3 whole loops); the per-item switch 'Animiert' in the properties turns it off, with a note that the length is whole loops. Tiles with an animation carry a small sparkles badge (a plain `role=img` named 'Animiert', not a play control). A tile plays its animation on mouse hover or keyboard focus (150 ms delay, lazy sheet, one tile at a time, still picture on leave or blur, nothing with "reduce motion"); the tile animation is drawn on a canvas with one shared frame loop.

| Emoji | Rank | Group | Id | Frames | Loop (ms) | kB |
|---|---:|---:|---|---:|---:|---:|
| 😂 | 1 | 0 | `laugh` | 48 | 2016 | 122 |
| ❤️ | 2 | 0 | `heart` | 37 | 3066 | 77 |
| 😍 | 3 | 1 | `heartEyes` | 36 | 3024 | 94 |
| 🤣 | 4 | 1 | `rofl` (new) | 36 | 3024 | 109 |
| 😊 | 5 | 2 | `smile` (new) | 36 | 3024 | 94 |
| 💕 | 7 | 2 | `twoHearts` (new) | 26 | 2142 | 61 |
| 😭 | 8 | 2 | `cry` | 37 | 3066 | 99 |
| 👍 | 10 | 3 | `thumbsUp` | 26 | 2142 | 55 |
| 😅 | 11 | 3 | `sweatSmile` (new) | 37 | 3066 | 104 |
| 👏 | 12 | 3 | `clap` | 28 | 1176 | 76 |
| 😁 | 13 | 3 | `beaming` (new) | 36 | 3024 | 97 |
| 🔥 | 15 | 3 | `fire` | 48 | 2016 | 95 |
| 💖 | 17 | 3 | `sparklingHeart` | 40 | 1680 | 82 |
| 💙 | 18 | 3 | `blueHeart` (new) | 36 | 3024 | 76 |
| 😢 | 19 | 3 | `cryingFace` (new) | 46 | 3864 | 132 |
| 🤔 | 20 | 3 | `thinking` | 37 | 3066 | 106 |
| 😆 | 21 | 3 | `laughSquint` (new) | 36 | 3024 | 101 |
| 🙄 | 22 | 3 | `eyeRoll` (new) | 29 | 2394 | 76 |
| 💪 | 23 | 3 | `muscle` | 36 | 3024 | 89 |
| 😉 | 24 | 3 | `wink` | 28 | 2310 | 81 |
| ☺️ | 25 | 3 | `smilingFace` (new) | 36 | 3024 | 102 |
| 👌 | 26 | 3 | `okHand` | 35 | 2940 | 94 |
| 🤗 | 27 | 3 | `hug` (new) | 37 | 3066 | 109 |
| 💜 | 28 | 4 | `purpleHeart` (new) | 36 | 3024 | 74 |
| 😔 | 29 | 4 | `pensive` (new) | 36 | 3024 | 93 |
| 😎 | 30 | 4 | `cool` | 37 | 3066 | 101 |
| 😇 | 31 | 4 | `halo` (new) | 36 | 3024 | 118 |
| 🤦 | 33 | 4 | `facepalm` (new) | 37 | 3066 | 81 |
| 🎉 | 34 | 4 | `partyPopper` | 31 | 2561 | 93 |
| 💞 | 36 | 4 | `revolvingHearts` (new) | 47 | 1974 | 140 |
| ✌️ | 37 | 4 | `victory` | 37 | 1554 | 89 |
| 🤷 | 39 | 4 | `shrug` (new) | 37 | 3066 | 108 |
| 😱 | 40 | 4 | `scream` | 28 | 2352 | 79 |
| 😌 | 41 | 4 | `relieved` (new) | 37 | 3066 | 98 |
| 🙌 | 43 | 4 | `raisedHands` (new) | 44 | 1848 | 138 |
| 😋 | 44 | 4 | `yum` (new) | 37 | 3066 | 98 |
| 💚 | 46 | 4 | `greenHeart` (new) | 36 | 3024 | 72 |
| 💛 | 48 | 4 | `yellowHeart` (new) | 36 | 3024 | 76 |
| 🙂 | 49 | 4 | `slightSmile` (new) | 37 | 3066 | 92 |
| 🤩 | 51 | 4 | `starStruck` | 36 | 2981 | 107 |
| 😄 | 52 | 4 | `grinEyes` (new) | 36 | 3024 | 98 |
| 😀 | 53 | 4 | `grin` | 28 | 2352 | 78 |
| 🖤 | 54 | 4 | `blackHeart` (new) | 36 | 3024 | 67 |
| 😃 | 55 | 4 | `grinBig` (new) | 36 | 3024 | 101 |
| 💯 | 56 | 4 | `hundred` | 48 | 2016 | 207 |
| 🙈 | 57 | 4 | `seeNoEvil` (new) | 35 | 2940 | 96 |
| 👇 | 58 | 4 | `pointDown` (new) | 47 | 1974 | 100 |
| 🎶 | 59 | 4 | `notes` (new) | 36 | 3024 | 114 |
| 😒 | 60 | 4 | `unamused` (new) | 48 | 4032 | 119 |
| 🤭 | 61 | 4 | `giggle` (new) | 37 | 3066 | 98 |
| ❣️ | 62 | 4 | `heartExclamation` (new) | 36 | 3024 | 71 |
| 😜 | 64 | 5 | `winkTongue` (new) | 28 | 2310 | 82 |
| 👀 | 66 | 5 | `eyes` (new) | 25 | 2058 | 41 |
| 😪 | 67 | 5 | `sleepy` (new) | 36 | 3024 | 96 |
| 🙋 | 70 | 5 | `raiseHand` (new) | 36 | 3024 | 117 |
| 😞 | 71 | 5 | `disappointed` (new) | 46 | 3822 | 116 |
| 😩 | 72 | 5 | `weary` (new) | 37 | 3066 | 96 |
| 😡 | 73 | 5 | `angry` (new) | 36 | 3024 | 102 |
| 🤪 | 74 | 5 | `zany` (new) | 37 | 3066 | 108 |
| ☀️ | 76 | 5 | `sun` | 36 | 3024 | 85 |

The table lists all 60 (rank and group from the Unicode list; frames and loop from the sampled sheet; kB of the sheet). "new" marks the 40 stickers added with this step.

## Stacking from the timeline and sticker categories (Owner feedback, lanes)

- **Lane order is stacking.** `moveOverlayToLane(project, id, row)` (`core/timeline/overlayOps.ts`) uses `packRows` and only the items that overlap in time: dropped into a higher lane the item goes in front of the overlapping items from that lane down, dropped into a lower lane behind the overlapping items down to that lane. The result is the closest reachable lane; one past the last row opens a new lane, the row limit is 4. The context menu (front, forward, backward, to back; disabled at the ends) and Ctrl+] / Ctrl+[ (with Shift: to front / to back) use the existing `stackSelectedOverlay`.
- **Drag.** A vertical or diagonal drag of an overlay bar shows the lane under the pointer (highlight, insertion line, ghost bar) and commits on release together with the time move as one undo step (`overlay-move` key, so it coalesces); Escape (`cancelGesture`) restores the history from before the drag. Touch uses the same 350 ms long press.
- **Selection look.** One ring element per bar (same radius as the bar): 2 px lime inside the edge plus a 2 px contrast ring outside (`--jc-sel-halo`), grips drawn inside; keyboard focus is a violet outer ring. No black inner line.
- **Sticker categories** are a labelled dropdown (listbox, 44 px) with an 'All' entry; searching still spans all categories.

## Recording: record the browser's tracks as they are, measure, and heal (replaces "screen is always re-drawn through a canvas" and the "record my voice" switch)

Owner tests in real browsers: Firefox recorded the screen black and the voice was silent on playback, Edge showed no level at all. Both passed the earlier e2e (Chromium, fake devices), so the design now follows what mature tools do (WebRTC samples `getdisplaymedia`/`getusermedia/record`, MDN "Recording a media element", the Chrome "screen + mic + system sound" recipes) and checks itself.

- **Evidence from Firefox 157 (Playwright, fake devices, `scripts/e2e-record.mjs` with `BROWSER=firefox`):**
  - `canvas.captureStream(0)`: the *track* has no `requestFrame()` in Firefox, only the *stream* has. The old pipeline decided "no requestFrame, the stream captures on every change" - wrong for frame rate 0, so no frame was ever pushed. This is the proven cause of the black Firefox video.
  - A video-only stream recorded with `video/webm;codecs=vp8,opus` (opus announced, no audio track) gives an unplayable file in Firefox. The MIME type now follows the real tracks (`videoOnly` list in `core/record/record.ts`).
  - An `AudioContext` that is not running (suspended) produces digital silence, without any error; a mix through `createMediaStreamDestination` was recorded as silence (peak 1e-34) while the microphone track recorded directly was fine (peak 0.1). A context stays suspended when it is created after the permission prompts (no user gesture) or when the browser has no usable audio output. Headless Firefox without a sound device never runs it at all.
  - Hidden/detached/`display:none` `<video>` elements all drew correctly in Firefox and Chromium (the "black hidden video" hypothesis is not the cause); the helper video is still attached to the page (2 px, nearly transparent) because that is the cheapest insurance.
  - Not reproducible here: the Edge "no level" symptom (the likely candidates are a suspended context or a wrong default input device; the device picker, the pre-recording test and the diagnostics exist to tell which).
- **Direct tracks.** The screen picture is the display track itself, the sound is the microphone track itself. `MediaRecorder` receives `new MediaStream([displayVideo, micAudio])`. Web Audio is used for two things only: the level meter (a dead-end analyser, never part of the recording) and the mix of voice + the share's own sound when the browser provides that sound.
- **Mix with self-healing.** The `AudioContext` is created and resumed synchronously in the click that starts the recording (before the first `await`). Before the mix is used the recorder waits up to 800 ms for state `running`; if it does not, the recording uses the voice alone and says so in a notice and in the details. States are logged (`running@0`).
- **Canvas path is a fallback.** `core/record/strategy.ts` remembers (localStorage `jellycut.record.strategy`) which way to record the screen. A recording with no pictures (`noFrames`: the monitor video never gets a size, or the recorder produced nothing) or a black picture (live samples of a 8x8 downscale each second, plus the decoded first frames of the finished file) switches the next recording to the other way and says so. If the other way fails too, it stays (the content, e.g. protected windows, is the cause), so it never flip-flops. The canvas path uses `requestFrame` on the track or on the stream, and otherwise lets the canvas stream capture every change.
- **The microphone is always part of a recording** (replaces the "record my voice" switch): microphone, camera + microphone, screen + microphone (+ share sound). Refused or missing: the picture is still recorded with a calm notice (camera retries without audio; screen continues). Who does not want the voice mutes the clip afterwards.
- **Microphone picker and test.** A compact "Microphone" dropdown (devices from `enumerateDevices`, labels after the permission, the default marked, the choice remembered in `jellycut.record.microphoneDevice`, a vanished device falls back to the default) with "Test microphone" and a live level that starts by itself where the permission is already granted. The recorder opens the device by `deviceId: {exact}` and retries without it when that fails. A level at digital silence for 3 s shows the "no microphone signal" hint (only while the audio context runs; a suspended context says nothing about the microphone).
- **Post check of the finished file** (`engine/record/postCheck.ts`, same decoder as import/export): peak and RMS of the first 15 s of sound, mean luma of three frames. Peak < 0.003 or no audio track although a source existed -> "no sound" finding on the done panel; all frames black -> "picture is black" finding (and the next recording switches the way). The values go into the copyable "Technical details", which are also shown after successful recordings.
- **Playback and export** need no special case: a clip with its own sound is a normal video clip (`muted: false`, volume 1) played by an unmuted `<video>` element and mixed by the exporter; `e2e-record.mjs` checks the element flags, decoded sound bytes and the exported mix.
- **Test limits.** Chromium cannot show the screen picker headless, so the screen is a stub stream (moving, still, black, never delivering). The Firefox sandbox has no WebGL2 and no sound device: checks that need a running context or the editor preview are skipped there (`SKIP` lines), and the suspended-context path is tested in both browsers.
