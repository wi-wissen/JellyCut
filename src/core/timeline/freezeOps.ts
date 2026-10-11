import type { Clip, Project } from '../project/types'
import type { Micros } from '../time'
import { clipEnd, findClipAt, rippleClose, sourceTimeAt, splitClip } from './edit'

/** Timeline length of a new freeze frame. */
export const FREEZE_DEFAULT_DURATION: Micros = 2_000_000

/**
 * Puts a freeze frame at timeline time t: the picture under t is held for `duration` and the video
 * track ripples to make room. The clip under t is split there, so the frame sits between the halves.
 * Returns the same project when no video clip is under t or the split is impossible.
 */
export function freezeFrameAt(
  project: Project,
  t: Micros,
  ids: { stillId: string; splitId: string },
  duration: Micros = FREEZE_DEFAULT_DURATION
): Project {
  const at = Math.round(t)
  const clip = findClipAt(project.clips, at)
  if (!clip || duration < 1 || ids.stillId === ids.splitId) return project

  const held = sourceTimeAt(clip, at)
  const frameOf = (start: Micros): Clip => ({
    ...clip,
    id: ids.stillId,
    srcIn: 0,
    srcOut: duration,
    start,
    speed: 1,
    volume: 1,
    muted: true,
    transitionIn: null,
    transform: { ...clip.transform },
    still: held
  })

  let replaced: Clip[]
  if (clip.start < at) {
    const split = splitClip(clip, at, ids.splitId)
    if (!split) return project
    const [left, right] = split
    // The frame starts where the left half ends, so the sort in rippleClose keeps left, frame, right.
    replaced = [left, frameOf(clipEnd(left)), right]
  } else {
    // At the very start of the clip: the frame goes in front and the clip keeps its transition.
    replaced = [frameOf(clip.start), clip]
  }

  const clips = project.clips.flatMap((c) => (c.id === clip.id ? replaced : [c]))
  return { ...project, clips: rippleClose(clips) }
}
