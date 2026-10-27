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

## Paused picture of recorded clips was black (MediaRecorder WebM), and the safety net

Owner test in real Firefox: clips recorded in the app played, but the paused preview turned black.

- **Proven cause (reproduced with real Firefox 157 and Chromium recordings, `tests/fixtures/recorded-*.webm`).** MediaRecorder WebM (the Record tab asks for a 1 s timeslice) has no cues, a cluster per second and a single keyframe at the start. Mediabunny 1.60 remembers where clusters start; once a lookup has read a cluster that holds no keyframe, a later `getKeyPacket` for a time inside it starts there and answers "none". `CanvasSink.getCanvas` calls `getPacket` first (which reads and remembers the cluster of the wanted time) and `getKeyPacket` second, so the first lookup after the first second already fails and every following one too. `ExactFrameProvider.getFrame` returned null, `sceneFrames` left the clip out and the compositor drew black. Playback uses `<video>` elements and was fine. The same null reached the export (black exported frames), the thumbnail and the fine cut (`KeyframeIndex.before` answered null).
- **Fix.** `ExactFrameProvider.decode` falls back to the list of keyframe times (read once from packet headers, `readKeyTimes`) and decodes forward from the last keyframe at or before the time through `CanvasSink.canvases(keyTime)`: asking for the exact time of a known keyframe works. The decoder run is kept, so stepping through a long keyframe-less stretch decodes each frame once (the export of such a clip is not quadratic). *Superseded by "Fine cut of recordings was slow" below: the fallback now runs through `SparseReader` with caches.* `KeyframeIndex` uses the same list when its search comes back empty. Normal files never take this path (`provider.rescues.fromKeyframe` counts the lookups that did).
- **Smaller quirks found in the same files, also handled** (`core/media/frameLookup.ts`): a first frame later than 0 (the lookup never goes before the first frame, so the clip start is not black); a frame duration of 0 on the last block of every cluster (the span now ends at the next frame, so `getFrameInfo` and the fine cut see real spans); a repeated timestamp at the start (Firefox).
- **Safety net.** If the exact path returns nothing, throws, or returns a black picture while the media element has a real one, the paused preview and the two big fine cut frames draw the frame of the clip's `<video>` element (seek, wait for `seeked` and the next presented frame). The black check (16 x 16 sample) runs only until the first non-black exact picture of an asset or three black ones, and the element is only compared in that case, so the normal path pays one tiny read per asset. A real black frame (fade, title card) stays as it is because the element is black too. The fallback is logged once per asset with `console.warn`, listed in `PreviewEngine.elementFallbackAssets` and on the canvas as `data-paused-fallback="<asset ids>"` (fine cut frame: `data-fallback="element"`). The export has no safety net on purpose: it keeps the exact path and its errors. The fine cut strip (small tiles) has none either; a failed tile stays empty.
- **Limit of the safety net.** In Firefox 157 and in Chromium the media element of these files does not seek reliably (Firefox shows a stale picture or stops at readyState 1 for times after the first second; Chromium sometimes fails with "demuxer seek failed", after which the element is replaced). The exact path is the real fix; the element is only a last resort.
- Not changed: the Record tab post check (`postCheck.ts`) still uses `getCanvas` directly and may skip frames of such files; it only needs a few of them.

## Recordings are kept in the browser (private storage), and why media looked "missing" after an export

Owner report (real Firefox desktop): a screen clip recorded in the app, placed on the timeline, cut in the fine cut and exported showed up as missing afterwards, and re-linking could not work (no File System Access API, and the recording never existed as a file).

