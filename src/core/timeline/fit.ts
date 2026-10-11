import type { Project } from '../project/types'
import { planTimeline } from '../render/scene'
import type { Micros } from '../time'

/** Shortest span a new item gets at the very end of the video (or the rest of the video, if shorter). */
export const MIN_ADD_DURATION: Micros = 500_000

export interface Span {
  start: Micros
  duration: Micros
}

/**
 * End of the video: the planned end of the video and picture clips, transitions included.
 * Music and texts do not count. Zero when there are no clips.
 */
export function videoEnd(project: Project): Micros {
  return planTimeline(project).duration
}

/** A new item at the playhead: it starts at most MIN_ADD_DURATION before the end and keeps the default length when it fits. */
export function placeSpan(start: Micros, duration: Micros, end: Micros): Span {
  const at = Math.max(0, Math.round(start))
  if (end <= 0) return { start: at, duration }
  if (at >= end) {
    const kept = Math.min(duration, end)
    return { start: end - kept, duration: kept }
  }
  const minimum = Math.min(MIN_ADD_DURATION, end)
  const from = Math.min(at, end - minimum)
  return { start: from, duration: Math.min(duration, end - from) }
}

/** A move keeps the length and stops flush at the end. An item longer than the video is shortened to the video. */
export function moveSpan(start: Micros, duration: Micros, end: Micros): Span {
  const at = Math.max(0, Math.round(start))
  if (end <= 0) return { start: at, duration }
  const kept = Math.min(duration, end)
  return { start: Math.min(at, end - kept), duration: kept }
}

/** An item that reaches past the end is shortened at the end. One that starts at or after the end moves back so it ends there. */
export function fitSpan(start: Micros, duration: Micros, end: Micros): Span {
  if (end <= 0) return { start, duration }
  if (start >= end) {
    const kept = Math.min(duration, end)
    return { start: end - kept, duration: kept }
  }
  if (start + duration > end) return { start, duration: end - start }
  return { start, duration }
}

/**
 * Keeps every overlay and text item on the video. Returns the same project when nothing changes, so a
 * normalised project is not an extra undo step. Idempotent.
 */
export function fitToVideo(project: Project): Project {
  const end = videoEnd(project)
  if (end <= 0) return project
  let changed = false
  const fit = <T extends { start: Micros; duration: Micros }>(item: T): T => {
    const span = fitSpan(item.start, item.duration, end)
    if (span.start === item.start && span.duration === item.duration) return item
    changed = true
    return { ...item, start: span.start, duration: span.duration }
  }
  const overlays = project.overlays.map(fit)
  const texts = project.texts.map(fit)
  return changed ? { ...project, overlays, texts } : project
}

/** Span after an edit: a start-only edit moves the item and keeps its length, any other timing edit trims it at the end. */
export function editedSpan(span: Span, edit: { start?: unknown; duration?: unknown }, end: Micros): Span {
  return edit.start !== undefined && edit.duration === undefined
    ? moveSpan(span.start, span.duration, end)
    : fitSpan(span.start, span.duration, end)
}
