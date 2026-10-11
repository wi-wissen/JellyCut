import type { MediaInfo } from '../../engine/media/probe'
import { projectFit } from '../project/format'
import type { Asset, Clip, MusicItem, Project } from '../project/types'
import type { Micros } from '../time'
import { clipEnd, rippleClose } from './edit'
import { placeSpan, videoEnd } from './fit'

/** Duration stored for images: they have no length, so they can be trimmed freely within an hour. */
export const IMAGE_MAX_DURATION: Micros = 3_600_000_000
/** Timeline length of a freshly added image clip. */
export const DEFAULT_IMAGE_CLIP_DURATION: Micros = 5_000_000

const MUSIC_VOLUME = 0.6

export function assetFromProbe(info: MediaInfo, id: string, relPath: string): Asset {
  const asset: Asset = {
    id,
    kind: info.kind,
    name: info.name,
    relPath,
    size: info.size,
    duration: info.kind === 'image' ? IMAGE_MAX_DURATION : info.duration
  }
  if (info.width !== undefined) asset.width = info.width
  if (info.height !== undefined) asset.height = info.height
  if (info.fps !== undefined) asset.fps = info.fps
  if (info.kind !== 'image') asset.hasAudio = info.hasAudio
  return asset
}

export function addAsset(project: Project, asset: Asset): Project {
  if (project.assets.some((a) => a.id === asset.id)) {
    throw new RangeError(`asset id "${asset.id}" already exists`)
  }
  return { ...project, assets: [...project.assets, asset] }
}

/** Appends a video or image clip after the last clip of the video track. */
export function appendClip(project: Project, assetId: string, newClipId: string): Project {
  const clip = newVideoClip(project, assetId, newClipId, 0)
  const start = project.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0)
  return { ...project, clips: [...project.clips, { ...clip, start }] }
}

/**
 * Inserts a video or image clip at the cut (boundary between clips, or the very start or end)
 * nearest to `time`, then closes all gaps on the video track.
 */
export function insertClipAt(project: Project, assetId: string, newClipId: string, time: Micros): Project {
  const sorted = [...project.clips].sort((a, b) => a.start - b.start)
  const index = nearestCutIndex(sorted, time)
  const clip = newVideoClip(project, assetId, newClipId, 0)
  const ordered = [...sorted.slice(0, index), clip, ...sorted.slice(index)]
  // rippleClose orders by start, so the position in `ordered` becomes the start key.
  const keyed = ordered.map((c, i) => ({ ...c, start: i }))
  return { ...project, clips: rippleClose(keyed) }
}

/** Adds an audio asset as a music bed at `start`, placed like an overlay: it ends at the video end when it would pass it. */
export function addMusic(project: Project, assetId: string, newId: string, start: Micros): Project {
  const asset = findAsset(project, assetId)
  if (asset.kind !== 'audio') {
    throw new RangeError(`asset "${assetId}" is ${asset.kind}, not audio`)
  }
  assertFreeId(project, newId)
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new RangeError(`start must be a non-negative integer, got ${start}`)
  }
  const span = placeSpan(start, asset.duration, videoEnd(project))
  const item: MusicItem = {
    id: newId,
    assetId,
    start: span.start,
    srcIn: 0,
    srcOut: span.duration,
    volume: MUSIC_VOLUME,
    fadeIn: 0,
    fadeOut: 0
  }
  return { ...project, music: [...project.music, item] }
}

function findAsset(project: Project, assetId: string): Asset {
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) throw new RangeError(`unknown asset "${assetId}"`)
  return asset
}

function assertFreeId(project: Project, id: string): void {
  const taken =
    project.clips.some((c) => c.id === id) ||
    project.texts.some((t) => t.id === id) ||
    project.music.some((m) => m.id === id) ||
    project.assets.some((a) => a.id === id)
  if (taken) throw new RangeError(`id "${id}" already exists`)
}

function newVideoClip(project: Project, assetId: string, newClipId: string, start: Micros): Clip {
  const asset = findAsset(project, assetId)
  if (asset.kind === 'audio') {
    throw new RangeError(`asset "${assetId}" is audio; use addMusic`)
  }
  assertFreeId(project, newClipId)
  const srcOut = asset.kind === 'image' ? DEFAULT_IMAGE_CLIP_DURATION : asset.duration
  if (!Number.isSafeInteger(srcOut) || srcOut < 1) {
    throw new RangeError(`asset "${assetId}" has no usable duration`)
  }
  return {
    id: newClipId,
    track: 'video',
    assetId,
    srcIn: 0,
    srcOut,
    start,
    speed: 1,
    transform: { fit: projectFit(project), scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null
  }
}

/**
 * Index in the start-sorted clip list where a clip inserted at `time` goes.
 * Candidate cuts are the start and end of every clip plus the very beginning; ties keep the earlier cut.
 */
function nearestCutIndex(sorted: Clip[], time: Micros): number {
  let bestIndex = 0
  let bestDistance = Math.abs(time)
  sorted.forEach((clip, i) => {
    const before = Math.abs(time - clip.start)
    if (before < bestDistance) {
      bestDistance = before
      bestIndex = i
    }
    const after = Math.abs(time - clipEnd(clip))
    if (after < bestDistance) {
      bestDistance = after
      bestIndex = i + 1
    }
  })
  return bestIndex
}
