import type { Clip } from '../project/types'
import type { Micros } from '../time'

function copyClip(clip: Clip, patch: Partial<Clip> = {}): Clip {
  return { ...clip, transform: { ...clip.transform }, ...patch }
}

export function clipDuration(clip: Clip): Micros {
  return Math.round((clip.srcOut - clip.srcIn) / clip.speed)
}

export function clipEnd(clip: Clip): Micros {
  return clip.start + clipDuration(clip)
}

export function splitClip(clip: Clip, at: Micros, newId: string): [Clip, Clip] | null {
  if (!(clip.start < at && at < clipEnd(clip))) return null

  const splitSrc = clip.srcIn + Math.round((at - clip.start) * clip.speed)
  const left = copyClip(clip, { srcOut: splitSrc })
  const right = copyClip(clip, {
    id: newId,
    srcIn: splitSrc,
    start: at,
    transitionIn: null,
  })
  return [left, right]
}

export function trimClipStart(clip: Clip, newStart: Micros, assetDuration: Micros): Clip {
  const { srcIn, srcOut, start, speed } = clip
  // srcIn must stay within [0, srcUpper - 1] so the clip keeps at least 1 us of source.
  const srcUpper = Math.min(srcOut, assetDuration)
  const minStart = Math.ceil(start - srcIn / speed)
  const maxStart = Math.floor(start + (srcUpper - 1 - srcIn) / speed)

  const candidate = (s: Micros): Clip =>
    copyClip(clip, { start: s, srcIn: srcIn + Math.round((s - start) * speed) })
  const isValid = (c: Clip): boolean =>
    c.srcIn >= 0 && c.srcIn <= srcUpper - 1 && clipDuration(c) >= 1

  let s = Math.min(Math.max(newStart, minStart), maxStart)
  let result = candidate(s)
  // Rounding can push the result one step past the analytic bound; step back until valid.
  while (!isValid(result) && s > minStart) {
    s -= 1
    result = candidate(s)
  }
  return result
}

export function trimClipEnd(clip: Clip, newEnd: Micros, assetDuration: Micros): Clip {
  const minSrcOut = clip.srcIn + 1
  const raw = clip.srcIn + Math.round((newEnd - clip.start) * clip.speed)
  const srcOut = Math.max(Math.min(raw, assetDuration), minSrcOut)
  return copyClip(clip, { srcOut })
}

export function rippleClose(clips: Clip[]): Clip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  let cursor = 0
  return sorted.map((clip) => {
    const placed = copyClip(clip, { start: cursor })
    cursor = clipEnd(placed)
    return placed
  })
}

export function findClipAt(clips: Clip[], t: Micros): Clip | undefined {
  return clips.find((clip) => clip.start <= t && t < clipEnd(clip))
}
