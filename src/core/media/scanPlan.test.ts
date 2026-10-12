import { describe, expect, it } from 'vitest'
import {
  DENSE_LEAD,
  FULL_RING,
  SPARSE_GAP,
  SPARSE_THUMB_STEP,
  firstMissing,
  fineCutWant,
  isSparseGap,
  passFraction,
  pickRun,
  thumbSize,
  wantsFull,
  wantsThumb
} from './scanPlan'

const FRAME = 33_333

describe('scan plan', () => {
  it('treats a missing keyframe or a far one as sparse', () => {
    expect(isSparseGap(10_000_000, null)).toBe(true)
    expect(isSparseGap(10_000_000, 10_000_000 - SPARSE_GAP - 1)).toBe(true)
    expect(isSparseGap(10_000_000, 9_000_000)).toBe(false)
  })

  it('wants every thumbnail near the window and a sparse sample elsewhere', () => {
    const want = fineCutWant(15_000_000, FRAME)
    expect(wantsThumb(want.thumbFrom - DENSE_LEAD + 1, 0, want)).toBe(true)
    expect(wantsThumb(want.thumbTo, 0, want)).toBe(true)
    expect(wantsThumb(1_000_000, 900_000, want)).toBe(false)
    expect(wantsThumb(1_000_000, 1_000_000 - SPARSE_THUMB_STEP, want)).toBe(true)
    expect(wantsThumb(19_000_000, 18_990_000, null, 20_000_000)).toBe(true)
    expect(wantsThumb(10_000_000, 9_990_000, null, 20_000_000)).toBe(false)
    expect(wantsThumb(5, null, null)).toBe(true)
    expect(wantsThumb(100_000, 5, null)).toBe(false)
  })

  it('keeps full frames for the ring before the target, the window and the last frame', () => {
    const want = fineCutWant(15_000_000, FRAME)
    const lookup = { covers: false, ringTarget: 20_000_000, spacing: FRAME }
    expect(wantsFull(1_000_000, lookup, null)).toBe(false)
    expect(wantsFull(20_000_000 - FULL_RING, lookup, null)).toBe(true)
    expect(wantsFull(15_000_000, lookup, want)).toBe(true)
    expect(wantsFull(100, { covers: true, ringTarget: null, spacing: 0 }, null)).toBe(true)
    // In a pass over a window only the window's own full frames are kept, not a ring at the pass end.
    const pass = { covers: false, ringTarget: null, spacing: FRAME }
    expect(wantsFull(want.thumbTo, pass, want)).toBe(false)
    expect(wantsFull(want.fullTo, pass, want)).toBe(true)
    // A margin around the needed frames is kept as well, so stepping by a frame finds its pictures.
    expect(wantsFull(want.fullFrom - 600_000, pass, want)).toBe(true)
    expect(wantsFull(want.fullFrom - 600_001, pass, want)).toBe(false)
    expect(wantsFull(want.fullTo + 3 * FRAME, pass, want)).toBe(true)
    expect(wantsFull(want.fullTo + 4 * FRAME, pass, want)).toBe(false)
    // Slow stretch (5 pictures a second): the margins count pictures, not time.
    const slow = { covers: false, ringTarget: 20_000_000, spacing: 200_000 }
    expect(wantsFull(20_000_000 - 3_000_000, slow, null)).toBe(true)
    expect(wantsFull(20_000_000 - 3_300_000, slow, null)).toBe(false)
    expect(wantsFull(want.fullFrom - 1_600_000, { ...slow, ringTarget: null }, want)).toBe(true)
  })

  it('builds the fine cut window without going below zero', () => {
    const want = fineCutWant(500_000, FRAME)
    expect(want.thumbFrom).toBe(0)
    expect(want.fullFrom).toBe(500_000 - 2 * FRAME)
    expect(want.thumbTo).toBe(500_000 + 64 * FRAME)
  })

  it('finds the first probed time the cache lacks', () => {
    const have = new Set([0, 10, 20, 40])
    expect(firstMissing((t) => have.has(t), 0, 40, 10)).toBe(30)
    expect(firstMissing((t) => have.has(t), 0, 20, 10)).toBeNull()
    expect(firstMissing((t) => t < 25, 0, 25, 10)).toBe(25)
  })

  it('continues the run closest behind a time, from the same keyframe only', () => {
    const runs = [
      { key: 0, nextStart: 2_000_000 },
      { key: 0, nextStart: 9_000_000 },
      { key: 5_000_000, nextStart: 6_000_000 }
    ]
    expect(pickRun(runs, 0, 10_000_000)).toBe(1)
    expect(pickRun(runs, 0, 8_000_000)).toBe(0)
    expect(pickRun(runs, 0, 1_000_000)).toBe(-1)
    expect(pickRun(runs, 5_000_000, 5_500_000)).toBe(-1)
  })

  it('scales thumbnails down and never up', () => {
    expect(thumbSize(1280, 720)).toEqual({ width: 160, height: 90 })
    expect(thumbSize(100, 50)).toEqual({ width: 100, height: 50 })
  })

  it('reports pass progress between 0 and 1', () => {
    expect(passFraction(0, 5_000_000, 10_000_000)).toBe(0.5)
    expect(passFraction(0, -1, 10)).toBe(0)
    expect(passFraction(10, 50, 10)).toBe(1)
  })
})
