import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Asset, Project } from '../project/types'
import { addAsset, addMusic, appendClip } from './insert'
import { assetUsage, removeAsset, removeUnusedAssets } from './assetOps'
import { setTransition } from './transitionOps'

const SEC = 1_000_000

function video(id: string, seconds = 4): Asset {
  return { id, kind: 'video', name: `${id}.mp4`, relPath: `media/${id}.mp4`, size: 1000, duration: seconds * SEC, width: 1920, height: 1080, fps: 30 }
}
function audio(id: string, seconds = 10): Asset {
  return { id, kind: 'audio', name: `${id}.mp3`, relPath: `media/${id}.mp3`, size: 500, duration: seconds * SEC }
}

/** A valid project: a (4 s), b (4 s), c (4 s) on the video track in this order, plus music from a and from b. */
function sample(): Project {
  let p = createProject('t')
  for (const a of [video('a'), video('b'), video('c'), audio('m')]) p = addAsset(p, a)
  p = appendClip(p, 'a', 'clip-1')
  p = appendClip(p, 'b', 'clip-2')
  p = appendClip(p, 'c', 'clip-3')
  p = appendClip(p, 'a', 'clip-4')
  p = addMusic(p, 'm', 'music-1', 0)
  p = addMusic(p, 'm', 'music-2', 5 * SEC)
  return p
}

const ids = (p: Project) => p.clips.map((c) => c.id)
const valid = (p: Project) => validateProject(JSON.parse(JSON.stringify(p))).ok

describe('assetUsage', () => {
  it('lists the clips and music items that use an asset', () => {
    const p = sample()
    expect(assetUsage(p, 'a')).toEqual({ clipIds: ['clip-1', 'clip-4'], musicIds: [] })
    expect(assetUsage(p, 'm')).toEqual({ clipIds: [], musicIds: ['music-1', 'music-2'] })
  })
  it('is empty for an unused or unknown asset', () => {
    expect(assetUsage(sample(), 'nope')).toEqual({ clipIds: [], musicIds: [] })
  })
})

describe('removeAsset', () => {
  it('removes the asset, all its clips and its music, and the track stays closed', () => {
    const before = sample()
    const after = removeAsset(before, 'a')
    expect(after.assets.map((a) => a.id)).toEqual(['b', 'c', 'm'])
    expect(ids(after)).toEqual(['clip-2', 'clip-3'])
    expect(after.clips.map((c) => c.start)).toEqual([0, 4 * SEC])
    expect(after.music.map((m) => m.assetId)).toEqual(['m', 'm'])
    expect(valid(after)).toBe(true)
  })

  it('removes music items of the asset and keeps the others', () => {
    const after = removeAsset(sample(), 'm')
    expect(after.music).toEqual([])
    expect(after.clips).toHaveLength(4)
    expect(valid(after)).toBe(true)
  })

  it('removes an asset that is not used on the timeline without touching clips', () => {
    let p = addAsset(sample(), video('unused'))
    const after = removeAsset(p, 'unused')
    expect(after.assets.some((a) => a.id === 'unused')).toBe(false)
    expect(after.clips).toEqual(sample().clips)
    expect(valid(after)).toBe(true)
  })

  it('drops a transition that is left on the first clip', () => {
    let p = setTransition(sample(), 'clip-2', { type: 'fade', duration: 500_000 })
    expect(p.clips.find((c) => c.id === 'clip-2')?.transitionIn).not.toBeNull()
    const after = removeAsset(p, 'a')
    expect(after.clips[0]?.id).toBe('clip-2')
    expect(after.clips[0]?.transitionIn).toBeNull()
    expect(valid(after)).toBe(true)
  })

  it('keeps a transition that still fits after the removal', () => {
    const p = setTransition(sample(), 'clip-3', { type: 'fade', duration: 500_000 })
    const after = removeAsset(p, 'a')
    expect(after.clips.find((c) => c.id === 'clip-3')?.transitionIn).not.toBeNull()
  })

  it('drops a transition that would now be longer than the clip before it', () => {
    // clip-2 is shortened to 0.5 s; after removing the first asset clip-3 follows it, and its 2 s transition no longer fits.
    let p = sample()
    p = setTransition(p, 'clip-3', { type: 'fade', duration: 2_000_000 })
    const shorter = { ...p, clips: p.clips.map((c) => (c.id === 'clip-2' ? { ...c, srcOut: c.srcIn + 500_000 } : c)) }
    const after = removeAsset(shorter, 'a')
    expect(after.clips.find((c) => c.id === 'clip-3')?.transitionIn).toBeNull()
    expect(valid(after)).toBe(true)
  })

  it('returns the same project object for an unknown asset', () => {
    const p = sample()
    expect(removeAsset(p, 'missing')).toBe(p)
  })

  it('does not change its input', () => {
    const p = sample()
    const snapshot = JSON.stringify(p)
    removeAsset(p, 'a')
    expect(JSON.stringify(p)).toBe(snapshot)
  })
})

describe('removeUnusedAssets', () => {
  it('removes assets that no clip or music item uses', () => {
    let p = addAsset(sample(), video('unused1'))
    p = addAsset(p, audio('unused2'))
    const after = removeUnusedAssets(p)
    expect(after.assets.map((a) => a.id).sort()).toEqual(['a', 'b', 'c', 'm'])
    expect(after.clips).toEqual(p.clips)
    expect(valid(after)).toBe(true)
  })

  it('returns the same project when every asset is used', () => {
    const p = sample()
    expect(removeUnusedAssets(p)).toBe(p)
  })

  it('leaves the clips and music alone', () => {
    const p = addAsset(sample(), video('unused'))
    const after = removeUnusedAssets(p)
    expect(after.clips).toEqual(p.clips)
    expect(after.music).toEqual(p.music)
  })
})
