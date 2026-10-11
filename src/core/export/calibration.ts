import {
  applyFactors,
  formatEstimateRange,
  type FeatureClass,
  type PhaseFactors,
  type PhaseSeconds,
  type TimeRange
} from './estimate'
import type { EstimateCodec } from './costs'

/** AVC is the measured hardware path; VP9 and AV1 are software encoders. */
export type CodecFamily = 'avc' | 'software'
export const FEATURE_CLASSES: readonly FeatureClass[] = ['plain', 'video']

export interface CalibrationEntry {
  /** Exports of this family and class that taught the factors. */
  samples: number
  factors: PhaseFactors
}

export type Calibration = Record<CodecFamily, Partial<Record<FeatureClass, CalibrationEntry>>>

export const EMPTY_CALIBRATION: Calibration = { avc: {}, software: {} }

export const MIN_FACTOR = 0.1
export const MAX_FACTOR = 10
/** Relative uncertainty with no sample yet, and the smallest one a long history reaches. */
const UNCERTAINTY_START = 0.5
const UNCERTAINTY_FLOOR = 0.1
/** Weight of the newest export: 1 for the first, then falling to this floor so old exports keep fading out. */
const SAMPLE_WEIGHT_FLOOR = 0.3
/** Exports shorter than this say little about the speed (start-up dominates). */
const MIN_MEASURED_SECONDS = 3
/** Phase groups with less predicted work than this are not learned from. */
const MIN_GROUP_SECONDS = 0.25
const RATIO_LIMIT = { min: 0.05, max: 20 }
const GIF_SAMPLE_WEIGHT = 0.5

export function familyOf(codec: EstimateCodec | string | null | undefined): CodecFamily {
  return codec === 'vp9' || codec === 'av1' ? 'software' : 'avc'
}

function clampFactor(value: number): number {
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, value))
}

function usableFactor(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? clampFactor(value) : null
}

function uniform(value: number): PhaseFactors {
  return { decode: value, draw: value, encode: value }
}

/**
 * Reads the stored calibration. Accepts the first format (one factor per family, from before the phase
 * split) and turns it into a plain-class entry with one sample.
 */
export function parseCalibration(raw: unknown): Calibration {
  const result: Calibration = { avc: {}, software: {} }
  if (!raw || typeof raw !== 'object') return result
  const data = raw as Record<string, unknown>
  for (const family of ['avc', 'software'] as const) {
    const value = data[family]
    const legacy = usableFactor(value)
    if (legacy !== null) {
      result[family].plain = { samples: 1, factors: uniform(legacy) }
      continue
    }
    if (!value || typeof value !== 'object') continue
    for (const cls of FEATURE_CLASSES) {
      const entry = (value as Record<string, unknown>)[cls] as { samples?: unknown; factors?: Record<string, unknown> } | undefined
      const samples = typeof entry?.samples === 'number' && Number.isInteger(entry.samples) && entry.samples > 0 ? entry.samples : 0
      const f = entry?.factors
      const decode = usableFactor(f?.decode)
      const draw = usableFactor(f?.draw)
      const encode = usableFactor(f?.encode)
      if (samples > 0 && decode !== null && draw !== null && encode !== null) {
        result[family][cls] = { samples, factors: { decode, draw, encode } }
      }
    }
  }
  return result
}

/**
 * Factors and sample count to use for a family and class. With no own sample the factors of the family's
 * best-known class are borrowed (same computer, same encoder), and the sample count stays zero so the
 * estimate keeps its wide range.
 */
export function calibrationFor(calibration: Calibration, family: CodecFamily, cls: FeatureClass): { factors: PhaseFactors; samples: number } {
  const own = calibration[family][cls]
  if (own && own.samples > 0) return { factors: own.factors, samples: own.samples }
  let borrowed: CalibrationEntry | null = null
  for (const other of FEATURE_CLASSES) {
    const entry = calibration[family][other]
    if (entry && entry.samples > 0 && (borrowed === null || entry.samples > borrowed.samples)) borrowed = entry
  }
  return { factors: borrowed ? borrowed.factors : uniform(1), samples: 0 }
}