- **How media becomes "missing".** `MediaStatus` has no value outside `markMissingFor` and `statusOf` (a missing entry reads as `'missing'`). `markMissingFor` runs only when a document replaces the open one (`replaceDocument`: New project, Open project) and when the autosave is restored at page start. The `File` objects live in a module map of the media store (`files`), not in Pinia state, so history snapshots, JSON copies of the project and the export's project clone cannot lose them. A page load empties that map, so after any reload every imported file has to be re-linked by design.
- **What was checked and ruled out inside one session** (`scripts/e2e-persist.mjs`, section A, Chromium; Firefox where the sandbox can encode): record 2 s, place, open the fine cut, step, cut, close it, export through the download path. Status stays `ready`, `getAssetFile` returns a File of the same size, no re-link dialog. The export store (`missingNames`, `start`, `deliver`), the export client (the worker gets a copy of the File through `postMessage`, nothing is transferred or detached), the download anchor (object URL revoked after 60 s, it is the export blob, not the asset), `reconcileWith` (only acts on assets that left the project) and the update toast (`controllerchange` reloads only after the user clicked "Reload") do not touch asset files or status.
- **Conclusion.** Nothing in the editing or export flow turns an asset into a missing one. The only ways to the owner's picture are a page load (F5, the update toast, a content process crash and session restore, the tab being discarded, leaving the editor for a help page and coming back, a second tab) or New/Open project. This was not reproduced as an in-session event; it is not proven which of these happened. For imported files a reload needs a re-link (the originals exist). For recordings it was data loss, hence the change below.
- **Decision: recordings and example videos are kept in IndexedDB.** A new object store `media` in the existing `jellycut` database (version 2, `src/platform/localStore.ts`), behind the small interface `MediaStore` in `src/platform/mediaStore.ts` (`put`, `get`, `delete`, `list`; an in-memory fake for tests). Blobs in IndexedDB are kept on disk by Firefox, Chromium and Safari; the Origin Private File System was not chosen because writing OPFS files on the main thread is not available everywhere (Safari). Nothing is uploaded.
- **Project model.** `Asset.origin` (`'recording' | 'example'`) and `Asset.storeKey` (random, 8 to 64 URL-safe characters) are optional, validated in the schema, no version bump (older files stay valid and unchanged). They are written at import time (`importFiles` option `origin`), so adding the asset is still one undo step.
- **One place to persist.** The record store's `afterImport(assetId)` (called after the import and the file check) writes the copy; the example video store does the same. Anything that changes the recorded file later (the planned "optimize recording" step) must run before `afterImport`.
- **Restore.** `restoreAutosave` and `replaceDocument` call `restoreStored`: assets with a `storeKey` are loaded from the storage and are `ready` at once; the re-link dialog does not open for them. A key this browser does not have (project file from another computer, cleared site data) joins the re-link list with the note "This recording was only stored in the other browser" and the tile says "Recording not found any more". Re-linking such a recording by file stores it again.
- **Hygiene.** Persistent storage is requested once per browser after the first copy (`navigator.storage.persist()`, a denial is remembered, never repeated). The project menu shows the size of the stored copies, its tooltip says whether the browser promised to keep them. Copies are deleted when the asset leaves the undo cache (limit 20, `RemovedMediaCache.put` returns what fell out), when New/Open project replaces the document (keys the new project uses stay), and, at startup, copies older than a day that no project refers to are swept. New/Open project asks first when the project has stored recordings (also when it was saved as a file, because the file does not contain the recording). A full storage (`QuotaExceededError`) or an unavailable one keeps the recording in memory, says so on the Record panel and offers "Save recording as a file". The done panel always offers a small "Save a copy as a file".
- **Limits per browser.** Quotas are per origin and decided by the browser: Chromium and Edge allow a large share of free disk space, Firefox about 10 % of the disk (group limit up to 2 GB for a site without persistence, more with it), Safari is the strictest (about 1 GB, and storage of sites not used for 7 days can be cleared unless the app is added to the Dock/Home Screen). Private windows may refuse the write: handled as "unavailable". Clearing site data deletes the copies.
- **Re-link without pickers.** The dialog only uses a plain `<input type="file" multiple>` and drag and drop (matched by name and size, or size and length); the folder button is hidden without `showDirectoryPicker`. `e2e-relink.mjs` scenario 7 runs with all three pickers removed.

## Fine cut of recordings was slow (keyframe-sparse files), and the one-time optimisation

Owner test in real Firefox: opening the fine cut on a recording of about 30 s took roughly half a minute, normal videos open quickly. Cause: after the fix above every lookup in such a file (one keyframe at the start) decoded from the first keyframe up to the wanted frame, and converted every frame on the way to a full-size canvas. The fine cut asks for about 130 strip pictures and two big ones, backwards as well as forwards, so each request decoded up to hundreds of frames again. Measured in the test Chromium (30 s, 1280 x 720, 723 pictures, one keyframe, `scripts/e2e-finecut-recorded.mjs`): decoding alone costs about 5 to 6 ms per frame, converting a frame to a full-size canvas about 9 ms more.

Two measures. A makes any such file fast to reach; B makes new recordings ordinary files.

