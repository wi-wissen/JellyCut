import type { Project } from '../project/types'
import { MICROS_PER_SECOND } from '../time'

/** Megapixels per second for drawing and hardware H.264 encoding, measured on the owner's PC (docs/performance.md). */
export const RENDER_MP_PER_S = 55
/** Megapixels per second of decoded source material, measured on the same PC (docs/performance.md). */
export const DECODE_MP_PER_S = 120
/** Audio mixing and writing, per second of export. Not measured, kept small on purpose. */
const AUDIO_SECONDS_PER_SECOND = 0.02
const STARTUP_SECONDS = 1.5

/**
 * Multiplier for the drawing and encoding part only (decoding and audio are not affected).
 * Only AVC was measured. VP9 and AV1 run in software, which is assumed 2.5 times slower here.
 * This is a conservative guess, not a measurement.
 */
export const CODEC_FACTOR = { avc: 1, vp9: 2.5, av1: 2.5 } as const
export type EstimateCodec = keyof typeof CODEC_FACTOR

/** Assets without a known size or frame rate are assumed to be full HD at 30 fps. */
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080
const DEFAULT_FPS = 30

const MIN_FACTOR = 0.1
const MAX_FACTOR = 10
/** Weight of the newest measurement in the moving average. */
const SAMPLE_WEIGHT = 0.5
/** Shorter exports are dominated by start-up, so they say little about the speed. */
const MIN_MEASURED_SECONDS = 3

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Megapixels of source material the export has to decode.
 * Video decodes at the asset frame rate over the source range (srcOut - srcIn), so the clip speed and the
 * timeline position do not matter. An image is decoded once per clip, however long the clip is.
 */
export function sourceDecodeLoad(project: Project): number {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  let megapixels = 0
  for (const clip of project.clips) {
    const asset = assets.get(clip.assetId)
    if (asset?.kind === 'audio') continue
    const pixels = positiveOr(asset?.width, DEFAULT_WIDTH) * positiveOr(asset?.height, DEFAULT_HEIGHT)
    if (asset?.kind === 'image') {
      megapixels += pixels / 1_000_000
      continue
    }
    const fps = positiveOr(asset?.fps, DEFAULT_FPS)
    const sourceSeconds = Math.max(0, clip.srcOut - clip.srcIn) / MICROS_PER_SECOND
    megapixels += (pixels * fps * sourceSeconds) / 1_000_000
  }
  return megapixels
}

export interface EstimateInput {
  width: number
  height: number
  fps: number
  durationMicros: number
  decodeMegapixels: number
  codec: EstimateCodec
  /** Learned correction for this computer; 1 means the default rates. */
  calibration?: number
}

/** Expected export time in seconds. Pass calibration 1 to get the uncorrected value. */
export function estimateExportSeconds(input: EstimateInput): number {
  const durationMicros = Number.isFinite(input.durationMicros) && input.durationMicros > 0 ? Math.round(input.durationMicros) : 0
  const durationSeconds = durationMicros / MICROS_PER_SECOND
  // Same frame count as the exporter, which rounds a partial frame up.
  const frames = Math.ceil((durationMicros * input.fps) / MICROS_PER_SECOND)
  const renderMegapixels = (input.width * input.height * frames) / 1_000_000
  const decodeMegapixels = Math.max(0, input.decodeMegapixels)
  const seconds =
    (renderMegapixels / RENDER_MP_PER_S) * CODEC_FACTOR[input.codec] +
    decodeMegapixels / DECODE_MP_PER_S +
    durationSeconds * AUDIO_SECONDS_PER_SECOND +
    STARTUP_SECONDS
  return seconds * (input.calibration ?? 1)
}

function clampFactor(value: number): number {
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, value))
}

/**
 * Next calibration factor after one finished export.
 * predictedSeconds must come from estimateExportSeconds with calibration 1, so the ratio is the
 * correction for this computer and not a correction of a correction.
 * Returns the previous factor (possibly null) when the sample is unusable.
 */
export function updateCalibration(previous: number | null, predictedSeconds: number, measuredSeconds: number): number | null {
  const usable = previous !== null && Number.isFinite(previous) && previous > 0 ? previous : null
  if (
    !Number.isFinite(predictedSeconds) ||
    !Number.isFinite(measuredSeconds) ||
    predictedSeconds <= 0 ||
    measuredSeconds < MIN_MEASURED_SECONDS
  ) {
    return usable
  }
  const ratio = measuredSeconds / predictedSeconds
  const next = usable === null ? ratio : SAMPLE_WEIGHT * ratio + (1 - SAMPLE_WEIGHT) * usable
  return clampFactor(next)
}

/** Megapixels per second for drawing a GIF frame and reading it back, and for quantizing it. Not measured: rough. */
export const GIF_RENDER_MP_PER_S = 25
export const GIF_QUANTIZE_MP_PER_S = 8

export interface GifEstimateInput {
  width: number
  height: number
  fps: number
  durationMicros: number
  decodeMegapixels: number
  /** Learned correction for this computer; 1 means the default rates. */
  calibration?: number
}

/** Expected GIF export time in seconds (rough: GIF encoding is CPU bound and has no measurement behind it yet). */
export function estimateGifSeconds(input: GifEstimateInput): number {
  const durationMicros = Number.isFinite(input.durationMicros) && input.durationMicros > 0 ? Math.round(input.durationMicros) : 0
  const frames = Math.ceil((durationMicros * input.fps) / MICROS_PER_SECOND)
  const megapixels = (input.width * input.height * frames) / 1_000_000
  const seconds =
    megapixels / GIF_RENDER_MP_PER_S +
    megapixels / GIF_QUANTIZE_MP_PER_S +
    Math.max(0, input.decodeMegapixels) / DECODE_MP_PER_S +
    STARTUP_SECONDS
  return seconds * (input.calibration ?? 1)
}

export interface EstimateFormat {
  unit: 'seconds' | 'minutes' | 'hours'
  value: number
  /** Hours unit: minutes after the full hours, omitted when zero. */
  minutes?: number
  /** Minutes unit: seconds after the full minutes, omitted when zero. */
  seconds?: number
}

function minutesFormat(roundedSeconds: number): EstimateFormat {
  const value = Math.floor(roundedSeconds / 60)
  const seconds = roundedSeconds % 60
  return seconds > 0 ? { unit: 'minutes', value, seconds } : { unit: 'minutes', value }
}

/** Duration text parts for the UI: 5 s steps below 2 min, 10 s steps below 10 min, whole minutes above. */
export function formatEstimate(seconds: number): EstimateFormat {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  if (s < 117.5) {
    const rounded = Math.max(5, 5 * Math.round(s / 5))
    return rounded < 60 ? { unit: 'seconds', value: rounded } : minutesFormat(rounded)
  }
  if (s < 595) {
    return minutesFormat(10 * Math.round(s / 10))
  }
  const minutes = Math.round(s / 60)
  if (minutes < 60) return { unit: 'minutes', value: minutes }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? { unit: 'hours', value: hours, minutes: rest } : { unit: 'hours', value: hours }
}
