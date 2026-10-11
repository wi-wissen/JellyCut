import { describe, expect, it } from 'vitest'
import { keyAfter, keyAtOrBefore, keysBetween } from './keyList'

// MediaRecorder output: a single keyframe at the start, or one every few seconds, in whole milliseconds.
const sparse = [0, 4_003_000, 8_001_000]

describe('keyframe list lookups', () => {
  it('finds the last keyframe at or before a time', () => {
    expect(keyAtOrBefore(sparse, 0)).toBe(0)
    expect(keyAtOrBefore(sparse, 3_999_000)).toBe(0)
    expect(keyAtOrBefore(sparse, 4_003_000)).toBe(4_003_000)
    expect(keyAtOrBefore(sparse, 60_000_000)).toBe(8_001_000)
  })

  it('has no keyframe before the first one (late-starting recording)', () => {
    expect(keyAtOrBefore([300_000], 100_000)).toBeNull()
    expect(keyAtOrBefore([], 100_000)).toBeNull()
  })

  it('finds the first keyframe strictly after a time', () => {
    expect(keyAfter(sparse, 0)).toBe(4_003_000)
    expect(keyAfter(sparse, -1)).toBe(0)
    expect(keyAfter(sparse, 8_001_000)).toBeNull()
  })

  it('lists the keyframes of a range, bounds included', () => {
    expect(keysBetween(sparse, 0, 4_003_000)).toEqual([0, 4_003_000])
    expect(keysBetween(sparse, 1, 4_000_000)).toEqual([])
  })
})
