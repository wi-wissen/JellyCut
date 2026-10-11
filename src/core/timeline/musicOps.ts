import type { MusicItem, Project } from '../project/types'
import { frameDuration, secondsToMicros, type Micros } from '../time'

export interface MusicPatch {
  volume?: number
  fadeIn?: Micros
  fadeOut?: Micros
  muted?: boolean
}

const MAX_VOLUME = 2
export const MAX_FADE: Micros = secondsToMicros(5)

/**
 * Changes volume, fades and mute of one music item. Values are clamped (volume 0..2, fades 0..5 s and
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
  if (patch.muted !== undefined) {
    if (typeof patch.muted !== 'boolean') return null
    next.muted = patch.muted
  }
  return next
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

function sameItems(a: MusicItem[], b: MusicItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function replaceMusic(project: Project, id: string, update: (item: MusicItem) => MusicItem | null): Project {
  const target = project.music.find((m) => m.id === id)
  if (!target) return project
  const next = update(target)
  if (!next) return project
  const music = project.music.map((m) => (m.id === id ? next : m))
  return sameItems(music, project.music) ? project : { ...project, music }
}

/** Moves a music item in time; the source range and the length are kept. The start is at least 0. */
export function moveMusic(project: Project, id: string, newStart: Micros): Project {
  return replaceMusic(project, id, (item) => {
    if (!Number.isFinite(newStart)) return null
    return { ...item, start: Math.max(0, Math.round(newStart)) }
  })
}

/**
 * Moves the start handle. Music plays at speed 1, so the timeline and the source move together: the
 * start can go left only as far as the source has audio before srcIn, and it never crosses the end
 * or gets shorter than one frame.
 */
export function trimMusicStart(project: Project, id: string, newStart: Micros, fps: number): Project {
  const minLength = frameDuration(fps)
  return replaceMusic(project, id, (item) => {
    if (!Number.isFinite(newStart)) return null
    const length = item.srcOut - item.srcIn
    const delta = clamp(Math.round(newStart) - item.start, Math.max(-item.srcIn, -item.start), length - minLength)
    return { ...item, start: item.start + delta, srcIn: item.srcIn + delta }
  })
}

/** Moves the end handle. The end can grow only up to the end of the source file. */
export function trimMusicEnd(project: Project, id: string, newEnd: Micros, fps: number): Project {
  const minLength = frameDuration(fps)
  return replaceMusic(project, id, (item) => {
    if (!Number.isFinite(newEnd)) return null
    const asset = project.assets.find((a) => a.id === item.assetId)
    if (!asset) return null
    const nextLength = clamp(Math.round(newEnd) - item.start, minLength, asset.duration - item.srcIn)
    return { ...item, srcOut: item.srcIn + nextLength }
  })
}

/**
 * Splits a music item at t into two items that play the same source one after the other. The first
 * part keeps the fade-in, the second the fade-out. Returns the project unchanged when t is not inside
 * the item with at least one frame on both sides.
 */
export function splitMusicAt(project: Project, id: string, t: Micros, newId: string, fps: number): Project {
  const index = project.music.findIndex((m) => m.id === id)
  const item = project.music[index]
  if (index < 0 || !item || project.music.some((m) => m.id === newId)) return project
  const at = Math.round(t)
  const minLength = frameDuration(fps)
  const offset = at - item.start
  const length = item.srcOut - item.srcIn
  if (!Number.isFinite(offset) || offset < minLength || length - offset < minLength) return project
  const first: MusicItem = { ...item, srcOut: item.srcIn + offset, fadeOut: 0 }
  const second: MusicItem = { ...item, id: newId, start: at, srcIn: item.srcIn + offset, fadeIn: 0 }
  const music = [...project.music.slice(0, index), first, second, ...project.music.slice(index + 1)]
  return { ...project, music }
}
