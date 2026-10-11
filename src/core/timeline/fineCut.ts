import type { Clip, Project } from '../project/types'
import type { Pause } from '../audio/peaks'
import { MICROS_PER_SECOND, type Micros } from '../time'
import { clipEnd, findClipAt } from './edit'
import type { ItemRef } from './ops'

/** Largest zoom: one frame is this many pixels wide. */
export const FINE_CUT_MAX_PX_PER_FRAME = 64

/** The clip the fine cut works on: the selected video clip, else the clip under the playhead. */
export function clipForFineCut(project: Project, playhead: Micros, selection: ItemRef | null): Clip | null {
  const selected = selection?.kind === 'clip' ? project.clips.find((c) => c.id === selection.id) : undefined
  const clip = selected ?? findClipAt(project.clips, playhead) ?? null
  if (!clip) return null
  const asset = project.assets.find((a) => a.id === clip.assetId)
  return asset?.kind === 'video' ? clip : null
}

/** Source time to timeline time (whole microseconds). */
export function srcToTimeline(clip: Clip, srcTime: Micros): Micros {
  return clip.start + Math.round((srcTime - clip.srcIn) / clip.speed)
}

/** Timeline time to source time (whole microseconds, within one microsecond of the exact value at speed 2). */
export function timelineToSrc(clip: Clip, t: Micros): Micros {
  return clip.srcIn + Math.round((t - clip.start) * clip.speed)
}

/**
 * Range in which a cut keeps at least `frameLen` (timeline time) on both sides,
 * or null when the clip is too short for any cut.
 */
export function cutBounds(clip: Clip, frameLen: Micros): { min: Micros; max: Micros } | null {
  const min = clip.start + frameLen
  const max = clipEnd(clip) - frameLen
  return max >= min ? { min, max } : null
}

/** Keeps a cut inside cutBounds. Returns the rounded input when the clip cannot be cut at all. */
export function clampCut(clip: Clip, t: Micros, frameLen: Micros): Micros {
  const rounded = Math.round(t)
  const bounds = cutBounds(clip, frameLen)
  if (!bounds) return rounded
  return Math.min(Math.max(rounded, bounds.min), bounds.max)
}

/**
 * The frame rate as the frames are counted. Probed rates are averages of millisecond timestamps (30 fps
 * reads as 29.996), so a value within 0.005 of an integer is that integer. NTSC rates (29.97) stay as they are.
 */
export function nominalFps(fps: number): number {
  const rounded = Math.round(fps)
  return rounded > 0 && Math.abs(fps - rounded) < 0.005 ? rounded : fps
}

/** Source frame number of the frame starting at srcTime. Rounds, because containers quantise timestamps. */
export function frameIndexLabel(srcTime: Micros, fps: number): number {
  return Math.round((srcTime * fps) / MICROS_PER_SECOND)
}

/**
 * The keyframe nearest to the candidate when it lies within the threshold, else the candidate.
 * Callers pass only the keyframes that are ahead of the cut in the direction of travel.
 */
export function snapToKeyframe(candidateSrc: Micros, keyframes: readonly Micros[], thresholdMicros: Micros): Micros {
  let best: Micros | null = null
  let bestDistance = Infinity
  for (const k of keyframes) {
    const distance = Math.abs(k - candidateSrc)
    if (distance <= thresholdMicros && distance < bestDistance) {
      best = k
      bestDistance = distance
    }
  }
  return best ?? candidateSrc
}

/** Timeline position to land on when jumping to a pause (the pause start, inside the clip). */
export function pauseJumpTarget(pause: Pause, clip: Clip): Micros {
  const t = srcToTimeline(clip, pause.start)
  return Math.min(Math.max(t, clip.start), clipEnd(clip))
}

/**
 * Pixels per frame for a zoom position 0..100. Zoom 0 shows one second across the viewport,
 * zoom 100 makes one frame FINE_CUT_MAX_PX_PER_FRAME pixels wide. Logarithmic in between.
 */
export function pxPerFrameForZoom(zoom: number, viewportPx: number, fps: number): number {
  const top = FINE_CUT_MAX_PX_PER_FRAME
  const viewport = Math.max(viewportPx, 100)
  const bottom = Math.min(Math.max(viewport / fps, 4), top)
  const p = Math.min(Math.max(zoom, 0), 100) / 100
  return bottom * (top / bottom) ** p
}
