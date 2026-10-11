# Performance measurements

Measured by the project owner with the first speed test page. They drive the default values of the export time estimate (`src/core/export/estimate.ts`).

**Test machine:** Windows, Firefox 157, 16 cores, AMD Radeon R9 200 (ANGLE/D3D11), tab in the foreground.
**Reference:** Shotcut exports 3 min of video in about 15 min (factor 0.2). Goal for Jelly Cut: at least that fast, better real time or faster (factor >= 1).
Factor = video length / computing time (above 1 = faster than real time).

## Encoding (export)

Method: synthetic WebGL scene (filter, wipe transition, text), Mediabunny 1.60.0 `CanvasSource` -> H.264 MP4, 20 s, 30 fps, no audio, no decoding.

| Setting | Speed | Factor | 3 min video | Split |
|---|---|---|---|---|
| 1080p H.264 (hardware/auto), 8 Mbit/s | 29 frames/s | 0.97 | about 3:06 | drawing 36 %, encoding 60 % |
| 720p H.264 (hardware/auto), 4 Mbit/s | 58 frames/s | 1.93 | about 1:33 | drawing 35 %, encoding 61 % |

Throughput: about 55-60 megapixels/s (drawing + encoding).

## Decoding (import, preview, export input)

Method: WebCodecs through Mediabunny `CanvasSink`, sequential, output 1280 px wide.

| Source | Speed | Factor |
|---|---|---|
| 1080p, 24 fps, H.264: 347 frames (14.5 s) in 6.0 s | 58 frames/s | 2.40 |
| 4K, H.264 (probably 60 fps): 1010 frames (16.9 s) in 67 s | 15 frames/s | 0.25 |

Throughput: about 120 megapixels/s (both measurements agree).

## Derived (estimates, not measured)

- 3 min 1080p30 -> 1080p30: encoding about 3:06 + decoding about 1:33, about 4:40 when sequential (factor about 0.64).
- 3 min 4K30 -> 1080p: about 9-10 min.

## Invalid, do not use

All other runs of the first series (720p software encoder 12 frames/s, VP9, AV1, 1080p software, first 1080p run): the tab was in the background and Firefox throttles to 1-2 frames/s then. No valid value for VP9, AV1 or software encoders.

## Not measured yet

Chrome/Edge, school PCs, full export with decoding + audio, 4K playback through `<video>`, background tab with a worker, memory with long files, HEVC.

## Note

Firefox in a background tab is 15-30x slower (1-2 instead of 29-58 frames/s). The export therefore runs in a worker (`OffscreenCanvas`); users should still be warned until that is verified in the background.

# Export time model (version 2)

Source files: `src/core/export/costs.ts` (every constant), `src/core/export/estimate.ts` (work per phase),
`src/core/export/calibration.ts` (learning and range), `src/core/export/eta.ts` (progress ETA).
The exporter reports the measured seconds per phase; the dialog shows them under "Details" and learns from them.

## Phases

| Phase | Work | Measured as (exporter) |
|---|---|---|
| decode | source frames of every clip and every video picture-in-picture | time waiting for `sceneFrames` |
| draw | full-frame passes, texture uploads, overlay quads, one-time rasters, frame overhead | CPU time of `buildScene` and `compositor.draw` (GPU work shows up in encode, the encoder reads the canvas) |
| encode | video encoder, times the codec factor | time waiting for `videoSource.add` |
| audio | mixing and writing audio | time of `writeAudioChunk` |
| fixed | start-up and finishing | `output.start` and `output.finalize` plus the set-up before the first frame |

## Constants

Rates are megapixels per second (MP/s), a full-frame pass costs the output pixels once.

