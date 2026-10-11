// Pure helpers for re-encoding a screen share through a canvas: frame size and the frame pacing decision. No DOM.

/** Long side limit: keeps the VP9/VP8 encoder real-time on 4K screens. */
export const MAX_CAPTURE_LONG_SIDE = 1920
export const CAPTURE_FPS = 30
/** Worker tick period; a hair under 1000/30 so the gate never skips a frame because of rounding. */
export const FRAME_INTERVAL_MS = 33

export interface CaptureSize {
  width: number
  height: number
}

const FALLBACK_SIZE: CaptureSize = { width: 1280, height: 720 }

const evenAtLeastTwo = (value: number): number => Math.max(2, Math.round(value / 2) * 2)

/** Canvas size for a source picture: long side capped (never upscaled), both sides even (video encoders need it). */
export function captureSize(sourceWidth: number, sourceHeight: number, maxLongSide = MAX_CAPTURE_LONG_SIDE): CaptureSize {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return { ...FALLBACK_SIZE }
  }
  const scale = Math.min(1, maxLongSide / Math.max(sourceWidth, sourceHeight))
  return { width: evenAtLeastTwo(sourceWidth * scale), height: evenAtLeastTwo(sourceHeight * scale) }
}

export function sameSize(a: CaptureSize, b: CaptureSize): boolean {
  return a.width === b.width && a.height === b.height
}

/**
 * Decides which timer ticks become frames. Ticks come from a worker (or setInterval); a tick that arrives
 * early (jitter, two timers) is skipped, a late one is drawn once - never a burst to catch up. The clock is passed in.
 */
export class FrameGate {
  private last = Number.NEGATIVE_INFINITY

  constructor(private readonly intervalMs = FRAME_INTERVAL_MS) {}

  /** True when a frame should be drawn at `nowMs`. Records the draw. */
  due(nowMs: number): boolean {
    // A clock that went backwards (or the first call) restarts the pacing.
    if (nowMs < this.last || nowMs - this.last >= this.intervalMs * 0.75) {
      this.last = nowMs
      return true
    }
    return false
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY
  }
}
