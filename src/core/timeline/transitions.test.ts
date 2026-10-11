import { describe, expect, it } from 'vitest'
import type { Clip } from '../project/types'
import { clipDuration, clipEnd, rippleClose } from './edit'
import { planTransitions } from './transitions'

const ASSET_DURATIONS = { v: 10_000_000 }

function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new RangeError(`no item at index ${index}`)
  return item
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'a',
    track: 'video',
    assetId: 'v',
    srcIn: 0,
    srcOut: 4_000_000,
    start: 0,
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null,
    ...overrides,
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

const fade = (duration: number) => ({ type: 'fade', duration })

describe('planTransitions', () => {
  it('returns an empty result for an empty list', () => {
    expect(planTransitions([], ASSET_DURATIONS)).toEqual({
      clips: [],
      transitions: [],
      shortenedBy: 0,
    })
  })

  it('extends both sides symmetrically when both handles are sufficient', () => {
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 4_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 3_000_000,
      srcOut: 6_000_000,
      start: 4_000_000,
      transitionIn: fade(1_000_000),
    })
    const result = planTransitions(deepFreeze([a, b]), ASSET_DURATIONS)

    expect(result.shortenedBy).toBe(0)
    expect(at(result.clips, 0)).toMatchObject({ srcIn: 0, srcOut: 4_500_000, start: 0 })
    expect(at(result.clips, 1)).toMatchObject({ srcIn: 2_500_000, srcOut: 6_000_000, start: 3_500_000 })
    expect(at(result.clips, 1).transitionIn).toEqual(fade(1_000_000))
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 3_500_000, duration: 1_000_000, requested: 1_000_000 },
    ])
    expect(clipEnd(at(result.clips, 1))).toBe(7_000_000)
  })

  it('makes up a missing right-side handle by pulling later clips earlier', () => {
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 4_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 200_000,
      srcOut: 3_200_000,
      start: 4_000_000,
      transitionIn: fade(1_000_000),
    })
    const c = makeClip({ id: 'c', srcIn: 0, srcOut: 1_000_000, start: 7_000_000 })
    const result = planTransitions(deepFreeze([a, b, c]), ASSET_DURATIONS)

    // Left handle 200_000 is used up, A takes 500_000, the remaining 300_000 is a shortage.
    expect(result.shortenedBy).toBe(300_000)
    expect(at(result.clips, 0).srcOut).toBe(4_500_000)
    expect(at(result.clips, 1)).toMatchObject({ srcIn: 0, start: 3_500_000 })
    expect(clipEnd(at(result.clips, 1))).toBe(6_700_000)
    expect(at(result.clips, 2).start).toBe(6_700_000)
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 3_500_000, duration: 1_000_000, requested: 1_000_000 },
    ])
  })

  it('shortens the project by the full duration when no handles exist', () => {
    const a = makeClip({ id: 'a', srcIn: 6_000_000, srcOut: 10_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 0,
      srcOut: 3_000_000,
      start: 4_000_000,
      transitionIn: fade(1_000_000),
    })
    const c = makeClip({ id: 'c', srcIn: 0, srcOut: 1_000_000, start: 7_000_000 })
    const result = planTransitions(deepFreeze([a, b, c]), ASSET_DURATIONS)

    expect(result.shortenedBy).toBe(1_000_000)
    expect(at(result.clips, 0)).toMatchObject({ srcOut: 10_000_000, start: 0 })
    expect(at(result.clips, 1)).toMatchObject({ srcIn: 0, srcOut: 3_000_000, start: 3_000_000 })
    expect(at(result.clips, 2).start).toBe(6_000_000)
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 3_000_000, duration: 1_000_000, requested: 1_000_000 },
    ])
  })

  it('keeps odd microsecond durations exact (total length unchanged)', () => {
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 4_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 3_000_000,
      srcOut: 6_000_000,
      start: 4_000_000,
      transitionIn: fade(1_000_001),
    })
    const result = planTransitions(deepFreeze([a, b]), ASSET_DURATIONS)

    // half = 500_000 from A, the odd microsecond comes from B.
    expect(result.shortenedBy).toBe(0)
    expect(at(result.clips, 0).srcOut).toBe(4_500_000)
    expect(at(result.clips, 1)).toMatchObject({ srcIn: 2_499_999, start: 3_499_999 })
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 3_499_999, duration: 1_000_001, requested: 1_000_001 },
    ])
    expect(clipEnd(at(result.clips, 0))).toBe(at(result.clips, 1).start + 1_000_001)
    expect(clipEnd(at(result.clips, 1))).toBe(7_000_000)
  })

  it('handles speed 2 on the second clip (source moves 999_999 us for 500_000 us timeline)', () => {
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 4_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 3_000_000,
      srcOut: 7_000_000,
      speed: 2,
      start: 4_000_000,
      transitionIn: fade(1_000_000),
    })
    const result = planTransitions(deepFreeze([a, b]), ASSET_DURATIONS)

    expect(result.shortenedBy).toBe(0)
    // Math.round is half-up, so 999_999 source us is the smallest move that yields 500_000 timeline us.
    expect(at(result.clips, 1)).toMatchObject({ srcIn: 2_000_001, start: 3_500_000 })
    expect(clipDuration(at(result.clips, 1))).toBe(2_500_000)
    expect(clipEnd(at(result.clips, 1))).toBe(6_000_000)
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 3_500_000, duration: 1_000_000, requested: 1_000_000 },
    ])
  })

  it('handles speed 0.5 on the second clip (source moves 250_000 us for 500_000 us timeline)', () => {
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 4_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 2_000_000,
      srcOut: 3_000_000,
      speed: 0.5,
      start: 4_000_000,
      transitionIn: fade(1_000_000),
    })
    const result = planTransitions(deepFreeze([a, b]), ASSET_DURATIONS)

    expect(result.shortenedBy).toBe(0)
    expect(at(result.clips, 1)).toMatchObject({ srcIn: 1_750_000, start: 3_500_000 })
    expect(clipEnd(at(result.clips, 1))).toBe(6_000_000)
    expect(at(result.transitions, 0).duration).toBe(1_000_000)
  })

  it('shrinks the overlap by 1 us at speed 0.5 when an odd duration cannot be reached exactly', () => {
    // At speed 0.5 every source us is 2 timeline us, so a 500_001 us extension is unreachable.
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 4_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 2_000_000,
      srcOut: 3_000_000,
      speed: 0.5,
      start: 4_000_000,
      transitionIn: fade(1_000_001),
    })
    const result = planTransitions(deepFreeze([a, b]), ASSET_DURATIONS)

    expect(result.shortenedBy).toBe(0)
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 3_500_000, duration: 1_000_000, requested: 1_000_001 },
    ])
    expect(at(result.clips, 1).transitionIn).toEqual(fade(1_000_000))
    expect(clipEnd(at(result.clips, 0))).toBe(at(result.clips, 1).start + 1_000_000)
    expect(clipEnd(at(result.clips, 1))).toBe(6_000_000)
  })

  it('ignores a transition on the first clip and clears it', () => {
    const a = makeClip({ id: 'a', start: 0, transitionIn: fade(1_000_000) })
    const b = makeClip({ id: 'b', srcIn: 0, srcOut: 2_000_000, start: 4_000_000 })
    const result = planTransitions(deepFreeze([a, b]), ASSET_DURATIONS)

    expect(result.transitions).toEqual([])
    expect(result.shortenedBy).toBe(0)
    expect(at(result.clips, 0).transitionIn).toBeNull()
    expect(at(result.clips, 1)).toMatchObject({ start: 4_000_000, srcOut: 2_000_000 })
  })

  it('caps the overlap to the shorter clip so a transition never swallows a clip', () => {
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 300_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 1_000_000,
      srcOut: 4_000_000,
      start: 300_000,
      transitionIn: fade(1_000_000),
    })
    const result = planTransitions(deepFreeze([a, b]), ASSET_DURATIONS)

    expect(result.shortenedBy).toBe(0)
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 150_000, duration: 300_000, requested: 1_000_000 },
    ])
    expect(clipEnd(at(result.clips, 0))).toBe(150_000 + 300_000)
    expect(clipEnd(at(result.clips, 1))).toBe(3_300_000)
  })

  it('chains two transitions and computes the second handle from the already modified clip', () => {
    const a = makeClip({ id: 'a', srcIn: 0, srcOut: 4_000_000, start: 0 })
    const b = makeClip({
      id: 'b',
      srcIn: 3_000_000,
      srcOut: 6_000_000,
      start: 4_000_000,
      transitionIn: fade(1_000_000),
    })
    const c = makeClip({
      id: 'c',
      srcIn: 1_000_000,
      srcOut: 3_000_000,
      start: 7_000_000,
      transitionIn: fade(1_000_000),
    })
    // Shuffled input: the planner sorts by start.
    const result = planTransitions(deepFreeze([c, a, b]), ASSET_DURATIONS)

    expect(result.shortenedBy).toBe(0)
    expect(result.clips.map((clip) => clip.id)).toEqual(['a', 'b', 'c'])
    expect(at(result.clips, 1)).toMatchObject({ srcIn: 2_500_000, srcOut: 6_500_000, start: 3_500_000 })
    expect(at(result.clips, 2)).toMatchObject({ srcIn: 500_000, srcOut: 3_000_000, start: 6_500_000 })
    expect(clipEnd(at(result.clips, 2))).toBe(9_000_000)
    expect(result.transitions).toEqual([
      { clipId: 'b', start: 3_500_000, duration: 1_000_000, requested: 1_000_000 },
      { clipId: 'c', start: 6_500_000, duration: 1_000_000, requested: 1_000_000 },
    ])
  })
})

