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
