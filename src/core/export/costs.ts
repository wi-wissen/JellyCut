/**
 * Cost constants of the export time model. Each value is explained in docs/performance.md.
 * Rates are megapixels per second; "passes" are full-frame GPU passes.
 */

/** Decoding source video, measured on the owner's PC (1080p H.264). */
export const DECODE_MP_PER_S = 120
/** One full-frame draw pass: derived from the drawing share (36 %) of the 1080p measurement at 55 MP/s. */
export const DRAW_MP_PER_S = 153
/** Hardware H.264 encoding: derived from the encoding share (60 %) of the same measurement. */
export const ENCODE_MP_PER_S = 92
/** Uploading decoded source frames as textures. Not measured. */
export const UPLOAD_MP_PER_S = 400
/** Rasterising and uploading one overlay (sticker, shape, stroke) once. Not measured. */
export const RASTER_MP_PER_S = 40
/** GIF: reading each frame back from the GPU (getImageData). Not measured. */
export const GIF_READBACK_MP_PER_S = 25
/** GIF: colour quantisation and LZW writing per frame. Not measured. */
export const GIF_ENCODE_MP_PER_S = 8

/** Software encoders (VP9, AV1) multiply the encoding part only. Only AVC was measured. */
export const CODEC_FACTOR = { avc: 1, vp9: 2.5, av1: 2.5 } as const
export type EstimateCodec = keyof typeof CODEC_FACTOR

/** Fit-blur background: a 1/8 size copy (1/64 of the area), two blur passes at that size and one stretch. */
export const BLUR_BACKGROUND_PASSES = 1 + 3 / 64
/** A colour grade (filter or adjustment) on a picture: extra shader work. Not measured. */
export const GRADE_PASSES = 0.1
/** A transition blends two pictures: one more full-frame pass while it runs. */
export const BLEND_PASSES = 1
/** A blur or pixelate region: copy plus region pass. */
export const REGION_PASSES = 2
/** A blur region adds the 1/8 size blur copies (1/64 of the area each, three passes). */
export const REGION_BLUR_PASSES = 3 / 64

/** Per drawn item and frame: one textured quad. Not measured. */
export const DRAW_CALL_SECONDS = 0.0002
/** Per output frame: JavaScript loop and GPU synchronisation. Not measured. */
export const FRAME_OVERHEAD_SECONDS = 0.001
/** Audio mixing and writing, per second of export. Not measured. */
export const AUDIO_SECONDS_PER_SECOND = 0.02
/** Start-up (muxer, first frame) and finishing. Not measured. */
export const STARTUP_SECONDS = 1.5
/** Rasterising one text item once. Not measured. */
export const TEXT_RASTER_SECONDS = 0.005

/** Assets without a known size or frame rate are assumed to be full HD at 30 fps. */
export const DEFAULT_WIDTH = 1920
export const DEFAULT_HEIGHT = 1080
export const DEFAULT_FPS = 30
