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
- **Entrance, exit and loop animations** (all kinds): `animIn` / `animOut` are `fade`, `pop` or `slideUp`, `loop` is `wiggle` or absent. The in and out states come from the same function as text (`spanState` in core/render/scene.ts; default length 400 ms, halved for short items). The wiggle swings the rotation by 8 degrees with a period of 0.9 s, for the whole time the item is on screen. Animations are pure scene data, so preview and export show the same frame.
- **Blur and pixelate areas** (`kind: 'region'`, L-04): a rectangle or ellipse (`shape`) with `effect` `blur` or `pixelate` and `strength` 0..1. Each area works on the picture below it in the compositor, after the clips and the background and before the stickers, pictures and texts. Areas are applied in list order, each to what the previous ones left. Blur is a Gaussian on the 1/8-size copy (the same method as the background); sigma is `(0.004 + 0.06 * strength)` of the output height. Pixelate averages a 4 x 4 grid of samples per cell; cell size is `(0.008 + 0.08 * strength)` of the output height. Both run in the same `Compositor.draw()` for preview and export. No keyframes: an area keeps its position for its whole length.
- **Pictures and videos** (`kind: 'media'`, L-02): an image or video of the library, placed like a sticker (`pos`, `scale`, `rotation`, `opacity`). The box is `width` x `height` (fractions of the output height) and the picture is cropped to fill it. `radius` gives rounded corners and `border` / `borderColor` a border inside the edge. Frames come from `ExactFrameProvider` (paused preview and export, shared through `engine/render/sceneFrames.ts`). Playing uses one muted `<video>` element per picture, driven like the clips.
- **Sound of a video picture is never mixed in.** The audio planner and the mixer only know clips and music, so the sound of a picture stays out of the export and the preview. The panel says so. A picture that shows a video keeps its frame after the end of the video.
- Overlays never change the export duration or the transitions planner (as before: only the timeline, texts and music set the length).
- Removing an asset removes the pictures that show it, in the same undo step. Asset cleanup and the removal prompt count pictures as use, so their source files are kept.
- The project version stays 1. All new fields are optional, so existing files load unchanged and need no migration. The schema validates the new fields strictly, like the old ones.

