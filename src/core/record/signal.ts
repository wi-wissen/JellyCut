// Pure measuring helpers for the Record tab: is there a microphone signal, is the picture black, is the file silent.
// The engine feeds samples in; the decisions live here so they are unit-tested. No DOM.

/** RMS below this counts as "no signal" while recording (digital silence; a live room is far above it). */
export const NO_SIGNAL_LEVEL = 0.0002
/** How long the signal must stay missing / black before the panel warns. */
export const WARN_AFTER_MS = 3000
/** A recorded file whose loudest sample stays under this is treated as silent. */
export const SILENT_PEAK = 0.003
/** Mean luma (0..255) under this counts as black. */
export const BLACK_LUMA = 2

/** Mean luma of RGBA pixels (Rec. 601). 0 for empty input. */
export function meanLuma(rgba: ArrayLike<number>): number {
  const pixels = Math.floor(rgba.length / 4)
  if (pixels === 0) return 0
  let sum = 0
  for (let i = 0; i < pixels; i++) {
    const o = i * 4
    sum += 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!
  }
  return sum / pixels
}

/**
 * Tracks one measured value over time and answers "has it stayed below the threshold for a while?".
 * Times are passed in (milliseconds on any monotonic clock), so a throttled timer in a background tab
 * does not matter: only the span between samples counts.
 */
export class QuietWatch {
  private firstAt: number | null = null
  private lastLoudAt: number | null = null
  private lastAt = 0
  count = 0
  min = Number.POSITIVE_INFINITY
  max = Number.NEGATIVE_INFINITY
  last = 0

  constructor(private readonly threshold: number) {}

  push(timeMs: number, value: number): void {
    if (!Number.isFinite(value)) return
    this.firstAt ??= timeMs
    this.count++
    this.min = Math.min(this.min, value)
    this.max = Math.max(this.max, value)
    this.last = value
    this.lastAt = timeMs
    if (value >= this.threshold) this.lastLoudAt = timeMs
  }

  /** How long the value has been below the threshold, measured at the last sample. 0 before the first sample. */
  quietForMs(): number {
    if (this.firstAt === null) return 0
    return this.lastAt - (this.lastLoudAt ?? this.firstAt)
  }

  /** True once the value stayed below the threshold for `windowMs`; false again at the first loud sample. */
  isQuiet(windowMs = WARN_AFTER_MS): boolean {
    return this.count > 0 && this.quietForMs() >= windowMs
  }

  /** min/max for the diagnostics; null before any sample. */
  range(): { min: number; max: number; samples: number } | null {
    return this.count === 0 ? null : { min: this.min, max: this.max, samples: this.count }
  }
}

/** Peak and RMS over blocks of samples (all channels count). */
export class LevelAccumulator {
  peak = 0
  private sumSquares = 0
  private n = 0

  push(channels: ArrayLike<number>[]): void {
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) {
        const v = channel[i]!
        if (!Number.isFinite(v)) continue
        const a = v < 0 ? -v : v
        if (a > this.peak) this.peak = a
        this.sumSquares += v * v
        this.n++
      }
    }
  }

  get rms(): number {
    return this.n === 0 ? 0 : Math.sqrt(this.sumSquares / this.n)
  }

  get samples(): number {
    return this.n
  }
}

export function isSilentPeak(peak: number): boolean {
  return peak < SILENT_PEAK
}

export function isBlackLuma(luma: number): boolean {
  return luma < BLACK_LUMA
}

/** Result of measuring a finished recording; feeds the clip warnings and the technical details. */
export interface RecordingCheck {
  hasAudioTrack: boolean
  audioPeak: number
  audioRms: number
  audioSeconds: number
  hasVideoTrack: boolean
  /** Mean luma of a few decoded frames near the start. */
  frameLuma: number[]
}

export interface CheckVerdict {
  silentAudio: boolean
  blackPicture: boolean
}

/**
 * Verdict on a measured file. `expectedAudio` says the recorder believed it had a sound source; a clip without any
 * audio track is then as bad as a silent one. An unmeasurable file (null) is not accused.
 */
export function judgeRecording(check: RecordingCheck | null, expectedAudio: boolean): CheckVerdict {
  if (!check) return { silentAudio: false, blackPicture: false }
  const silentAudio = expectedAudio && (!check.hasAudioTrack || (check.audioSeconds > 0 && isSilentPeak(check.audioPeak)))
  const blackPicture = check.hasVideoTrack && check.frameLuma.length > 0 && check.frameLuma.every(isBlackLuma)
  return { silentAudio, blackPicture }
}
