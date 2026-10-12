// Decisions for the one-time clean-up of a finished recording (see engine/record/optimize.ts). Pure, so the rules
// (when to skip, what to ask the encoder for, when the result is trusted) are unit-tested without a browser.

/** Longer recordings are left as they are: the re-encode would run for minutes and hold the result in memory. */
export const MAX_OPTIMIZE_SECONDS = 600
/** Seconds between keyframes in the optimised file. */
export const KEYFRAME_INTERVAL_SECONDS = 1
/** The optimised file must have a keyframe at least this often (the interval plus room for rounding). */
export const MAX_KEY_GAP_SECONDS = 1.05
export const MIN_VIDEO_BITRATE = 2_000_000
export const MAX_VIDEO_BITRATE = 10_000_000
/** The result is held in memory; do not start when it would be larger than this. */
export const MAX_OUTPUT_BYTES = 400 * 1024 * 1024
export const DURATION_TOLERANCE_SECONDS = 0.05
export const LUMA_TOLERANCE = 14

export type OptimizeSkip = 'tooLong' | 'tooBig' | 'noEncoder' | 'noVideo' | 'unsupportedCodec' | 'alreadyDense'
export type OptimizeKeep = 'canceled' | 'failed' | 'mismatch'

export interface OptimizePlan {
  /** Output container. */
  container: 'webm' | 'mp4'
  /** Video codecs to try, best first. */
  codecs: string[]
  bitrate: number
}

export interface PlanInput {
  durationSeconds: number
  /** Bits per second of the source video, 0 when unknown. */
  sourceBitrate: number
  videoCodec: string | null
  hasVideoEncoder: boolean
  /** Longest distance between two keyframes in the source, null when not measured. */
  sourceMaxKeyGapSeconds: number | null
  /** Longest distance between two pictures in the source (a slow stretch widens the keyframe gap), null if unknown. */
  sourceMaxFrameGapSeconds: number | null
}

export function planOptimization(input: PlanInput): OptimizePlan | OptimizeSkip {
  if (!input.videoCodec) return 'noVideo'
  if (!input.hasVideoEncoder) return 'noEncoder'
  if (input.durationSeconds > MAX_OPTIMIZE_SECONDS) return 'tooLong'
  if (input.sourceMaxKeyGapSeconds !== null && input.sourceMaxKeyGapSeconds <= MAX_KEY_GAP_SECONDS + (input.sourceMaxFrameGapSeconds ?? 0)) {
    return 'alreadyDense'
  }
  const bitrate = Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, Math.round(input.sourceBitrate * 2)))
  if ((bitrate * input.durationSeconds) / 8 > MAX_OUTPUT_BYTES) return 'tooBig'
  switch (input.videoCodec) {
    // VP9 first even for a VP8 source: the browser's VP9 encoder is several times faster (measured 10 ms against 80 ms
    // per 720p frame), and every browser that can encode it plays it. VP8 stays as the fallback.
    case 'vp8':
    case 'vp9':
    case 'av1':
      return { container: 'webm', codecs: ['vp9', 'vp8'], bitrate }
    case 'avc':
      return { container: 'mp4', codecs: ['avc'], bitrate }
    default:
      return 'unsupportedCodec'
  }
}

export interface Measure {
  durationSeconds: number
  frames: number
  maxKeyGapSeconds: number
  /** Longest distance between two consecutive pictures. */
  maxFrameGapSeconds: number
  /** Mean grey value (0..255) of the picture at a few fixed fractions of the length. */
  luma: number[]
}

/** Largest distance between consecutive keyframes, counting the stretch from the last one to the end. */
export function maxKeyGap(keyTimes: readonly number[], endSeconds: number): number {
  if (keyTimes.length === 0) return endSeconds
  let gap = 0
  for (let i = 1; i < keyTimes.length; i++) gap = Math.max(gap, keyTimes[i]! - keyTimes[i - 1]!)
  return Math.max(gap, endSeconds - keyTimes[keyTimes.length - 1]!)
}

/**
 * Whether the optimised file may replace the raw one: same length, same number of pictures, same look, and keyframes
 * close enough to make random access cheap. Anything else keeps the raw file.
 */
/** Longest distance between consecutive timestamps (0 for fewer than two). */
export function maxFrameGap(times: readonly number[]): number {
  let gap = 0
  for (let i = 1; i < times.length; i++) gap = Math.max(gap, times[i]! - times[i - 1]!)
  return gap
}

export function judgeOptimized(raw: Measure, out: Measure): 'ok' | 'mismatch' {
  if (Math.abs(raw.durationSeconds - out.durationSeconds) > DURATION_TOLERANCE_SECONDS) return 'mismatch'
  if (Math.abs(raw.frames - out.frames) > Math.max(2, Math.round(raw.frames * 0.02))) return 'mismatch'
  // A slow stretch (few pictures per second) can delay the next keyframe by the gap between its pictures.
  if (out.maxKeyGapSeconds > MAX_KEY_GAP_SECONDS + out.maxFrameGapSeconds) return 'mismatch'
  if (raw.luma.length !== out.luma.length) return 'mismatch'
  for (let i = 0; i < raw.luma.length; i++) {
    if (Math.abs(raw.luma[i]! - out.luma[i]!) > LUMA_TOLERANCE) return 'mismatch'
  }
  return 'ok'
}
