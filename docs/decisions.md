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
