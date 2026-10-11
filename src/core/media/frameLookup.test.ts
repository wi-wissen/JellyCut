import { describe, expect, it } from 'vitest'
import { FRAME_LOOKUP_TOLERANCE, frameEnd, lookupTime, spanCovers } from './frameLookup'

describe('lookupTime', () => {
  it('adds the container quantisation tolerance', () => {
    expect(lookupTime(1_000_000, 0)).toBe(1_000_000 + FRAME_LOOKUP_TOLERANCE)
  })

  it('never asks for a time before the first frame (late-starting recordings)', () => {
    expect(lookupTime(0, 300_000)).toBe(300_000)
    expect(lookupTime(100_000, 300_000)).toBe(300_000)
    expect(lookupTime(299_000, 300_000)).toBe(300_500)
  })

  it('handles a negative first timestamp', () => {
    expect(lookupTime(0, -7_000)).toBe(FRAME_LOOKUP_TOLERANCE)
  })
})

describe('frameEnd', () => {
  it('uses the duration when the container has one', () => {
    expect(frameEnd(36_000, 33_000, 69_000)).toBe(69_000)
    expect(frameEnd(36_000, 30_000, 69_000)).toBe(66_000)
  })

  it('uses the next frame when the duration is 0 (last block of a MediaRecorder cluster)', () => {
    expect(frameEnd(953_000, 0, 1_020_000)).toBe(1_020_000)
  })

  it('keeps a 1 microsecond span for the final frame or a duplicate timestamp', () => {
    expect(frameEnd(1_986_000, 0, null)).toBe(1_986_001)
    expect(frameEnd(0, 0, 0)).toBe(1)
  })
})

describe('spanCovers', () => {
  it('is half open and null-safe', () => {
    const span = { start: 100, end: 200 }
    expect(spanCovers(span, 100)).toBe(true)
    expect(spanCovers(span, 199)).toBe(true)
    expect(spanCovers(span, 200)).toBe(false)
    expect(spanCovers(span, 99)).toBe(false)
    expect(spanCovers(null, 100)).toBe(false)
  })
})