/** True once one export of this codec family has taught the estimate (hides the calibration hint). */
export function familyCalibrated(calibration: Calibration, family: CodecFamily): boolean {
  return FEATURE_CLASSES.some((cls) => (calibration[family][cls]?.samples ?? 0) > 0)
}

/** Relative uncertainty: the estimate is trusted within (1 +/- u). Shrinks with the square root of the samples. */
export function uncertainty(samples: number): number {
  const n = Number.isFinite(samples) && samples > 0 ? samples : 0
  return Math.max(UNCERTAINTY_FLOOR, UNCERTAINTY_START / Math.sqrt(n + 1))
}

/** Range for an estimate in seconds, given how many exports taught it. */
export function estimateRange(seconds: number, samples: number): TimeRange {
  const u = uncertainty(samples)
  return formatEstimateRange(seconds / (1 + u), seconds * (1 + u))
}

function ratioOf(measured: number, predicted: number): number {
  return Math.min(RATIO_LIMIT.max, Math.max(RATIO_LIMIT.min, measured / predicted))
}

/**
 * Learns from one finished export. `predicted` must be uncalibrated (factors 1), `measured` the seconds per
 * phase from the exporter. Each phase group moves its factor towards the measured/predicted ratio.
 */
export function learnRun(
  calibration: Calibration,
  family: CodecFamily,
  cls: FeatureClass,
  predicted: PhaseSeconds,
  measured: PhaseSeconds
): Calibration {
  const measuredTotal = Object.values(measured).reduce((a, b) => a + b, 0)
  if (!(measuredTotal >= MIN_MEASURED_SECONDS)) return calibration

  const base = calibrationFor(calibration, family, cls)
  const samples = base.samples
  const weight = Math.max(SAMPLE_WEIGHT_FLOOR, 1 / (samples + 1))
  const factors = { ...base.factors }
  const groups: [keyof PhaseFactors, number, number][] = [
    ['decode', predicted.decode, measured.decode],
    ['draw', predicted.draw, measured.draw],
    ['encode', predicted.encode + predicted.audio + predicted.fixed, measured.encode + measured.audio + measured.fixed]
  ]
  for (const [key, predictedGroup, measuredGroup] of groups) {
    if (predictedGroup < MIN_GROUP_SECONDS || !(measuredGroup > 0)) continue
    const ratio = ratioOf(measuredGroup, predictedGroup)
    factors[key] = clampFactor(weight * ratio + (1 - weight) * factors[key])
  }

  return {
    ...calibration,
    [family]: { ...calibration[family], [cls]: { samples: samples + 1, factors } }
  }
}

/** Expected time with the learned factors for a family and class. */
export function calibratedPhases(calibration: Calibration, family: CodecFamily, cls: FeatureClass, predicted: PhaseSeconds): PhaseSeconds {
  return applyFactors(predicted, calibrationFor(calibration, family, cls).factors)
}

/**
 * Next scalar factor after one finished export (used for GIF). Returns the previous value (possibly null)
 * when the sample is unusable.
 */
export function updateCalibration(previous: number | null, predictedSeconds: number, measuredSeconds: number): number | null {
  const usable = previous !== null && Number.isFinite(previous) && previous > 0 ? previous : null
  if (!Number.isFinite(predictedSeconds) || !Number.isFinite(measuredSeconds) || predictedSeconds <= 0 || measuredSeconds < MIN_MEASURED_SECONDS) {
    return usable
  }
  const ratio = measuredSeconds / predictedSeconds
  const next = usable === null ? ratio : GIF_SAMPLE_WEIGHT * ratio + (1 - GIF_SAMPLE_WEIGHT) * usable
  return clampFactor(next)
}
