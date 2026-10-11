import type { Clip } from '../project/types'
import type { Micros } from '../time'
import { clipDuration, clipEnd, rippleClose } from './edit'

export interface TransitionPlan {
  /** The second clip of the cut, which owns transitionIn. */
  clipId: string
  /** Timeline start of the overlap (the second clip's start after planning). */
  start: Micros
  /** Actual overlap; may be shorter than requested by rounding. */
  duration: Micros
  requested: Micros
}

export interface TransitionPlanResult {
  clips: Clip[]
  transitions: TransitionPlan[]
  shortenedBy: Micros
}

/**
 * Largest whole-microsecond source move on one edge whose timeline extension
 * does not exceed `target`, plus the smallest such move. Speed rounding can make
 * some timeline amounts unreachable (speed 0.5 steps by 2), so the achieved
 * extension may be below target.
 */
function extendEdge(
  clip: Clip,
  target: Micros,
  maxSource: Micros,
): { source: Micros; timeline: Micros } {
  const length = clip.srcOut - clip.srcIn
  const base = clipDuration(clip)
  const timelineAt = (k: Micros): Micros => Math.round((length + k) / clip.speed) - base
  const limit = Math.min(target, Math.floor(maxSource / clip.speed))

  let lo = 0
  let hi = maxSource
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (timelineAt(mid) <= limit) lo = mid
    else hi = mid - 1
  }
  const timeline = timelineAt(lo)

  let first = 0
  let last = lo
  while (first < last) {
    const mid = Math.floor((first + last) / 2)
    if (timelineAt(mid) >= timeline) last = mid
    else first = mid + 1
  }
  return { source: first, timeline }
}

export function planTransitions(
  clips: Clip[],
  assetDurations: Record<string, Micros>,
): TransitionPlanResult {
  const assetDuration = (assetId: string): Micros => {
    const duration = assetDurations[assetId]
    if (duration === undefined) {
      throw new RangeError(`missing duration for asset ${assetId}`)
    }
    return duration
  }

  // rippleClose returns fresh clip objects, so the output never aliases the input.
  const sorted = rippleClose(clips)
  const out: Clip[] = []
  const transitions: TransitionPlan[] = []
  let shortenedBy = 0
  // Accumulated pull applied to every clip that is not yet placed.
  let shift = 0

  for (const clip of sorted) {
    clip.start -= shift
    const prev = out[out.length - 1]
    const requested = clip.transitionIn?.duration ?? 0

    if (!clip.transitionIn || !prev) {
      clip.transitionIn = null
      out.push(clip)
      continue
    }

    const d = Math.min(requested, clipDuration(prev), clipDuration(clip))
    if (d < 1) {
      clip.transitionIn = null
      out.push(clip)
      continue
    }

    const half = Math.floor(d / 2)
    const prevHandleOut = assetDuration(prev.assetId) - prev.srcOut
    const aCap = Math.min(half, Math.floor(prevHandleOut / prev.speed))
    const bCap = Math.min(d - half, Math.floor(clip.srcIn / clip.speed))
    // Missing handles: the timeline must close this much, so later clips move up.
    const shortage = d - aCap - bCap

    const seam = clipEnd(prev)
    const extA = extendEdge(prev, aCap, prevHandleOut)
    const extB = extendEdge(clip, bCap, clip.srcIn)
    // Speed rounding can leave an unreachable remainder; the overlap shrinks by that amount.
    const actual = extA.timeline + extB.timeline + shortage

    if (actual < 1) {
      clip.transitionIn = null
      out.push(clip)
      continue
    }

    prev.srcOut += extA.source
    clip.srcIn -= extB.source
    clip.start = seam - extB.timeline - shortage
    clip.transitionIn = { type: clip.transitionIn.type, duration: actual }

    shift += shortage
    shortenedBy += shortage
    transitions.push({ clipId: clip.id, start: clip.start, duration: actual, requested })
    out.push(clip)
  }

  return { clips: out, transitions, shortenedBy }
}
