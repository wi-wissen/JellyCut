import { describe, expect, it } from 'vitest'
import { candidateFromFile, describeRelinkSummary, planRelink, usedAssetIds } from './relinkPlan'
import type { FileCandidate } from './relink'
import type { Asset, Clip, MusicItem, Project } from '../project/types'
import { createProject } from '../project/schema'

const asset = (id: string, name: string, size: number, duration = 10_000_000, kind: Asset['kind'] = 'video'): Asset => ({
  id, kind, name, relPath: name, size, duration
})
const clip = (id: string, assetId: string): Clip => ({
  id, track: 'video', assetId, srcIn: 0, srcOut: 1_000_000, start: 0, speed: 1,
  transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
  volume: 1, muted: false, filter: null, transitionIn: null
})
const music = (id: string, assetId: string): MusicItem => ({
  id, assetId, start: 0, srcIn: 0, srcOut: 1_000_000, volume: 1
} as MusicItem)
const cand = (key: string, name: string, size: number, duration?: number): FileCandidate => ({ key, name, size, duration })

function projectWith(assets: Asset[], clips: Clip[] = [], musicItems: MusicItem[] = []): Project {
  return { ...createProject('t'), assets, clips, music: musicItems }
}

describe('usedAssetIds', () => {
  it('collects assets referenced by clips and music', () => {
    const p = projectWith([asset('a', 'A.mp4', 1), asset('b', 'B.mp3', 2, 0, 'audio'), asset('c', 'C.mp4', 3)], [clip('c1', 'a')], [music('m1', 'b')])
    expect([...usedAssetIds(p)].sort()).toEqual(['a', 'b'])
  })
})

describe('planRelink', () => {
  it('only plans for used assets that are not ready', () => {
    const p = projectWith(
      [asset('a', 'A.mp4', 1), asset('b', 'B.mp4', 2), asset('unused', 'U.mp4', 3)],
      [clip('c1', 'a'), clip('c2', 'b')]
    )
    const plan = planRelink(p, { a: 'missing', b: 'ready' }, [cand('k1', 'A.mp4', 1), cand('k3', 'U.mp4', 3)])
    expect(plan.matches).toEqual({ a: { candidateKey: 'k1', reason: 'name-size' } })
    expect(plan.alreadyReady).toEqual(['b'])
    expect(plan.unmatched).toEqual([])
    expect(plan.ambiguous).toEqual({})
  })

  it('treats assets without a status as missing', () => {
    const p = projectWith([asset('a', 'A.mp4', 1)], [clip('c1', 'a')])
    expect(planRelink(p, {}, [cand('k1', 'A.mp4', 1)]).matches.a?.candidateKey).toBe('k1')
  })

  it('reports ambiguous and unmatched assets separately', () => {
    const p = projectWith([asset('a', 'A.mp4', 1), asset('b', 'B.mp4', 2)], [clip('c1', 'a'), clip('c2', 'b')])
    const plan = planRelink(p, {}, [cand('k1', 'A.mp4', 1), cand('k2', 'a.mp4', 1)])
    expect(plan.ambiguous).toEqual({ a: ['k1', 'k2'] })
    expect(plan.unmatched).toEqual(['b'])
  })
})

describe('describeRelinkSummary', () => {
  it('counts the outcome of a plan', () => {
    const p = projectWith(
      [asset('a', 'A.mp4', 1), asset('b', 'B.mp4', 2), asset('c', 'C.mp4', 3), asset('d', 'D.mp4', 4)],
      [clip('c1', 'a'), clip('c2', 'b'), clip('c3', 'c'), clip('c4', 'd')]
    )
    const plan = planRelink(p, { d: 'ready' }, [cand('k1', 'A.mp4', 1), cand('k2', 'B.mp4', 2), cand('k3', 'b.mp4', 2)])
    expect(describeRelinkSummary(plan)).toEqual({ missing: 3, matched: 1, ambiguous: 1, unmatched: 1, alreadyReady: 1 })
  })
  it('is all zero for an empty plan', () => {
    const plan = planRelink(projectWith([]), {}, [])
    expect(describeRelinkSummary(plan)).toEqual({ missing: 0, matched: 0, ambiguous: 0, unmatched: 0, alreadyReady: 0 })
  })
})

describe('candidateFromFile', () => {
  it('copies name and size and keeps the duration only when known', () => {
    expect(candidateFromFile({ name: 'a.mp4', size: 5 }, 'k')).toEqual({ key: 'k', name: 'a.mp4', size: 5 })
    expect(candidateFromFile({ name: 'a.mp4', size: 5 }, 'k', 1_000)).toEqual({ key: 'k', name: 'a.mp4', size: 5, duration: 1_000 })
  })
  it('has no duration property when unknown, so matching ignores it', () => {
    expect('duration' in candidateFromFile({ name: 'a', size: 1 }, 'k')).toBe(false)
  })
})
