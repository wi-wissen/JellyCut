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
