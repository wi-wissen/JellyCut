/** Fewer frames than this and the progress says too little about the speed. */
export const ETA_MIN_FRAMES = 15
/** Time constant of the rate average and of the smoothed remaining time: the last few seconds count most. */
const TIME_CONSTANT_MS = 3000
/** A new ETA replaces the shown one only when it differs by more than this share (or one second). */
const HOLD_SHARE = 0.15
const HOLD_MIN_MS = 1000

/**
 * Remaining time of an export from its progress. The work per frame (from the time model) gives the
 * remaining work; the throughput is an exponential average over about three seconds, so slow sections
 * later on (overlays, transitions) count when they arrive. The remaining time is smoothed the same way, and
 * the shown value counts down between updates and only jumps when the new estimate leaves a band around it
 * (hysteresis). While `paused` (the tab is in the background and throttled) no throughput is learned.
 */
export class ExportEta {
  private readonly total: number
  private doneIndex = 0
  private doneWeight = 0
  private rate: number | null = null
  private smoothed: number | null = null
  private lastMs = 0
  private lastWeight = 0
  private anchor: { remainingMs: number; atMs: number } | null = null

  /** Without weights every frame counts the same. */
  constructor(
    private readonly weights: ArrayLike<number> | null,
    private readonly frames: number
  ) {
    this.total = weights ? sumOf(weights, frames) : frames
  }

  /** Remaining milliseconds, or null while too little is done. */
  update(elapsedMs: number, doneFrames: number, paused = false): number | null {
    const target = Math.min(this.frames, Math.max(0, doneFrames))
    while (this.doneIndex < target) {
      this.doneWeight += this.weights ? (this.weights[this.doneIndex] ?? 0) : 1
      this.doneIndex++
    }
    if (doneFrames < ETA_MIN_FRAMES || !(elapsedMs >= 0)) return null

    const dt = elapsedMs - this.lastMs
    if (paused) {
      // Progress made while throttled is not a measure of the speed: restart the measurement after it.
      this.lastMs = elapsedMs
      this.lastWeight = this.doneWeight
      return this.countdown(elapsedMs)
    }
    // Until the averaging window is full, the rate is the average since the start: the first frames are too few to trust.
    if (elapsedMs < TIME_CONSTANT_MS) {
      this.rate = elapsedMs > 0 ? this.doneWeight / elapsedMs : null
    } else if (dt > 0) {
      const instant = (this.doneWeight - this.lastWeight) / dt
      this.rate = this.rate === null ? instant : this.rate + (1 - Math.exp(-dt / TIME_CONSTANT_MS)) * (instant - this.rate)
    }
    this.lastMs = elapsedMs
    this.lastWeight = this.doneWeight
    if (this.rate === null || !(this.rate > 0)) return null

    const raw = Math.max(0, (this.total - this.doneWeight) / this.rate)
    if (this.smoothed === null) this.smoothed = raw
    else if (dt > 0) this.smoothed += (1 - Math.exp(-dt / TIME_CONSTANT_MS)) * (raw - this.smoothed)
    const candidate = this.smoothed

    const shownNow = this.anchor ? Math.max(0, this.anchor.remainingMs - (elapsedMs - this.anchor.atMs)) : null
    if (shownNow === null || Math.abs(candidate - shownNow) > Math.max(HOLD_MIN_MS, HOLD_SHARE * shownNow)) {
      this.anchor = { remainingMs: candidate, atMs: elapsedMs }
    }
    return this.countdown(elapsedMs)
  }

  private countdown(elapsedMs: number): number | null {
    const anchor = this.anchor
    return anchor ? Math.max(0, anchor.remainingMs - (elapsedMs - anchor.atMs)) : null
  }
}

function sumOf(values: ArrayLike<number>, count: number): number {
  let sum = 0
  for (let i = 0; i < count; i++) sum += values[i] ?? 0
  return sum
}
