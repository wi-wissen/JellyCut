import type { FormatRatio, Project } from '../project/types'

export const EXPORT_RESOLUTIONS = [480, 720, 1080] as const
export const EXPORT_FPS = [24, 30, 60] as const
export const EXPORT_QUALITIES = ['good', 'small', 'tiny'] as const

export type ExportResolution = (typeof EXPORT_RESOLUTIONS)[number]
export type ExportFps = (typeof EXPORT_FPS)[number]
export type ExportQuality = (typeof EXPORT_QUALITIES)[number]

export interface ExportOptions {
  resolution: ExportResolution
  fps: ExportFps
  quality: ExportQuality
  format: 'mp4' | 'gif'
}

export const AUDIO_BITRATE = 128_000

const BASE_BITRATE_1080P30: Record<ExportQuality, number> = {
  good: 7_000_000,
  small: 3_500_000,
  tiny: 1_800_000
}

const MIN_VIDEO_BITRATE = 250_000
const REFERENCE_PIXELS = 1920 * 1080
const REFERENCE_FPS = 30
const FPS_EXPONENT = 0.7
const MICROS_PER_SECOND = 1_000_000

/** Nearest even integer, so H.264 accepts the dimensions. */
function nearestEven(x: number): number {
  return 2 * Math.round(x / 2)
}

/** Output dimensions: the resolution is the short side, the long side follows the ratio. */
export function outputSize(ratio: FormatRatio, resolution: ExportResolution): { width: number; height: number } {
  const [wPart = '1', hPart = '1'] = ratio.split(':')
  const a = Number(wPart)
  const b = Number(hPart)
  if (a === b) {
    return { width: resolution, height: resolution }
  }
  const long = nearestEven((resolution * Math.max(a, b)) / Math.min(a, b))
  return a > b ? { width: long, height: resolution } : { width: resolution, height: long }
}

export function videoBitrate(width: number, height: number, fps: number, quality: ExportQuality): number {
  const pixelFactor = (width * height) / REFERENCE_PIXELS
  const fpsFactor = Math.pow(fps / REFERENCE_FPS, FPS_EXPONENT)
  const bitrate = Math.round(BASE_BITRATE_1080P30[quality] * pixelFactor * fpsFactor)
  return Math.max(MIN_VIDEO_BITRATE, bitrate)
}

export function estimateFileSize(options: ExportOptions, ratio: FormatRatio, durationMicros: number): number {
  const { width, height } = outputSize(ratio, options.resolution)
  const bitrate = videoBitrate(width, height, options.fps, options.quality) + AUDIO_BITRATE
  return Math.round((bitrate * durationMicros) / MICROS_PER_SECOND / 8)
}

/** Frame count rounded up, computed in integers so exact multiples get no extra frame. */
export function totalFrames(durationMicros: number, fps: number): number {
  const frames = (BigInt(durationMicros) * BigInt(fps) + BigInt(MICROS_PER_SECOND - 1)) / BigInt(MICROS_PER_SECOND)
  return Number(frames)
}

export function defaultExportOptions(project: Project): ExportOptions {
  let fps: ExportFps = EXPORT_FPS[0]
  let best = Infinity
  for (const candidate of EXPORT_FPS) {
    const distance = Math.abs(candidate - project.format.fps)
    if (distance < best) {
      best = distance
      fps = candidate
    }
  }
  return { resolution: 1080, fps, quality: 'good', format: 'mp4' }
}

export const GIF_WIDTHS = [320, 480, 640] as const
export const GIF_FPS = [10, 15, 20] as const
export type GifWidth = (typeof GIF_WIDTHS)[number]
export type GifFps = (typeof GIF_FPS)[number]

export interface GifOptions {
  format: 'gif'
  /** Output width in pixels; the height follows the project ratio. */
  width: GifWidth
  fps: GifFps
  loop: boolean
}

export function defaultGifOptions(): GifOptions {
  return { format: 'gif', width: 480, fps: 15, loop: true }
}

/** Starting value for GIF size per pixel and frame, before this computer has made a GIF. */
export const GIF_DEFAULT_BYTES_PER_PIXEL = 0.12
/** Above this estimate (decimal megabytes) the GIF export is refused. */
export const GIF_MAX_BYTES = 100_000_000
/** Longer GIFs are refused: they get very large and slow to encode. */
export const GIF_MAX_SECONDS = 60
const GIF_MIN_BYTES_PER_PIXEL = 0.005
const GIF_MAX_BYTES_PER_PIXEL = 2
/** Weight of the newest GIF in the learned size per pixel. */
const GIF_SAMPLE_WEIGHT = 0.5

/** Output dimensions for a GIF: the width is given, the height follows the ratio (no even rounding needed). */
export function gifOutputSize(ratio: FormatRatio, width: number): { width: number; height: number } {
  const [wPart = '1', hPart = '1'] = ratio.split(':')
  const a = Number(wPart)
  const b = Number(hPart)
  return { width, height: Math.max(1, Math.round((width * b) / a)) }
}

/** Estimated GIF size: every frame at its full pixel count times the size per pixel and frame. */
export function estimateGifBytes(width: number, height: number, frames: number, bytesPerPixel = GIF_DEFAULT_BYTES_PER_PIXEL): number {
  if (!(frames > 0) || !(width > 0) || !(height > 0)) return 0
  return Math.round(width * height * frames * bytesPerPixel)
}

/** True when a GIF of this length and size must not be started (shared by the dialog and the engine). */
export function gifTooLarge(durationMicros: number, width: number, height: number, fps: number): boolean {
  if (durationMicros > GIF_MAX_SECONDS * 1_000_000) return true
  return estimateGifBytes(width, height, totalFrames(durationMicros, fps)) > GIF_MAX_BYTES
}

/**
 * Next size-per-pixel estimate after one finished GIF. Returns the previous value (possibly null) when the
 * sample is unusable.
 */
export function learnGifBytesPerPixel(
  previous: number | null,
  bytes: number,
  width: number,
  height: number,
  frames: number
): number | null {
  const usable = previous !== null && Number.isFinite(previous) && previous > 0 ? previous : null
  const pixelFrames = width * height * frames
  if (!Number.isFinite(bytes) || bytes <= 0 || pixelFrames <= 0) return usable
  const sample = bytes / pixelFrames
  const next = usable === null ? sample : GIF_SAMPLE_WEIGHT * sample + (1 - GIF_SAMPLE_WEIGHT) * usable
  return Math.min(GIF_MAX_BYTES_PER_PIXEL, Math.max(GIF_MIN_BYTES_PER_PIXEL, next))
}
