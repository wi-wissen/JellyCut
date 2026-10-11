# Decisions

## Fit mode with blurred background (F-01)

When a clip is shown with "Fit" (the whole picture visible, bars where the aspect ratios differ), the bars are not black. The default project background is `{ type: 'blur' }`.

Rendering rule (same code path for preview and export, inside `drawFrame()`):

1. Draw the current frame scaled to **cover** the whole output (centered, cropped), as the background layer.
2. Blur that layer strongly (large radius relative to the output height, about 4-6 % of the height) and dim it slightly (about 10-15 %), so the foreground stays the focus.
3. Draw the frame again scaled to **fit** on top, sharp, with the clip's own transform (scale, position, rotation, flip) applied.
4. With "Fill" the picture already covers everything, so the background layer is skipped.

Implementation hints (WebGL2): render the cover layer into a small texture (about 1/8 resolution) and blur it with a two-pass Gaussian or a Kawase blur, then upscale; this is cheap enough for real-time preview and export.

Background options in the UI: "Blur" (default) and "Colour" (a colour picker; `{ type: 'color', color }`). A third option "Mirrored edges" is possible later and is not part of V1.

The background belongs to the project format (one choice for the whole project), not to single clips.

## Freeze frame (L-05, standbild)

- A freeze frame is a normal video clip with `still: <source time>` (src/core/project/types.ts). It shows that one frame for its whole length, so the frame and the video asset stay the same and no new media file is needed.
- Its length is `srcOut - srcIn` at speed 1, exactly like an image clip; `srcIn/srcOut` only give the length, so trims, splits and ripple work unchanged. Speed is fixed at 1, and the frame has no audio (`muted`, and the audio mixer skips it).
- The picture comes from `sourceTimeAt()` (core/timeline/edit.ts), used by the Scene for preview and export alike. Transitions use the same handle rules as images and need no change.
- "Standbild am Abspielkopf" splits the clip under the playhead and puts a 2 s frame between the halves; the frame copies the clip's transform and look. It is not a separate frame grab, so no extra decoding or storage is needed.

## Overlays: stickers, shapes and pen strokes (L-03, L-04)

- One list, `project.overlays`, holds three kinds: `sticker`, `shape` (rect, ellipse, arrow) and `stroke`. All share start, duration, anchor (`pos`), `scale` and `rotation`. The unused `stickers` and `drawings` lists stay as placeholders.
- Stickers are emoji, drawn with the system emoji font. No image files and no network, so there is no licence to check. Animated reactions (later L-03 work) are not part of this step.
- Lengths are fractions of the output height. Positions are fractions of the output. Preview and export use the same box (`core/render/overlayLayout.ts`), so the player's handles match the pixels.
- A stroke stores its points relative to its own bounding-box centre, in height units. It keeps its shape when the format changes.
- Each item is rasterised to a 2D canvas (as text is) and composited in WebGL after the clips and before the text. The texture cache is limited by count and by pixels, since a stroke's box can cover the whole picture.
- The project version stays 1. The `overlays` list has existed since version 1 and was always empty, so no migration is needed. New items are validated strictly.
- Drawing mode is a tab state: leaving the pen tab ends it. Pen colour and width are not part of the project and are not undoable. Each finished stroke is one undo step.
- Blur and pixelate areas, pictures and videos and the animations are in the next section.

## Overlays 2: opacity, animations, blur areas, pictures and videos (L-02, L-03, L-04)

