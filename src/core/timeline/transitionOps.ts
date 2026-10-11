import type { Clip, Project } from '../project/types'
import { TRANSITION_TYPES, type TransitionType } from '../render/types'
import type { Micros } from '../time'
import { clipDuration } from './edit'
import type { ItemRef } from './ops'

export const MIN_TRANSITION: Micros = 100_000
export const MAX_TRANSITION: Micros = 2_000_000
export const DEFAULT_TRANSITION: Micros = 500_000

export interface TransitionSpec {
  type: TransitionType
  duration: Micros
}

/** Video clips in timeline order. */
function orderedClips(project: Project): Clip[] {
  return [...project.clips].sort((a, b) => a.start - b.start)
}

/** Index in timeline order: 0 is the first clip, which has no cut before it. */
function indexOfClip(project: Project, clipId: string): number {
  return orderedClips(project).findIndex((c) => c.id === clipId)
}

/** Whether a clip can have a transition at its start (every video clip except the first). */
export function canHaveTransition(project: Project, clipId: string): boolean {
  return indexOfClip(project, clipId) > 0
}

/**
 * Sets (or removes, with null) the transition at the cut before a clip. The duration is clamped to
 * 0.1..2 s and to the shorter of the two clips that meet at the cut. Refused cases (first clip,
 * unknown type, unknown clip, no usable duration) return the project unchanged.
 */
export function setTransition(project: Project, clipId: string, spec: TransitionSpec | null): Project {
  const index = indexOfClip(project, clipId)
  if (index <= 0) return project
  const clip = project.clips[project.clips.findIndex((c) => c.id === clipId)]
  if (!clip) return project

  let transitionIn: Clip['transitionIn'] = null
  if (spec !== null) {
    if (!(TRANSITION_TYPES as readonly string[]).includes(spec.type)) return project
    const previous = orderedClips(project)[index - 1]
    if (!previous || !Number.isFinite(spec.duration)) return project
    const cap = Math.min(clipDuration(previous), clipDuration(clip))
    const duration = Math.min(Math.max(Math.round(spec.duration), MIN_TRANSITION), MAX_TRANSITION, cap)
    if (duration < 1) return project
    transitionIn = { type: spec.type, duration }
  }

  if (JSON.stringify(clip.transitionIn) === JSON.stringify(transitionIn)) return project
  return {
    ...project,
    clips: project.clips.map((c) => (c.id === clipId ? { ...c, transitionIn } : c))
  }
}

/**
 * The clip a transition would apply to: the selected clip if it is a video clip after the first one,
 * otherwise the clip after the first one that starts nearest to the playhead (earlier start wins a
 * tie). Null when the project has no clip after the first.
 */
export function transitionTargetClipId(project: Project, selection: ItemRef | null, playhead: Micros): string | null {
  if (selection?.kind === 'clip' && canHaveTransition(project, selection.id)) return selection.id
  let best: Clip | null = null
  let bestDistance = Infinity
  for (const clip of orderedClips(project).slice(1)) {
    const distance = Math.abs(clip.start - playhead)
    if (distance < bestDistance) {
      best = clip
      bestDistance = distance
    }
  }
  return best?.id ?? null
}
