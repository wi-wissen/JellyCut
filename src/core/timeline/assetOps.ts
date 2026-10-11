import type { Clip, Project } from '../project/types'
import { clipDuration } from './edit'
import { deleteItem } from './ops'
import { canHaveTransition } from './transitionOps'

/** Where a media asset is used on the timeline. */
export interface AssetUsage {
  clipIds: string[]
  musicIds: string[]
}

export function assetUsage(project: Project, assetId: string): AssetUsage {
  return {
    clipIds: project.clips.filter((c) => c.assetId === assetId).map((c) => c.id),
    musicIds: project.music.filter((m) => m.assetId === assetId).map((m) => m.id)
  }
}

/**
 * Removes the asset and every clip and music item that uses it. Video clips go through the normal
 * delete, so the video track closes up. Transitions that no longer fit are dropped.
 * Unknown ids return the project unchanged.
 */
export function removeAsset(project: Project, assetId: string): Project {
  if (!project.assets.some((a) => a.id === assetId)) return project
  const usage = assetUsage(project, assetId)
  let next: Project = { ...project, music: project.music.filter((m) => m.assetId !== assetId) }
  for (const id of usage.clipIds) next = deleteItem(next, { kind: 'clip', id })
  next = { ...next, assets: next.assets.filter((a) => a.id !== assetId) }
  return dropInvalidTransitions(next)
}

/** Removes every asset that no clip or music item uses. Returns the project unchanged when there are none. */
export function removeUnusedAssets(project: Project): Project {
  const used = new Set<string>([...project.clips.map((c) => c.assetId), ...project.music.map((m) => m.assetId)])
  const assets = project.assets.filter((a) => used.has(a.id))
  return assets.length === project.assets.length ? project : { ...project, assets }
}

/** A transition stays only on a clip that has a previous clip and is no longer than the shorter of the two. */
function dropInvalidTransitions(project: Project): Project {
  const byStart = [...project.clips].sort((a, b) => a.start - b.start)
  let changed = false
  const clips = project.clips.map((clip): Clip => {
    if (!clip.transitionIn) return clip
    const index = byStart.findIndex((c) => c.id === clip.id)
    const previous = index > 0 ? byStart[index - 1] : undefined
    const fits =
      canHaveTransition(project, clip.id) &&
      previous !== undefined &&
      clip.transitionIn.duration <= Math.min(clipDuration(previous), clipDuration(clip))
    if (fits) return clip
    changed = true
    return { ...clip, transitionIn: null }
  })
  return changed ? { ...project, clips } : project
}