- **Opacity** (all kinds): `opacity` 0..1, absent means 1. The drawn alpha is opacity times the animation alpha.
- **Entrance, exit and loop animations** (all kinds): see Overlays 3 below (directions). `loop` is `wiggle` or absent. The in and out states come from the same function as text (`spanState` in core/render/scene.ts; default length 400 ms, halved for short items). The wiggle swings the rotation by 8 degrees with a period of 0.9 s, for the whole time the item is on screen. Animations are pure scene data, so preview and export show the same frame. The wiggle swings the rotation by 8 degrees with a period of 0.9 s, for the whole time the item is on screen. Animations are pure scene data, so preview and export show the same frame.
- **Blur and pixelate areas** (`kind: 'region'`, L-04): a rectangle or ellipse (`shape`) with `effect` `blur` or `pixelate` and `strength` 0..1. Each area works on the picture below it in the stacking order (see Overlays 5: it is no longer a post-process of the video alone). Blur is a Gaussian on the 1/8-size copy (the same method as the background); sigma is `(0.004 + 0.06 * strength)` of the output height. Pixelate averages a 4 x 4 grid of samples per cell; cell size is `(0.008 + 0.08 * strength)` of the output height. Both run in the same `Compositor.draw()` for preview and export. No keyframes: an area keeps its position for its whole length.
- **Pictures and videos** (`kind: 'media'`, L-02): an image or video of the library, placed like a sticker (`pos`, `scale`, `rotation`, `opacity`). The box is `width` x `height` (fractions of the output height) and the picture is cropped to fill it. `radius` gives rounded corners and `border` / `borderColor` a border inside the edge. Frames come from `ExactFrameProvider` (paused preview and export, shared through `engine/render/sceneFrames.ts`). Playing uses one muted `<video>` element per picture, driven like the clips.
- **Sound of a video picture is never mixed in.** The audio planner and the mixer only know clips and music, so the sound of a picture stays out of the export and the preview. The panel says so. A picture that shows a video keeps its frame after the end of the video.
- Overlays never change the export duration or the transitions planner (as before: only the timeline, texts and music set the length).
- Removing an asset removes the pictures that show it, in the same undo step. Asset cleanup and the removal prompt count pictures as use, so their source files are kept.
- The project version stays 1. All new fields are optional, so existing files load unchanged and need no migration. The schema validates the new fields strictly, like the old ones.

## Overlays 3: vector stickers, directions, layer order, marker, picture timing (L-02, L-03, L-04)

- **Animations have a direction.** `animIn` is one of `fade`, `pop`, `slideFromTop|Bottom|Left|Right` (entrance); `animOut` is `fade`, `pop`, `slideToTop|Bottom|Left|Right` (exit). The name says what happens: "from top" comes in from above, "to top" leaves upwards. Texts and overlays share the same names (core/render/animations.ts). The legacy `slideUp` is renamed on load (`migrateProject`, every version): in = from bottom, out = to bottom, which is what it played before.
- **Stickers are vector shapes, not emoji.** `kind: 'sticker'` has either `shape` + `color` + `outline` (the built-in set in core/render/stickerShapes.ts, drawn with Path2D, the same on every OS) or the legacy `emoji`, which stays valid. Emoji are still possible through the Text tool (they are text there, drawn with the system font).
- **Regions are a tool, not a sticker.** The data stays `kind: 'region'` (saved files are unchanged); the UI gives them their own tool tab. Shapes: `rect`, `ellipse`, `roundRect` (corner `radius`), and `rotation` as for every item.
- **Stacking.** `project.overlays` is back to front: a later item is drawn on top of an earlier one. Texts are always drawn above all overlays. The timeline row packing (`packRows`) is display only and never changes the order. Ops: `bringForward`, `sendBackward`, `bringToFront`, `sendToBack` (one step swaps with the neighbour in the list). Each is one undo step.
- **Pen opacity and marker.** A stroke may have `opacity` (absent means 1) and `cap: 'flat'`. Its opacity is applied to the whole stroke, which is one path rasterised once, so overlapping parts of one stroke do not darken. The marker preset ('Textmarker') is a wide, flat-ended, yellow stroke at 40 % opacity.
- **Pictures in the picture.** `srcIn` (start in the asset, microseconds) and `speed` (0.1 to 4, absent means 1). The scene's `srcTime` is `srcIn + elapsed * speed`, held at the last frame. Preview and export use the same value. The item's length on the timeline does not change.
- The project version stays 1. All new fields are optional; the schema validates them strictly.

## Design tabs: one way to work with every item (UI)

