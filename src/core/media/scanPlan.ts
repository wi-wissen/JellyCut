import type { Micros } from '../time'

// Planning for files whose keyframes are far apart (MediaRecorder output: one keyframe at the start). A frame can only
// be reached by decoding forward from the keyframe before it, so these files are read in forward passes that leave
// small pictures and a few full-size ones behind (see engine/media/sparseReader.ts). Everything here is pure.

/** A keyframe further back than this makes random access slow enough to need the cache. */
export const SPARSE_GAP: Micros = 1_500_000
/** In a pass, every frame this close in front of the wanted window gets a thumbnail (stepping back needs them). */
export const DENSE_LEAD: Micros = 3_000_000
/** Frames outside the wanted window get a thumbnail this often. */
export const SPARSE_THUMB_STEP: Micros = 500_000
/** Full-size frames kept in front of a looked-up time, so a few steps backwards need no new pass. */
export const FULL_RING: Micros = 1_000_000
/** Longest side of a thumbnail. */
export const THUMB_WIDTH = 160
export const MAX_RUNS = 3

/**
 * A pass keeps full-size frames beyond the ones that are needed, so a few steps need no new pass. Backwards is the
 * expensive direction (a new pass starts at the first keyframe), forwards only continues the run, so the margin
 * behind is wide in time (a recording can have long gaps between its pictures) and the one ahead is short.
 */
export const FULL_MARGIN_BEFORE: Micros = 600_000
export const FULL_MARGIN_AFTER_FRAMES = 3

/**
 * What a pass should keep: thumbnails of every frame in [thumbFrom, thumbTo] and full-size frames in [fullFrom,
 * fullTo] (plus a margin). The window is "satisfied" when the caches hold those; a pass runs only when they do not.
 */
export interface ScanWant {
  thumbFrom: Micros
  thumbTo: Micros
  fullFrom: Micros
  fullTo: Micros
  /** Typical frame length, used to probe the cache. */
  step: Micros
}

export function isSparseGap(time: Micros, keyTime: Micros | null): boolean {
  return keyTime === null || time - keyTime > SPARSE_GAP
}

/**
 * Whether a pass keeps a thumbnail of the frame at `ts`: every frame in or just before a wanted window and just
 * before a looked-up time (the fine cut opens on the picture that was just shown), else one per SPARSE_THUMB_STEP.
 */
export function wantsThumb(ts: Micros, lastThumb: Micros | null, want: ScanWant | null, ringTarget: Micros | null = null): boolean {
  if (want && ts >= want.thumbFrom - DENSE_LEAD && ts <= want.thumbTo) return true
  if (ringTarget !== null && ts >= ringTarget - DENSE_LEAD) return true
  return lastThumb === null || ts - lastThumb >= SPARSE_THUMB_STEP
}

/** Frames kept before a looked-up time and before the needed window, when the pictures are further apart than usual. */
export const FULL_KEEP_FRAMES = 16

export interface FullContext {
  /** The frame shows the looked-up time (or is the last of the file): it is always kept. */
  covers: boolean
  /** Looked-up time of a plain lookup; a few frames before it stay too. Null in a pass over a wanted window. */
  ringTarget: Micros | null
  /** Typical distance between the pictures of this stretch (a recording can slow down), 0 when not known yet. */
  spacing: Micros
}

export function wantsFull(ts: Micros, context: FullContext, want: ScanWant | null): boolean {
  if (context.covers) return true
  if (context.ringTarget !== null && ts >= context.ringTarget - Math.max(FULL_RING, FULL_KEEP_FRAMES * context.spacing)) return true
  if (!want) return false
  const before = Math.max(FULL_MARGIN_BEFORE, 6 * want.step, (FULL_KEEP_FRAMES / 2) * context.spacing)
  const after = FULL_MARGIN_AFTER_FRAMES * Math.max(want.step, context.spacing)
  return ts >= want.fullFrom - before && ts <= want.fullTo + after
}

/** The window the fine cut needs around a cut: thumbnails `half` frames each side, full-size the two big pictures. */
export function fineCutWant(cut: Micros, frame: Micros, half = 64, fullBefore = 2, fullAfter = 1): ScanWant {
  return {
    thumbFrom: Math.max(0, cut - half * frame),
    thumbTo: cut + half * frame,
    fullFrom: Math.max(0, cut - fullBefore * frame),
    fullTo: cut + fullAfter * frame,
    step: frame
  }
}

/** First probed time in [from, to] (every `step`) that `has` does not know, or null when all are there. */
export function firstMissing(has: (t: Micros) => boolean, from: Micros, to: Micros, step: Micros): Micros | null {
  const stride = Math.max(1, Math.round(step))
  for (let t = from; t <= to; t += stride) if (!has(t)) return t
  return has(to) ? null : to
}

export interface RunState {
  key: Micros
  /** Start of the next frame the run will deliver; everything before it was already passed. */
  nextStart: Micros
}

/** The run to continue for a frame at `need` that starts from `key`: the one closest behind it, -1 for none. */
export function pickRun(runs: readonly RunState[], key: Micros, need: Micros): number {
  let best = -1
  runs.forEach((run, i) => {
    if (run.key !== key || run.nextStart > need) return
    if (best < 0 || run.nextStart > runs[best]!.nextStart) best = i
  })
  return best
}

export function thumbSize(width: number, height: number, maxWidth = THUMB_WIDTH): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / Math.max(1, width))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function frameBytes(width: number, height: number): number {
  return width * height * 4
}

/** 0..1 share of the way from the keyframe to the wanted time. */
export function passFraction(key: Micros, position: Micros, target: Micros): number {
  if (target <= key) return 1
  return Math.min(1, Math.max(0, (position - key) / (target - key)))
}