**A. Reading keyframe-sparse files (`engine/media/sparseReader.ts`, `core/media/scanPlan.ts`, `core/media/timedCache.ts`).**
- *Which files.* `ExactFrameProvider.isSparse` asks the demuxer for the keyframe before a lookup (a metadata read); no keyframe or one more than 1.5 s back marks the file as sparse for good, and the demuxer's own failure on the file marks it too (the old fallback condition). Files with ordinary keyframes never take this path.
- *Forward passes, not seeks.* The reader decodes with `VideoSampleSink` (no canvas per frame) and only converts what the caches want: a thumbnail (longest side 160 px) of every frame near the wanted window and a sparse one every 0.5 s elsewhere, and full-size frames for the two big pictures plus a margin (600 ms or 8 pictures behind, three ahead, one second before a plain lookup). The pass keeps the frames' real spans (the next frame's start for the zero-length last block of a cluster).
- *Caches, bounded.* A byte-bounded LRU keyed by time span per asset (`TimedCache`): full-size frames 96 MB, thumbnails 40 MB, for all assets together (about 136 MB, the budget was 150 MB). The newest entry always stays; evicted canvases are simply dropped. `cacheStats()` reports bytes, frames, decoder positions and decoded frames (the e2e checks them).
- *Several positions.* Each asset keeps up to three decoder runs (a run is a decoder iterator and its position). A lookup continues the run closest behind it, else starts one at the keyframe and closes the oldest. All work on one asset is serialised, so two callers never decode the same stretch twice (before, every lane had its own decoder).
- *Fine cut.* `fineCut.prepare()` (on open and after each move) calls `provider.warm()` with the window of the cut: thumbnails of 64 pictures to each side, full-size frames of the two big pictures. One pass: first to the big pictures (a run stops right behind them), then on to the thumbnails ahead, then a background run is put behind the pictures (discards frames, gives way to any waiting request) so the next step forward continues from there. A lookup inside the window of a pending `warm` runs that pass, so the big frames and the strip never decode the same stretch twice. The strip takes its tiles from the thumbnail cache and never decodes a single picture of such a file; the big frames show the cache's thumbnail at once (`data-preview="thumb"`) and the exact picture when it is there. The progress of the pass is shown ("Preparing the recording … 40 %").
- *Not in a worker.* Decoding runs in the browser's decoder thread; the main thread only copies the wanted frames into canvases. Moving the whole reader into a worker was left out: the frames would have to be sent back as bitmaps, which costs about what the copy costs.
- *Measured (test Chromium, 30 s, 720p, one keyframe)*: before, the fine cut at 0.5 s / 15 s / 28 s needed 7.5 s / 95 s / more than 120 s, counted from the playhead move. After: 2.2 s / 2.3 s / 3.6 s from the playhead move (this includes decoding to the playhead for the paused preview, about 5 ms per picture, which is the floor of this CPU), and 1.4 s / 0.5 s / 0.7 s from the click on "Fine cut" once the preview shows its picture (the preview's pass leaves dense thumbnails behind). A step of one picture takes 40 to 150 ms; a jump back out of the kept margin needs one new pass.
- *Limit.* Reaching a frame at time t of such a file costs at least t times the decode time per picture the first time. Only B removes that.

**B. One-time optimisation of recordings (`engine/record/optimize.ts`, `core/record/optimize.ts`).**
- *What.* After the import the record store runs `optimizeRecording(file, { onProgress, signal })` in the background; the clip can be placed and cut with the raw file meanwhile. The picture is decoded and encoded again with a keyframe every second (`VideoSampleSource`, `keyFrameInterval: 1`), at about twice the source bitrate (2 to 10 Mbit/s), the sound packets are copied. Timestamps are kept and made strictly increasing. The result is a WebM (MP4 for H.264 sources) with the length and a seek index.
- *Why not `Conversion`.* Mediabunny's `Conversion` (`video: { keyFrameInterval }`) was tried first and drops one picture per cluster of a MediaRecorder file: it skips samples whose duration is 0 as "outside the range", and MediaRecorder writes 0 for the last block of every cluster. The same sample loop is therefore written directly (the duration of a picture is the distance to the next one).
- *Codec.* VP9 first, VP8 as fallback, also for VP8 sources: the test Chromium encodes 720p VP9 in about 10 ms per picture and VP8 in about 80 ms (a 30 s clip takes 5 s instead of 60 s). Skipped: longer than 10 minutes, more than 400 MB expected, no `VideoEncoder`, sound the container cannot hold, files whose keyframes are already dense.
- *Trust.* The result replaces the raw file only if it has the same length (50 ms), the same number of pictures (2 % or 2), a keyframe at least every 1.05 s (more where the pictures themselves are further apart: a slow stretch delays the next keyframe by that gap) and the same mean grey at three early times. Otherwise the raw file stays.
- *Replacing.* `media.replaceFile(assetId, file, previous)`: only if the asset still has `previous`; same asset id, `Asset.size` stays the size of the raw file (so re-linking by the saved copy still matches), the frame provider is rebuilt (caches dropped), the player re-reads the file (not during playback), and the stored copy in the browser is overwritten with the optimised file. "Save a copy as a file" still gives the file as the browser delivered it (`rawRecording` in the record store).
- *Panel.* "Optimizing the recording … 40 %" with a progress bar, a short note and "Skip" (keeps the raw file); the next recording cancels a running optimisation.
- *Cost.* 5.4 s for the 30 s test clip (723 pictures); memory is the file twice.

Not verified here: real Firefox (its WebCodecs `VideoEncoder` and the recorded files differ; the optimisation falls back to the raw file whenever encoding or the check fails).


## Open folder (Chromium)

- *What.* "Open folder…" in the project menu replaces "Choose work folder…". The chosen folder is the work folder as before (saving, re-linking) and is read like a project: one project file (`*.jellycut.json` / `*.jellycut`, top level only) is loaded and its media are linked from the folder by their stored path, then by name and size; several project files ask which to open (`FolderProjectChoice`); none starts a new project named after the folder with all media below it imported (paths relative to the folder). Saving writes the project file back into the folder (the opened file's handle, or `<name>.jellycut.json` for a new project).
- *Why.* Choosing a folder used to change nothing visible; the desktop editors people know open a folder and work in it.
- *Firefox / no directory picker.* Unchanged: "Open project…" and the file picker. The menu item is hidden without `showDirectoryPicker`.
- *Limits.* Media are matched at most 3 folder levels deep and 5000 files (the scan limits of the relink); project files in subfolders are ignored (they belong to other projects). Checked in the test Chromium with the browser's own file system standing in for the dialog (`e2e-openfolder.mjs`); not with a real folder on Windows.
