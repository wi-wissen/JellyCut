import { describe, expect, it } from 'vitest'
import type { Clip } from '../project/types'
import {
  clipDuration,
  clipEnd,
  findClipAt,
  rippleClose,
  splitClip,
  trimClipEnd,
  trimClipStart,
} from './edit'

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'a',
    track: 'video',
    assetId: 'asset1',
    srcIn: 0,
    srcOut: 10_000_000,
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

describe('clipDuration / clipEnd', () => {
  it('returns source length at speed 1', () => {
    expect(clipDuration(makeClip())).toBe(10_000_000)
  })

  it('divides by speed 2', () => {
    expect(clipDuration(makeClip({ speed: 2 }))).toBe(5_000_000)
  })

  it('divides by speed 0.5', () => {
    expect(clipDuration(makeClip({ speed: 0.5 }))).toBe(20_000_000)
  })

  it('rounds to whole microseconds', () => {
    expect(clipDuration(makeClip({ srcIn: 0, srcOut: 10, speed: 3 }))).toBe(3)
    expect(clipDuration(makeClip({ srcIn: 0, srcOut: 2, speed: 3 }))).toBe(1)
  })

  it('computes end as start plus duration', () => {
    expect(clipEnd(makeClip({ start: 1_000_000, speed: 2 }))).toBe(6_000_000)
  })
})

describe('splitClip', () => {
  it('splits at speed 1 with source split point', () => {
    const clip = makeClip()
    const result = splitClip(clip, 4_000_000, 'b')
    expect(result).not.toBeNull()
    const [left, right] = result!
    expect(left).toMatchObject({ id: 'a', start: 0, srcIn: 0, srcOut: 4_000_000 })
    expect(right).toMatchObject({ id: 'b', start: 4_000_000, srcIn: 4_000_000, srcOut: 10_000_000 })
    expect(clipEnd(left)).toBe(4_000_000)
    expect(clipEnd(right)).toBe(10_000_000)
  })

  it('maps the split point through speed 2', () => {
    const clip = makeClip({ start: 1_000_000, srcIn: 2_000_000, srcOut: 12_000_000, speed: 2 })
    const [left, right] = splitClip(clip, 3_000_000, 'b')!
    // 2 s of timeline at speed 2 = 4 s of source
    expect(left.srcOut).toBe(6_000_000)
    expect(right.srcIn).toBe(6_000_000)
    expect(right.start).toBe(3_000_000)
    expect(clipEnd(right)).toBe(clipEnd(clip))
  })

  it('maps the split point through speed 0.5', () => {
    const clip = makeClip({ speed: 0.5 })
    const [left, right] = splitClip(clip, 4_000_000, 'b')!
    // 4 s of timeline at speed 0.5 = 2 s of source
    expect(left.srcOut).toBe(2_000_000)
    expect(right.srcIn).toBe(2_000_000)
    expect(clipEnd(right)).toBe(clipEnd(clip))
  })

  it('rounds the source split point', () => {
    const clip = makeClip({ speed: 1.5 })
    const [left, right] = splitClip(clip, 1, 'b')!
    expect(left.srcOut).toBe(2)
    expect(right.srcIn).toBe(2)
  })

  it('keeps transitionIn on the left and clears it on the right', () => {
    const clip = makeClip({ transitionIn: { type: 'fade', duration: 500_000 } })
    const [left, right] = splitClip(clip, 4_000_000, 'b')!
    expect(left.transitionIn).toEqual({ type: 'fade', duration: 500_000 })
    expect(right.transitionIn).toBeNull()
  })

  it('copies the other fields to both halves', () => {
    const clip = makeClip({ volume: 0.5, muted: true, filter: 'sepia', assetId: 'x' })
    const [left, right] = splitClip(clip, 4_000_000, 'b')!
    for (const part of [left, right]) {
      expect(part.volume).toBe(0.5)
      expect(part.muted).toBe(true)
      expect(part.filter).toBe('sepia')
      expect(part.assetId).toBe('x')
      expect(part.speed).toBe(1)
    }
  })

  it('does not share the transform object by reference', () => {
    const clip = makeClip()
    const [left, right] = splitClip(clip, 4_000_000, 'b')!
    expect(left.transform).toEqual(clip.transform)
    expect(right.transform).toEqual(clip.transform)
    expect(left.transform).not.toBe(clip.transform)
    expect(right.transform).not.toBe(clip.transform)
    expect(right.transform).not.toBe(left.transform)
    right.transform.scale = 3
    expect(left.transform.scale).toBe(1)
    expect(clip.transform.scale).toBe(1)
  })

  it('returns null at the exact start and end', () => {
    const clip = makeClip({ start: 1_000_000 })
    expect(splitClip(clip, 1_000_000, 'b')).toBeNull()
    expect(splitClip(clip, clipEnd(clip), 'b')).toBeNull()
  })

  it('returns null outside the clip', () => {
    const clip = makeClip({ start: 1_000_000 })
    expect(splitClip(clip, 0, 'b')).toBeNull()
    expect(splitClip(clip, 999_999, 'b')).toBeNull()
    expect(splitClip(clip, clipEnd(clip) + 1, 'b')).toBeNull()
  })

  it('splits one microsecond inside the clip', () => {
    const clip = makeClip({ start: 0 })
    const result = splitClip(clip, 1, 'b')
    expect(result).not.toBeNull()
    expect(result![0].srcOut).toBe(1)
  })
})