/** Deterministic PRNG (mulberry32) so failures are reproducible by seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('planTransitions property checks', () => {
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
  const ASSETS: Record<string, number> = { v0: 30_000_000, v1: 12_345_679 }
  const assetDurationOf = (assetId: string): number => {
    const duration = ASSETS[assetId]
    if (duration === undefined) throw new RangeError(`unknown asset ${assetId}`)
    return duration
  }

  function randomClips(seed: number): Clip[] {
    const rand = mulberry32(seed)
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
    const pick = <T>(items: readonly T[]): T => at(items, int(0, items.length - 1))
    const count = int(1, 6)
    return Array.from({ length: count }, (_, i) => {
      const assetId = pick(Object.keys(ASSETS))
      const assetDuration = assetDurationOf(assetId)
      const srcIn = int(0, assetDuration - 200_000)
      const srcOut = int(srcIn + 100_000, assetDuration)
      return makeClip({
        id: `c${i}`,
        assetId,
        srcIn,
        srcOut,
        start: int(0, 20_000_000),
        speed: pick(SPEEDS),
        transitionIn: rand() < 0.6 ? fade(int(1, 3_000_000)) : null,
      })
    })
  }

  it('holds the planner invariants over 300 seeded random cases', () => {
    let plannedCount = 0
    let shortenedCount = 0

    for (let seed = 1; seed <= 300; seed++) {
      const input = deepFreeze(randomClips(seed))
      const original = rippleClose(input)
      const originalTotal = original.length ? clipEnd(at(original, original.length - 1)) : 0

      const result = planTransitions(input, ASSETS)
      const { clips, transitions, shortenedBy } = result

      expect(clips.length, `seed ${seed}`).toBe(input.length)
      expect(shortenedBy, `seed ${seed}`).toBeGreaterThanOrEqual(0)
      if (shortenedBy > 0) shortenedCount++

      for (let i = 1; i < clips.length; i++) {
        expect(at(clips, i).start, `seed ${seed} order`).toBeGreaterThanOrEqual(at(clips, i - 1).start)
      }

      for (const clip of clips) {
        const assetDuration = assetDurationOf(clip.assetId)
        expect(clip.srcIn, `seed ${seed} srcIn`).toBeGreaterThanOrEqual(0)
        expect(clip.srcOut, `seed ${seed} srcOut`).toBeLessThanOrEqual(assetDuration)
        expect(clip.srcOut, `seed ${seed} duration`).toBeGreaterThan(clip.srcIn)
        expect(clip.transitionIn === null || transitions.some((t) => t.clipId === clip.id)).toBe(
          true,
        )
      }

      for (const plan of transitions) {
        const index = clips.findIndex((clip) => clip.id === plan.clipId)
        expect(index, `seed ${seed} plan target`).toBeGreaterThan(0)
        const b = at(clips, index)
        const a = at(clips, index - 1)
        expect(clipEnd(a), `seed ${seed} invariant`).toBe(b.start + plan.duration)
        expect(plan.start, `seed ${seed} plan start`).toBe(b.start)
        expect(b.transitionIn?.duration, `seed ${seed} transitionIn`).toBe(plan.duration)
        expect(plan.duration, `seed ${seed} duration range`).toBeGreaterThanOrEqual(1)
        expect(plan.duration, `seed ${seed} duration range`).toBeLessThanOrEqual(plan.requested)
        plannedCount++
      }

      const total = clips.length ? clipEnd(at(clips, clips.length - 1)) : 0
      expect(total, `seed ${seed} total length`).toBe(originalTotal - shortenedBy)
    }

    expect(plannedCount).toBeGreaterThan(300)
    expect(shortenedCount).toBeGreaterThan(0)
  })
})
