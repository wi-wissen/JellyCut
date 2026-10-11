import type { Project } from '../project/types'
import type { Micros } from '../time'
import { clipEnd } from './edit'

/**
 * Nearest candidate within thresholdMicros (inclusive), ties go to the earlier candidate.
 * Returns t unchanged when no candidate is close enough.
 */
export function snapTime(t: Micros, candidates: readonly Micros[], thresholdMicros: Micros): Micros {
  let best: Micros | null = null
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - t)
    if (distance > thresholdMicros) continue
    if (best === null || distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate
      bestDistance = distance
    }
  }
  return best ?? t
}

/**
 * Sorted, de-duplicated snap targets: 0, every clip, text and music edge, and the playhead.
 * The item with excludeId is left out so a dragged item does not snap to itself.
 */
export function collectSnapPoints(project: Project, excludeId?: string, playhead?: Micros): Micros[] {
  const points = new Set<Micros>([0])
  for (const clip of project.clips) {
    if (clip.id === excludeId) continue
    points.add(clip.start)
    points.add(clipEnd(clip))
  }
  for (const text of project.texts) {
    if (text.id === excludeId) continue
    points.add(text.start)
    points.add(text.start + text.duration)
  }
  for (const music of project.music) {
    if (music.id === excludeId) continue
    points.add(music.start)
    points.add(music.start + (music.srcOut - music.srcIn))
  }
  if (playhead !== undefined) points.add(playhead)
  return [...points].sort((a, b) => a - b)
}