describe('trimClipStart', () => {
  it('moves srcIn and start at speed 1', () => {
    const clip = makeClip({ start: 1_000_000, srcIn: 2_000_000, srcOut: 10_000_000 })
    const result = trimClipStart(clip, 3_000_000, 20_000_000)
    expect(result.start).toBe(3_000_000)
    expect(result.srcIn).toBe(4_000_000)
    expect(result.srcOut).toBe(10_000_000)
    expect(clipEnd(result)).toBe(clipEnd(clip))
  })

  it('scales the source move by speed 2', () => {
    const clip = makeClip({ start: 0, srcIn: 4_000_000, srcOut: 10_000_000, speed: 2 })
    const result = trimClipStart(clip, 1_000_000, 20_000_000)
    expect(result.start).toBe(1_000_000)
    expect(result.srcIn).toBe(6_000_000)
    expect(clipEnd(result)).toBe(clipEnd(clip))
  })

  it('scales the source move by speed 0.5', () => {
    const clip = makeClip({ start: 0, srcIn: 0, srcOut: 10_000_000, speed: 0.5 })
    const result = trimClipStart(clip, 2_000_000, 20_000_000)
    expect(result.start).toBe(2_000_000)
    expect(result.srcIn).toBe(1_000_000)
    expect(clipEnd(result)).toBe(clipEnd(clip))
  })

  it('clamps so srcIn never goes below 0', () => {
    const clip = makeClip({ start: 5_000_000, srcIn: 1_000_000, srcOut: 10_000_000 })
    const result = trimClipStart(clip, 0, 20_000_000)
    expect(result.srcIn).toBe(0)
    expect(result.start).toBe(4_000_000)
    expect(clipEnd(result)).toBe(clipEnd(clip))
  })

  it('clamps so the clip keeps at least 1 microsecond on the right', () => {
    const clip = makeClip({ start: 0, srcIn: 0, srcOut: 3_000_000 })
    const result = trimClipStart(clip, 10_000_000, 20_000_000)
    expect(result.start).toBe(2_999_999)
    expect(result.srcIn).toBe(2_999_999)
    expect(clipDuration(result)).toBe(1)
    expect(result.srcOut).toBe(3_000_000)
  })

  it('keeps at least 1 microsecond of timeline duration at high speed', () => {
    const clip = makeClip({ start: 0, srcIn: 0, srcOut: 10, speed: 4 })
    const result = trimClipStart(clip, 10_000_000, 20_000_000)
    expect(clipDuration(result)).toBeGreaterThanOrEqual(1)
    expect(result.srcIn).toBeLessThan(result.srcOut)
  })

  it('does not move srcIn past assetDuration', () => {
    const clip = makeClip({ start: 0, srcIn: 0, srcOut: 3_000_000 })
    const result = trimClipStart(clip, 10_000_000, 2_000_000)
    expect(result.srcIn).toBe(1_999_999)
    expect(result.srcOut).toBe(3_000_000)
  })

  it('leaves the clip unchanged when newStart equals start', () => {
    const clip = makeClip({ start: 2_000_000, srcIn: 1_000_000 })
    expect(trimClipStart(clip, 2_000_000, 20_000_000)).toEqual(clip)
  })

  it('returns a new transform object', () => {
    const clip = makeClip({ start: 1_000_000, srcIn: 1_000_000 })
    const result = trimClipStart(clip, 2_000_000, 20_000_000)
    expect(result.transform).not.toBe(clip.transform)
  })
})

