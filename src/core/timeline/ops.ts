import type { Clip, FitMode, MusicItem, Project, TextItem, Transform } from '../project/types'
import { frameDuration, type Micros } from '../time'
import { clipEnd, findClipAt, rippleClose, splitClip, trimClipEnd, trimClipStart } from './edit'

export type ItemKind = 'clip' | 'text' | 'music'
export interface ItemRef {
  kind: ItemKind
  id: string
}

export interface ClipPatch {
  volume?: number
  muted?: boolean
  speed?: number
  transform?: Partial<Transform>
}

export const SPEED_STEPS: readonly number[] = [0.5, 1, 1.5, 2]
const MAX_VOLUME = 2
const FIT_MODES: readonly FitMode[] = ['fit', 'fill']

/** Next step of the speed cycle; any speed above the last step wraps to the first. */
export function nextSpeed(speed: number): number {
  return SPEED_STEPS.find((step) => step > speed) ?? SPEED_STEPS[0] ?? 1
}

export function projectIds(project: Project): Set<string> {
  return new Set([
    ...project.assets.map((a) => a.id),
    ...project.clips.map((c) => c.id),
    ...project.texts.map((t) => t.id),
    ...project.music.map((m) => m.id)
  ])
}

/** Every operation returns the input project itself when nothing changes, so no empty undo steps are made. */
function withClips(project: Project, clips: Clip[]): Project {
  return sameJson(clips, project.clips) ? project : { ...project, clips }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function packInOrder(clips: Clip[]): Clip[] {
  let cursor = 0
  return clips.map((clip) => {
    const placed = { ...clip, start: cursor }
    cursor = clipEnd(placed)
    return placed
  })
}

/** Splits the video clip under t. Returns the same project when no clip can be split there. */
export function splitAt(project: Project, t: Micros, newId: string): Project {
  if (projectIds(project).has(newId)) return project
  const at = Math.round(t)
  const clip = findClipAt(project.clips, at)
  if (!clip) return project
  const parts = splitClip(clip, at, newId)
  if (!parts) return project
  return withClips(project, project.clips.flatMap((c) => (c.id === clip.id ? parts : [c])))
}

export function deleteItem(project: Project, ref: ItemRef): Project {
  if (ref.kind === 'clip') {
    if (!project.clips.some((c) => c.id === ref.id)) return project
    return withClips(project, rippleClose(project.clips.filter((c) => c.id !== ref.id)))
  }
  if (ref.kind === 'text') {
    const texts = project.texts.filter((t) => t.id !== ref.id)
    return texts.length === project.texts.length ? project : { ...project, texts }
  }
  const music = project.music.filter((m) => m.id !== ref.id)
  return music.length === project.music.length ? project : { ...project, music }
}

/** Copies the item right after the original. Video copies ripple the track; text and music copies may overlap. */
export function duplicateItem(project: Project, ref: ItemRef, newId: string): Project {
  if (projectIds(project).has(newId)) return project
  if (ref.kind === 'clip') {
    const index = project.clips.findIndex((c) => c.id === ref.id)
    const original = project.clips[index]
    if (!original) return project
    const copy: Clip = {
      ...original,
      id: newId,
      start: clipEnd(original),
      transform: { ...original.transform },
      transitionIn: null
    }
    const clips = [...project.clips.slice(0, index + 1), copy, ...project.clips.slice(index + 1)]
    return withClips(project, rippleClose(clips))
  }
  if (ref.kind === 'text') {
    const index = project.texts.findIndex((t) => t.id === ref.id)
    const original = project.texts[index]
    if (!original) return project
    const copy: TextItem = {
      ...original,
      id: newId,
      start: original.start + original.duration,
      style: { ...original.style },
      pos: { ...original.pos }
    }
    return { ...project, texts: [...project.texts.slice(0, index + 1), copy, ...project.texts.slice(index + 1)] }
  }
  const index = project.music.findIndex((m) => m.id === ref.id)
  const original = project.music[index]
  if (!original) return project
  const copy: MusicItem = { ...original, id: newId, start: original.start + (original.srcOut - original.srcIn) }
  return { ...project, music: [...project.music.slice(0, index + 1), copy, ...project.music.slice(index + 1)] }
}

/**
 * Applies an edit to one video clip, then closes the track. The edit gets the clip and
 * the project; returning null rejects the edit and leaves the project unchanged.
 */
function updateClip(project: Project, clipId: string, update: (clip: Clip, project: Project) => Clip | null): Project {
  const target = project.clips.find((c) => c.id === clipId)
  if (!target) return project
  const next = update(target, project)
  if (!next) return project
  return withClips(
    project,
    rippleClose(project.clips.map((c) => (c.id === clipId ? next : c)))
  )
}

function assetDurationOf(project: Project, clip: Clip): Micros | null {
  return project.assets.find((a) => a.id === clip.assetId)?.duration ?? null
}

/** newStart is the requested timeline start; the track is closed afterwards, so the clip sits after its neighbour. */
export function trimVideoStart(project: Project, clipId: string, newStart: Micros): Project {
  if (!Number.isFinite(newStart)) return project
  return updateClip(project, clipId, (clip, p) => {
    const duration = assetDurationOf(p, clip)
    return duration === null ? null : trimClipStart(clip, Math.round(newStart), duration)
  })
}

export function trimVideoEnd(project: Project, clipId: string, newEnd: Micros): Project {
  if (!Number.isFinite(newEnd)) return project
  return updateClip(project, clipId, (clip, p) => {
    const duration = assetDurationOf(p, clip)
    return duration === null ? null : trimClipEnd(clip, Math.round(newEnd), duration)
  })
}

/** targetIndex is the position in the final order, clamped to the valid range. */
export function reorderVideoClip(project: Project, clipId: string, targetIndex: number): Project {
  if (!Number.isFinite(targetIndex)) return project
  const ordered = [...project.clips].sort((a, b) => a.start - b.start)
  const from = ordered.findIndex((c) => c.id === clipId)
  if (from < 0) return project
  const [moved] = ordered.splice(from, 1)
  if (!moved) return project
  const to = Math.min(Math.max(Math.trunc(targetIndex), 0), ordered.length)
  ordered.splice(to, 0, moved)
  return withClips(project, packInOrder(ordered))
}

/**
 * Changes volume, mute, speed or transform of one video clip. A speed change keeps
 * srcIn and srcOut, so the clip's timeline length changes and the track ripples.
 * Invalid values reject the whole patch.
 */
export function setClipProps(project: Project, clipId: string, patch: ClipPatch): Project {
  return updateClip(project, clipId, (clip) => {
    let next: Clip = clip
    if (patch.volume !== undefined) {
      if (!isVolume(patch.volume)) return null
      next = { ...next, volume: patch.volume }
    }
    if (patch.muted !== undefined) {
      if (typeof patch.muted !== 'boolean') return null
      next = { ...next, muted: patch.muted }
    }
    if (patch.speed !== undefined) {
      if (!isPositive(patch.speed)) return null
      if (Math.round((clip.srcOut - clip.srcIn) / patch.speed) < 1) return null
      next = { ...next, speed: patch.speed }
    }
    if (patch.transform !== undefined) {
      const transform: Transform = { ...next.transform, ...patch.transform }
      if (!isTransform(transform)) return null
      next = { ...next, transform }
    }
    return next
  })
}

function updateText(project: Project, id: string, update: (text: TextItem, minDuration: Micros) => TextItem | null): Project {
  const target = project.texts.find((t) => t.id === id)
  if (!target) return project
  const next = update(target, frameDuration(project.format.fps))
  if (!next) return project
  const texts = project.texts.map((t) => (t.id === id ? next : t))
  return sameJson(texts, project.texts) ? project : { ...project, texts }
}

/** The end stays where it is; the start is clamped to [0, end - one frame]. */
export function trimTextStart(project: Project, id: string, newStart: Micros): Project {
  return updateText(project, id, (text, minDuration) => {
    if (!Number.isFinite(newStart)) return null
    const end = text.start + text.duration
    const start = Math.min(Math.max(Math.round(newStart), 0), Math.max(0, end - minDuration))
    return { ...text, start, duration: end - start }
  })
}

/** The start stays where it is; the end is at least one frame after the start. */
export function trimTextEnd(project: Project, id: string, newEnd: Micros): Project {
  return updateText(project, id, (text, minDuration) => {
    if (!Number.isFinite(newEnd)) return null
    const end = Math.max(Math.round(newEnd), text.start + minDuration)
    return { ...text, duration: end - text.start }
  })
}

/** Moves a text item in time; its duration is kept. */
export function moveText(project: Project, id: string, newStart: Micros): Project {
  return updateText(project, id, (text) => {
    if (!Number.isFinite(newStart)) return null
    return { ...text, start: Math.max(0, Math.round(newStart)) }
  })
}

function isPositive(v: number): boolean {
  return Number.isFinite(v) && v > 0
}

function isVolume(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= MAX_VOLUME
}

function isTransform(t: Transform): boolean {
  return (
    FIT_MODES.includes(t.fit) &&
    isPositive(t.scale) &&
    Number.isFinite(t.x) &&
    Number.isFinite(t.y) &&
    Number.isFinite(t.rotation) &&
    typeof t.flipX === 'boolean'
  )
}
