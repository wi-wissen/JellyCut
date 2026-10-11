import type { Micros } from '../time'

/**
 * Containers quantise timestamps (WebM uses whole milliseconds), so a time computed on the project's
 * frame grid can fall a hair before the frame that is meant. Looking up slightly later fixes that and
 * stays far below half a frame for every realistic frame rate (up to ~300 fps).
 */
export const FRAME_LOOKUP_TOLERANCE: Micros = 1500

export interface FrameSpan {
  start: Micros
  end: Micros
}

/**
 * The time to ask the decoder for. Never before the track's first frame: recordings can start late (the
 * microphone is running before the first picture arrives), and a decoder answers "nothing" for such times.
 */
export function lookupTime(srcTime: Micros, firstTimestamp: Micros): Micros {
  return Math.max(srcTime + FRAME_LOOKUP_TOLERANCE, firstTimestamp)
}

/**
 * End of a frame. Muxers leave the duration of the last frame of a cluster at 0 (MediaRecorder output), so the
 * start of the next frame is used then; the very last frame of a file keeps a 1 microsecond span.
 */
export function frameEnd(start: Micros, duration: Micros, nextStart: Micros | null): Micros {
  if (duration > 0) return start + duration
  if (nextStart !== null && nextStart > start) return nextStart
  return start + 1
}

export function spanCovers(span: FrameSpan | null, t: Micros): boolean {
  return span !== null && t >= span.start && t < span.end
}