describe('trimClipEnd', () => {
  it('sets srcOut from the new timeline end at speed 1', () => {
    const clip = makeClip({ start: 1_000_000, srcIn: 2_000_000, srcOut: 10_000_000 })
    const result = trimClipEnd(clip, 5_000_000, 20_000_000)
    expect(result.srcOut).toBe(6_000_000)
    expect(result.srcIn).toBe(2_000_000)
    expect(result.start).toBe(1_000_000)
  })

  it('scales by speed 2', () => {
    const clip = makeClip({ speed: 2 })
    const result = trimClipEnd(clip, 2_000_000, 20_000_000)
    expect(result.srcOut).toBe(4_000_000)
  })

  it('scales by speed 0.5', () => {
    const clip = makeClip({ speed: 0.5 })
    const result = trimClipEnd(clip, 4_000_000, 20_000_000)
    expect(result.srcOut).toBe(2_000_000)
  })

  it('clamps srcOut to at least srcIn + 1', () => {
    const clip = makeClip({ start: 3_000_000, srcIn: 1_000_000, srcOut: 10_000_000 })
    expect(trimClipEnd(clip, 3_000_000, 20_000_000).srcOut).toBe(1_000_001)
    expect(trimClipEnd(clip, 0, 20_000_000).srcOut).toBe(1_000_001)
  })

  it('clamps srcOut to assetDuration', () => {
    const clip = makeClip({ srcOut: 5_000_000 })
    const result = trimClipEnd(clip, 100_000_000, 10_000_000)
    expect(result.srcOut).toBe(10_000_000)
  })

  it('does not change start, srcIn, or the other fields', () => {
    const clip = makeClip({ start: 1_000_000, srcIn: 2_000_000, volume: 0.3 })
    const result = trimClipEnd(clip, 4_000_000, 20_000_000)
    expect(result.start).toBe(clip.start)
    expect(result.srcIn).toBe(clip.srcIn)
    expect(result.volume).toBe(0.3)
    expect(result.transform).not.toBe(clip.transform)
  })
})

