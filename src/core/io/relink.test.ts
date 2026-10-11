import { describe, expect, it } from 'vitest'
import { matchCandidates, type FileCandidate } from './relink'
import type { Asset } from '../project/types'

const asset = (id: string, name: string, size: number, duration = 10_000_000, kind: Asset['kind'] = 'video'): Asset => ({
  id, kind, name, relPath: `media/${name}`, size, duration
})
const cand = (key: string, name: string, size: number, duration?: number): FileCandidate => ({ key, name, size, duration })

describe('matchCandidates', () => {
  it('matches by name and size', () => {
    const r = matchCandidates([asset('a1', 'Beach.mp4', 100)], [cand('k1', 'Beach.mp4', 100)])
    expect(r.matches).toEqual([{ assetId: 'a1', candidateKey: 'k1', reason: 'name-size' }])
    expect(r.unmatched).toEqual([])
    expect(r.ambiguous).toEqual([])
  })
  it('ignores case and surrounding folders in the name comparison', () => {
    const r = matchCandidates([asset('a1', 'Beach.MP4', 100)], [cand('k1', 'beach.mp4', 100)])
    expect(r.matches).toHaveLength(1)
  })
  it('does not match when size differs and no duration is known', () => {
    const r = matchCandidates([asset('a1', 'Beach.mp4', 100)], [cand('k1', 'Beach.mp4', 101)])
    expect(r.matches).toEqual([])
    expect(r.unmatched).toEqual(['a1'])
  })
  it('matches a renamed file by size and duration (within 1 ms)', () => {
    const r = matchCandidates([asset('a1', 'Beach.mp4', 100, 16_433_000)], [cand('k1', 'Strand.mp4', 100, 16_433_800)])
    expect(r.matches).toEqual([{ assetId: 'a1', candidateKey: 'k1', reason: 'size-duration' }])
  })
  it('does not match a renamed file when the duration is off by more than 1 ms', () => {
    const r = matchCandidates([asset('a1', 'Beach.mp4', 100, 16_433_000)], [cand('k1', 'Strand.mp4', 100, 16_435_000)])
    expect(r.matches).toEqual([])
  })
  it('never uses size-duration for images (duration 0 carries no information)', () => {
    const r = matchCandidates([asset('a1', 'Logo.png', 50, 0, 'image')], [cand('k1', 'Other.png', 50, 0)])
    expect(r.matches).toEqual([])
  })
  it('prefers name-size over size-duration when both exist', () => {
    const r = matchCandidates(
      [asset('a1', 'Beach.mp4', 100, 5_000_000)],
      [cand('k1', 'Copy of Beach.mp4', 100, 5_000_000), cand('k2', 'Beach.mp4', 100, 5_000_000)]
    )
    expect(r.matches).toEqual([{ assetId: 'a1', candidateKey: 'k2', reason: 'name-size' }])
  })
  it('reports several equally good candidates as ambiguous instead of guessing', () => {
    const r = matchCandidates(
      [asset('a1', 'Beach.mp4', 100)],
      [cand('k1', 'Beach.mp4', 100), cand('k2', 'beach.mp4', 100)]
    )
    expect(r.matches).toEqual([])
    expect(r.ambiguous).toEqual([{ assetId: 'a1', candidateKeys: ['k1', 'k2'] }])
  })
  it('does not assign one candidate to two assets', () => {
    const r = matchCandidates(
      [asset('a1', 'Beach.mp4', 100), asset('a2', 'Beach.mp4', 100)],
      [cand('k1', 'Beach.mp4', 100)]
    )
    expect(r.matches).toEqual([])
    expect(r.ambiguous.map((a) => a.assetId).sort()).toEqual(['a1', 'a2'])
  })
  it('handles many assets independently and keeps input order', () => {
    const r = matchCandidates(
      [asset('a1', 'A.mp4', 1), asset('a2', 'B.mp4', 2), asset('a3', 'C.mp4', 3)],
      [cand('k3', 'C.mp4', 3), cand('k1', 'A.mp4', 1)]
    )
    expect(r.matches.map((m) => m.assetId)).toEqual(['a1', 'a3'])
    expect(r.unmatched).toEqual(['a2'])
  })
  it('handles empty inputs', () => {
    expect(matchCandidates([], [])).toEqual({ matches: [], unmatched: [], ambiguous: [] })
    expect(matchCandidates([asset('a1', 'A.mp4', 1)], []).unmatched).toEqual(['a1'])
  })
  it('does not mutate its inputs', () => {
    const assets = Object.freeze([Object.freeze(asset('a1', 'A.mp4', 1))]) as Asset[]
    const cands = Object.freeze([Object.freeze(cand('k1', 'A.mp4', 1))]) as FileCandidate[]
    expect(() => matchCandidates(assets, cands)).not.toThrow()
  })
})