| Constant | Value | Basis |
|---|---|---|
| `DECODE_MP_PER_S` | 120 | measured above (1080p H.264, 58 frames/s) |
| `DRAW_MP_PER_S` | 153 | derived: drawing is 36 % of the 55 MP/s measured for 1080p encoding |
| `ENCODE_MP_PER_S` | 92 | derived: encoding is 60 % of the same 55 MP/s |
| `CODEC_FACTOR` vp9, av1 | 2.5 | guess, applies to encoding only (AVC measured) |
| `UPLOAD_MP_PER_S` | 400 | guess: texture upload of each decoded frame |
| `RASTER_MP_PER_S` | 40 | guess: rasterising a sticker, shape or stroke once |
| `BLUR_BACKGROUND_PASSES` | 1 + 3/64 | from the compositor: 1/8 size copy, two blur passes at 1/8 size (1/64 of the area each), one stretch |
| `GRADE_PASSES` | 0.1 | guess: a colour grade on a picture |
| `BLEND_PASSES` | 1 | one blend pass while a transition runs |
| `REGION_PASSES` | 2 (+ 3/64 for blur) | copy and region pass; blur adds the 1/8 size copies |
| `DRAW_CALL_SECONDS` | 0.0002 | guess: one textured quad, per drawn item and frame |
| `FRAME_OVERHEAD_SECONDS` | 0.001 | guess: JavaScript loop and GPU synchronisation, per output frame |
| `TEXT_RASTER_SECONDS` | 0.005 | guess: rasterising one text item once |
| `AUDIO_SECONDS_PER_SECOND` | 0.02 | guess (existing) |
| `STARTUP_SECONDS` | 1.5 | guess (existing) |
| `GIF_READBACK_MP_PER_S` | 25 | guess (existing GIF rate for drawing and reading back) |
| `GIF_ENCODE_MP_PER_S` | 8 | guess (existing GIF quantising rate) |

Only the first three rows (decode, and the derived draw and encode shares) come from measurements; everything else is a guess
until the calibration of a real computer corrects it.

## How the work is counted

Every cost is attached to the time span where it happens (rates per second of timeline, times the time on screen):

- Video clip: decode `w*h*fps_src*speed / DECODE`, upload `w*h*min(fps_src*speed, fps) / UPLOAD`, draw passes of the picture (1, plus the blur background when the project has one, plus a grade when there is a filter or adjustment). Speed changes the rate, so a 2x clip decodes twice as much per second of timeline and lasts half as long: the total equals the source range.
- Still frame and image clip: decoded and uploaded once.
- Transition: both clips are on screen, so both decode; the blend adds `BLEND_PASSES` while it runs.
- Blur or pixelate region: `REGION_PASSES` while it is on screen (blur adds the copies).
- Picture-in-picture video: decode and upload of its own source for the time it plays from `srcIn` at its speed; no decoding after the source ends (the last frame is held).
- Picture-in-picture image: decoded and uploaded once.
- Sticker, shape, stroke: one draw call per frame, a one-time raster of its box. Text: one draw call per frame and `TEXT_RASTER_SECONDS` once.
- Per output frame: encode of the frame times the codec factor (MP4) or read-back and quantising (GIF), and `FRAME_OVERHEAD_SECONDS`.
- Audio, and the start-up once.

Estimated time: `decode*f_decode + draw*f_draw + (encode + audio + fixed)*f_encode`. The factors start at 1.

## Calibration

One entry per codec family (AVC, or software for VP9 and AV1) and feature class (plain, or with a video picture over the video). After each MP4 export the three factors move towards measured/predicted of their phase group (decode; draw; encode with audio and fixed). The weight of the new sample is `max(0.3, 1/(n+1))` with `n` the earlier samples, factors are kept between 0.1 and 10, phase groups with less than 0.25 s predicted are not learned from, and exports shorter than 3 s measured are ignored.

A class without its own sample borrows the factors of the family's best-known class, with `n = 0`. The calibration hint in the dialog disappears once any class of the active family has a sample.

GIF: one speed factor (same rule with weight 0.5) and the size per pixel and frame, as before.

## Range (uncertainty)

The dialog shows `[t / (1+u), t * (1+u)]` rounded outwards to whole steps (5 s below a minute, half minutes below ten minutes, whole minutes above). `u = max(0.1, 0.5 / sqrt(n+1))`: 50 % with no sample, about 35 % after one export, 25 % after three, 10 % from about 25 exports on. When both ends round to the same step a single value is shown.

## Progress ETA

The work per output frame comes from the same model, so a slow section later on (overlays, transitions) counts when it arrives. Remaining work divided by an exponential average of the throughput (time constant 3 s) gives the remaining time. The value counts down between updates and only replaces the shown value when the new one differs by more than the larger of 1 s and 15 %. It appears after 15 frames.

## Validation status

Only the test Chromium of this repository was available, which decodes VP9, AV1, Opus and not H.264 or AAC. Its runs are useful for the code paths and for the pixel-exact checks; they say nothing about the owner's school PCs. The owner's example (11 s project with a picture-in-picture video, estimated about 50 s, took about 80 s) is not reproduced here. After one export on a computer the factors learn that machine's speed; the range narrows with each export.