- Creating an item selects it, and its settings replace the tab's gallery in the same place. Every item has the same sections in the same order: Content, Look, Timing, Animation, Order, Actions. Text uses the same sections; its Order section only says that text is always on top.
- Positions are never typed. Items move by dragging in the preview (guides for centre, thirds and quarters stay) or with the arrow keys (Shift for bigger steps). Size and turning are done with the handles.
- The pen stays on after each stroke until Done (or until another tab opens). Strokes are selected like other items after Done.
- Picture-in-picture shapes are presets: Square, Rounded and Round (a circle of the centre square, radius at half the box). Rounded blur or pixelate areas are rounded in the shader too.
- The timeline keeps overlay rows compact on a mouse (28 px). Overlaps beyond four rows share a last row; the selected bar is drawn on top.

## Picture stickers: Fluent Emoji 3D (Overlays 4)

- **Choice: Microsoft Fluent Emoji, 3D style** (github.com/microsoft/fluentui-emoji, MIT, "Copyright (c) Microsoft Corporation"; repo still maintained, last commit Aug 2026). Obligation: keep the copyright and permission notice with copies, so `src/assets/stickers/LICENSE-FluentEmoji.txt` ships in the repo and the tech help page credits it (name and licence as links). No credit is needed inside exported videos, no ShareAlike.
- **Rejected:** OpenMoji (CC BY-SA 4.0: ShareAlike on adaptations, and its FAQ asks for a credit in videos), Twemoji (CC BY 4.0 would work but needs a credit line, flatter look), Noto Emoji (Apache 2.0/OFL, plain blobs look), Kenney (CC0 emotes and animal packs: licence ideal, but small, game-style sets without the breadth of categories), Phosphor/Tabler (MIT icons, no colour). The Fluent "Color"/"Flat" SVGs are cleaner but less cute; 3D is colourful, soft and reads on light and dark video.
- **Files:** 88 stickers at 256 x 256, converted PNG to lossy WebP (q88, alpha kept) because 256-colour PNG banded visibly and the original PNGs are about 40 kB each (3.5 MB); now about 0.5 MB in total, precached by the service worker (adds that much to the first install). Skin-tone-less (yellow default) hands only; the id to Fluent folder mapping is in `src/assets/stickers/SOURCES.txt`.
- **Model:** `StickerOverlay.imageId` (catalog id, `core/render/stickerImages.ts`) is a third kind next to `emoji` and `shape`; ids never change; no migration. The engine decodes with fetch + `createImageBitmap` (works in the export worker) and `sceneFrames` waits for them, so paused preview and export frames are complete. Picture stickers have no colour or outline. The 13 plain shapes (star, heart, check, cross, arrows, bubbles, !, ?, badges) stay in the 'Shapes' tab because they take a colour; the other vector shapes are no longer offered but still render in old projects.

## Overlays 5: true stacking order for blur and pixelate areas (replaces "areas only affect the video")

- **Regions are layers, not a post-process.** `Scene.overlays` is one list in project order (back to front) with every kind in it, regions included. The compositor walks it in that order: stickers, shapes, strokes and pictures are drawn onto the picture composed so far; a region blurs or pixelates everything composed so far (video and the overlays lower in the list) inside its shape.
- What is higher in the list is drawn on top of the area and stays sharp; what is lower is processed with the video. "Bring to front" / "send to back" therefore change the picture, for areas as for every other kind. Texts are still always on top of everything and are never blurred.
- Technique: with at least one region the picture is built in two off-screen pages that swap roles (a region reads one and writes the other, never the same). The last region writes to the screen and the overlays above it are drawn there. Without a region nothing is drawn off screen, as before.
- Preview (playing and paused) and export share `Compositor.draw()` and the scene, so the order rule is the same everywhere; `scripts/e2e-zorder.mjs` measures it (sticker above / below an area, reorder, blur and pixelate, picture-in-picture next to both, preview and exported frame).
- Old files keep their list order, so a region that was the last item now also covers the stickers below it. No migration and no schema change.
