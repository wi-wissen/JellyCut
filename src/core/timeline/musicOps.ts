import type { MusicItem, Project } from '../project/types'
import { secondsToMicros, type Micros } from '../time'

export interface MusicPatch {
  volume?: number
  fadeIn?: Micros
  fadeOut?: Micros
}

const MAX_VOLUME = 2
export const MAX_FADE: Micros = secondsToMicros(5)

/**
 * Changes volume and fades of one music item. Values are clamped (volume 0..2, fades 0..5 s and
 * never longer than the item). A non-finite value rejects the whole patch.
 */
export function updateMusic(project: Project, id: string, patch: MusicPatch): Project {
  const target = project.music.find((m) => m.id === id)
  if (!target) return project
  const next = applyPatch(target, patch)
  if (!next) return project
  const music = project.music.map((m) => (m.id === id ? next : m))
  return sameItems(music, project.music) ? project : { ...project, music }
}

function applyPatch(item: MusicItem, patch: MusicPatch): MusicItem | null {
  const length = item.srcOut - item.srcIn
  const fadeLimit = Math.min(MAX_FADE, length)
  const next: MusicItem = { ...item }
  if (patch.volume !== undefined) {
    if (!Number.isFinite(patch.volume)) return null
    next.volume = clamp(patch.volume, 0, MAX_VOLUME)
  }
  if (patch.fadeIn !== undefined) {
    if (!Number.isFinite(patch.fadeIn)) return null
    next.fadeIn = Math.round(clamp(patch.fadeIn, 0, fadeLimit))
  }
  if (patch.fadeOut !== undefined) {
    if (!Number.isFinite(patch.fadeOut)) return null
    next.fadeOut = Math.round(clamp(patch.fadeOut, 0, fadeLimit))
  }
  return next
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

function sameItems(a: MusicItem[], b: MusicItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