describe('rippleClose', () => {
  it('returns an empty array for empty input', () => {
    expect(rippleClose([])).toEqual([])
  })

  it('closes gaps between clips', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, srcOut: 2_000_000 }),
      makeClip({ id: 'b', start: 5_000_000, srcOut: 3_000_000 }),
      makeClip({ id: 'c', start: 10_000_000, srcOut: 1_000_000 }),
    ]
    const result = rippleClose(clips)
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(result.map((c) => c.start)).toEqual([0, 2_000_000, 5_000_000])
  })

  it('makes overlapping clips back-to-back', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, srcOut: 4_000_000 }),
      makeClip({ id: 'b', start: 2_000_000, srcOut: 3_000_000 }),
    ]
    const result = rippleClose(clips)
    expect(result.map((c) => c.start)).toEqual([0, 4_000_000])
  })

  it('moves the first clip to 0', () => {
    const result = rippleClose([makeClip({ id: 'a', start: 7_000_000 })])
    expect(result[0]!.start).toBe(0)
  })

  it('sorts unsorted input by start', () => {
    const clips = [
      makeClip({ id: 'c', start: 10_000_000, srcOut: 1_000_000 }),
      makeClip({ id: 'a', start: 0, srcOut: 2_000_000 }),
      makeClip({ id: 'b', start: 5_000_000, srcOut: 3_000_000 }),
    ]
    const result = rippleClose(clips)
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(result.map((c) => c.start)).toEqual([0, 2_000_000, 5_000_000])
  })

  it('keeps the input order for clips with equal start', () => {
    const clips = [
      makeClip({ id: 'first', start: 0, srcOut: 1_000_000 }),
      makeClip({ id: 'second', start: 0, srcOut: 2_000_000 }),
    ]
    const result = rippleClose(clips)
    expect(result.map((c) => c.id)).toEqual(['first', 'second'])
    expect(result.map((c) => c.start)).toEqual([0, 1_000_000])
  })

  it('uses clip duration including speed', () => {
    const clips = [
      makeClip({ id: 'a', start: 0, srcOut: 10_000_000, speed: 2 }),
      makeClip({ id: 'b', start: 9_000_000, srcOut: 1_000_000 }),
    ]
    const result = rippleClose(clips)
    expect(result[1]!.start).toBe(5_000_000)
  })

  it('does not mutate the input array or clips', () => {
    const clips = [
      makeClip({ id: 'b', start: 5_000_000 }),
      makeClip({ id: 'a', start: 0 }),
    ]
    const snapshot = structuredClone(clips)
    const result = rippleClose(clips)
    expect(clips).toEqual(snapshot)
    expect(clips.map((c) => c.id)).toEqual(['b', 'a'])
    expect(result[0]).not.toBe(clips[1])
  })
})

describe('findClipAt', () => {
  const clips = [
    makeClip({ id: 'a', start: 0, srcOut: 2_000_000 }),
    makeClip({ id: 'b', start: 3_000_000, srcOut: 2_000_000 }),
  ]

  it('returns undefined for an empty array', () => {
    expect(findClipAt([], 0)).toBeUndefined()
  })

  it('includes the start time', () => {
    expect(findClipAt(clips, 0)?.id).toBe('a')
    expect(findClipAt(clips, 3_000_000)?.id).toBe('b')
  })

  it('excludes the end time', () => {
    expect(findClipAt(clips, 2_000_000)).toBeUndefined()
    expect(findClipAt(clips, 1_999_999)?.id).toBe('a')
  })

  it('returns undefined in a gap and before the first clip', () => {
    expect(findClipAt(clips, 2_500_000)).toBeUndefined()
    expect(findClipAt([makeClip({ start: 1_000_000 })], 0)).toBeUndefined()
  })

  it('respects speed when computing the end', () => {
    const fast = [makeClip({ id: 'f', start: 0, srcOut: 4_000_000, speed: 2 })]
    expect(findClipAt(fast, 1_999_999)?.id).toBe('f')
    expect(findClipAt(fast, 2_000_000)).toBeUndefined()
  })
})

describe('immutability', () => {
  it('does not mutate inputs and accepts deep-frozen input', () => {
    const clip = deepFreeze(makeClip({ start: 1_000_000, srcIn: 2_000_000, transitionIn: { type: 'fade', duration: 1 } }))
    const other = deepFreeze(makeClip({ id: 'b', start: 20_000_000 }))
    const list = deepFreeze([clip, other])

    expect(() => splitClip(clip, 4_000_000, 'c')).not.toThrow()
    expect(() => trimClipStart(clip, 0, 20_000_000)).not.toThrow()
    expect(() => trimClipEnd(clip, 9_000_000, 20_000_000)).not.toThrow()
    expect(() => rippleClose(list)).not.toThrow()
    expect(() => findClipAt(list, 5_000_000)).not.toThrow()

    expect(clip.srcIn).toBe(2_000_000)
    expect(clip.srcOut).toBe(10_000_000)
    expect(clip.transitionIn).toEqual({ type: 'fade', duration: 1 })
    expect(list.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
