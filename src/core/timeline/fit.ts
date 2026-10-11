import type { MusicItem, Project } from '../project/types'
import { planTimeline } from '../render/scene'
import { itemLoopMicros } from '../render/stickerAnimations'
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

/** Nearest whole number of loops (at least one), in microseconds. */
export function snapLoops(duration: Micros, loop: Micros): Micros {
  return Math.max(1, Math.round(duration / loop)) * loop
}

/** Whole loops that fit into `room`, in microseconds; 0 when not even one fits. */
export function wholeLoops(room: Micros, loop: Micros): Micros {
  return Math.floor(Math.max(0, room) / loop) * loop
}

/**
 * Longest allowed length in `room`. Without a loop that is the room itself. An animated item (`loop` set) is
 * rounded down to whole loops so it never stops mid-motion; only when less than one loop fits does it run to the end.
 */
function limit(duration: Micros, room: Micros, loop?: Micros): Micros {
  if (loop === undefined) return Math.min(duration, room)
  const whole = wholeLoops(room, loop)
  return whole > 0 ? Math.min(duration, whole) : room
}

/**
 * A new item at the playhead: it starts at most MIN_ADD_DURATION before the end and keeps the default length when it fits.
 * With `loop` the length is whole loops (shortened by rounding down).
 */
export function placeSpan(start: Micros, duration: Micros, end: Micros, loop?: Micros): Span {
  const at = Math.max(0, Math.round(start))
  const wanted = loop === undefined ? duration : snapLoops(duration, loop)
  if (end <= 0) return { start: at, duration: wanted }
  if (at >= end) {
    const kept = limit(wanted, end, loop)
    return { start: end - kept, duration: kept }
  }
  const minimum = Math.min(MIN_ADD_DURATION, end)
  const from = Math.min(at, end - minimum)
  return { start: from, duration: limit(wanted, end - from, loop) }
}

/** A move keeps the length and stops flush at the end. An item longer than the video is shortened to the video (whole loops for animated items). */
export function moveSpan(start: Micros, duration: Micros, end: Micros, loop?: Micros): Span {
  const at = Math.max(0, Math.round(start))
  const wanted = loop === undefined ? duration : snapLoops(duration, loop)
  if (end <= 0) return { start: at, duration: wanted }
  const kept = limit(wanted, end, loop)
  return { start: Math.min(at, end - kept), duration: kept }
}

/**
 * An item that reaches past the end is shortened at the end (rounded down to whole loops for animated items).
 * One that starts at or after the end moves back so it ends there.
 */
export function fitSpan(start: Micros, duration: Micros, end: Micros, loop?: Micros): Span {
  const wanted = loop === undefined ? duration : snapLoops(duration, loop)
  if (end <= 0) return { start, duration: wanted }
  if (start >= end) {
    const kept = limit(wanted, end, loop)
    return { start: end - kept, duration: kept }
  }
  if (start + wanted > end) return { start, duration: limit(wanted, end - start, loop) }
  return { start, duration: wanted }
}

/** Music plays at speed 1, so its span is the source range. */
export function musicSpan(item: MusicItem): Span {
  return { start: item.start, duration: item.srcOut - item.srcIn }
}

/** Puts a span on a music item. srcIn stays, so a shortened item plays the start of its audio and its fades follow the new end. */
export function withMusicSpan(item: MusicItem, span: Span): MusicItem {
  return { ...item, start: span.start, srcOut: item.srcIn + span.duration }
}

/**
 * Keeps every overlay, text and music item on the video. Returns the same project when nothing changes, so a
 * normalised project is not an extra undo step. Idempotent.
 */
export function fitToVideo(project: Project): Project {
  const end = videoEnd(project)
  let changed = false
  const fit = <T extends { start: Micros; duration: Micros }>(item: T, loop?: Micros): T => {
    const span = fitSpan(item.start, item.duration, end, loop)
    if (span.start === item.start && span.duration === item.duration) return item
    changed = true
    return { ...item, start: span.start, duration: span.duration }
  }
  // Animated stickers keep whole loops even without clips; everything else is only fitted to an existing video.
  const overlays = project.overlays.map((item) => (end > 0 || itemLoopMicros(item) !== undefined ? fit(item, itemLoopMicros(item)) : item))
  if (end <= 0) return changed ? { ...project, overlays } : project
  const texts = project.texts.map((item) => fit(item))
  const music = project.music.map((item) => {
    const current = musicSpan(item)
    const span = fitSpan(current.start, current.duration, end)
    if (span.start === current.start && span.duration === current.duration) return item
    changed = true
    return withMusicSpan(item, span)
  })
  return changed ? { ...project, overlays, texts, music } : project
}

/** Span after an edit: a start-only edit moves the item and keeps its length, any other timing edit trims it at the end. */
export function editedSpan(span: Span, edit: { start?: unknown; duration?: unknown }, end: Micros, loop?: Micros): Span {
  return edit.start !== undefined && edit.duration === undefined
    ? moveSpan(span.start, span.duration, end, loop)
    : fitSpan(span.start, span.duration, end, loop)
}
