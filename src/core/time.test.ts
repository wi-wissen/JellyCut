import { describe, expect, it } from 'vitest'
import {
  MICROS_PER_SECOND,
  formatTimecode,
  frameDuration,
  frameIndexAt,
  frameStart,
  microsToSeconds,
  secondsToMicros,
  snapToFrame,
} from './time'

describe('secondsToMicros / microsToSeconds', () => {
  it('converts whole and fractional seconds', () => {
    expect(secondsToMicros(0)).toBe(0)
    expect(secondsToMicros(1)).toBe(1_000_000)
    expect(secondsToMicros(0.1)).toBe(100_000)
    expect(secondsToMicros(1.2345678)).toBe(1_234_568)
  })

  it('rounds to the nearest microsecond', () => {
    expect(secondsToMicros(0.0000004)).toBe(0)
    expect(secondsToMicros(0.0000006)).toBe(1)
  })

  it('converts micros back to seconds', () => {
    expect(microsToSeconds(0)).toBe(0)
    expect(microsToSeconds(1_500_000)).toBe(1.5)
    expect(microsToSeconds(MICROS_PER_SECOND)).toBe(1)
  })
})

describe('frameDuration', () => {
  it('rounds the frame length to whole microseconds', () => {
    expect(frameDuration(30)).toBe(33_333)
    expect(frameDuration(60)).toBe(16_667)
    expect(frameDuration(24)).toBe(41_667)
    expect(frameDuration(25)).toBe(40_000)
    expect(frameDuration(1)).toBe(1_000_000)
  })

  it('does not crash for non-integer fps', () => {
    expect(frameDuration(29.97)).toBe(33_367)
  })
})

describe('frameStart', () => {
  it('returns the start of the first frames', () => {
    expect(frameStart(0, 30)).toBe(0)
    expect(frameStart(1, 30)).toBe(33_333)
    expect(frameStart(1, 60)).toBe(16_667)
  })

  it('is exact on a whole second boundary', () => {
    expect(frameStart(30, 30)).toBe(1_000_000)
    expect(frameStart(60, 30)).toBe(2_000_000)
    expect(frameStart(30, 60)).toBe(500_000)
  })

  it('does not accumulate drift over a long time', () => {
    expect(frameStart(1_080_000, 30)).toBe(36_000_000_000)
    expect(frameStart(216_000, 60)).toBe(3_600_000_000)
    for (let k = 0; k <= 100_000; k += 997) {
      expect(frameStart(30 * k, 30)).toBe(k * 1_000_000)
    }
  })

  it('handles non-integer fps', () => {
    expect(frameStart(0, 29.97)).toBe(0)
    expect(frameStart(2997, 29.97)).toBe(100_000_000)
  })

  it('throws RangeError for invalid input', () => {
    expect(() => frameStart(-1, 30)).toThrow(RangeError)
    expect(() => frameStart(1.5, 30)).toThrow(RangeError)
    expect(() => frameStart(0, 0)).toThrow(RangeError)
    expect(() => frameStart(0, NaN)).toThrow(RangeError)
  })
})

describe('frameIndexAt', () => {
  it('returns the frame containing a time', () => {
    expect(frameIndexAt(0, 30)).toBe(0)
    expect(frameIndexAt(33_332, 30)).toBe(0)
    expect(frameIndexAt(33_333, 30)).toBe(1)
    expect(frameIndexAt(33_334, 30)).toBe(1)
    expect(frameIndexAt(3_600_000_000, 60)).toBe(216_000)
  })

  it('is exact on a frame boundary', () => {
    expect(frameIndexAt(1_000_000, 30)).toBe(30)
    expect(frameIndexAt(2_000_000, 25)).toBe(50)
  })

  it('uses the rounded frame start, not a floored estimate', () => {
    // frameStart(2, 30) = 66_667, so 66_666 is still frame 1.
    expect(frameIndexAt(66_666, 30)).toBe(1)
    expect(frameIndexAt(66_667, 30)).toBe(2)
  })

  it('is one microsecond before a boundary still in the previous frame', () => {
    expect(frameIndexAt(999_999, 30)).toBe(29)
    expect(frameIndexAt(1_999_999, 60)).toBe(119)
    expect(frameIndexAt(2_000_000, 60)).toBe(120)
  })

  it('does not crash for non-integer fps', () => {
    expect(frameIndexAt(1_000_000, 29.97)).toBe(29)
    expect(frameIndexAt(0, 29.97)).toBe(0)
    expect(frameIndexAt(10_000_000_000, 29.97)).toBe(299_700)
  })

  it('handles large times without precision loss', () => {
    const t = 9_000_000_000_000 // 104 days; t * fps exceeds 2^53 at 60 fps
    expect(frameIndexAt(t, 60)).toBe(540_000_000)
    expect(frameIndexAt(t - 1, 60)).toBe(539_999_999)
  })

  it('throws RangeError for invalid fps', () => {
    expect(() => frameIndexAt(0, 0)).toThrow(RangeError)
    expect(() => frameIndexAt(0, -30)).toThrow(RangeError)
    expect(() => frameIndexAt(0, NaN)).toThrow(RangeError)
    expect(() => frameIndexAt(0, Infinity)).toThrow(RangeError)
  })

  it('throws RangeError for invalid time', () => {
    expect(() => frameIndexAt(-1, 30)).toThrow(RangeError)
    expect(() => frameIndexAt(NaN, 30)).toThrow(RangeError)
    expect(() => frameIndexAt(1.5, 30)).toThrow(RangeError)
  })
})

describe('frame grid invariants', () => {
  const rates = [24, 25, 29.97, 30, 50, 60]
  const indices: number[] = [0, 1, 2, 3]
  for (let i = 4; i <= 200_000; i += 997) indices.push(i)
  indices.push(200_000)

  it('frameIndexAt(frameStart(i)) is i', () => {
    for (const fps of rates) {
      for (const i of indices) {
        expect(frameIndexAt(frameStart(i, fps), fps)).toBe(i)
      }
    }
  })

  it('frameIndexAt(frameStart(i) - 1) is i - 1', () => {
    for (const fps of rates) {
      for (const i of indices) {
        if (i < 1) continue
        expect(frameIndexAt(frameStart(i, fps) - 1, fps)).toBe(i - 1)
      }
    }
  })

  it('frameStart(frameIndexAt(t)) <= t < frameStart(frameIndexAt(t) + 1)', () => {
    for (const fps of rates) {
      for (const i of indices) {
        const first = frameStart(i, fps)
        const last = frameStart(i + 1, fps) - 1
        for (const t of [first, first + 1, last]) {
          const index = frameIndexAt(t, fps)
          expect(frameStart(index, fps)).toBeLessThanOrEqual(t)
          expect(t).toBeLessThan(frameStart(index + 1, fps))
        }
      }
    }
  })

  it('snapToFrame is idempotent', () => {
    for (const fps of rates) {
      for (const i of indices) {
        for (const t of [frameStart(i, fps), frameStart(i, fps) + 1, frameStart(i + 1, fps) - 1]) {
          const once = snapToFrame(t, fps)
          expect(snapToFrame(once, fps)).toBe(once)
          expect(once).toBeLessThanOrEqual(t)
        }
      }
    }
  })
})

describe('snapToFrame', () => {
  it('snaps to the start of the containing frame', () => {
    expect(snapToFrame(0, 30)).toBe(0)
    expect(snapToFrame(999_999, 30)).toBe(frameStart(29, 30))
    expect(snapToFrame(1_000_000, 30)).toBe(1_000_000)
    expect(snapToFrame(1_000_001, 30)).toBe(1_000_000)
  })

  it('equals frameStart of frameIndexAt', () => {
    const t = 12_345_678
    expect(snapToFrame(t, 25)).toBe(frameStart(frameIndexAt(t, 25), 25))
  })

  it('throws RangeError for invalid input', () => {
    expect(() => snapToFrame(-1, 30)).toThrow(RangeError)
    expect(() => snapToFrame(0, 0)).toThrow(RangeError)
  })
})

describe('formatTimecode', () => {
  it('formats zero', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00')
  })

  it('formats frames within a second', () => {
    expect(formatTimecode(400_000, 30)).toBe('00:00:12')
    expect(formatTimecode(999_999, 30)).toBe('00:00:29')
  })

  it('rolls over at whole seconds and minutes', () => {
    expect(formatTimecode(1_000_000, 30)).toBe('00:01:00')
    expect(formatTimecode(59_000_000, 30)).toBe('00:59:00')
    expect(formatTimecode(60_000_000, 30)).toBe('01:00:00')
  })

  it('lets minutes grow beyond 59 without an hours field', () => {
    expect(formatTimecode(4_503_400_000, 30)).toBe('75:03:12')
    expect(formatTimecode(3_600_000_000, 60)).toBe('60:00:00')
  })

  it('switches to the next frame exactly at its rounded start', () => {
    expect(formatTimecode(33_332, 30)).toBe('00:00:00')
    expect(formatTimecode(33_333, 30)).toBe('00:00:01')
  })

  it('does not crash for non-integer fps', () => {
    expect(formatTimecode(1_000_000, 29.97)).toBe('00:01:00')
    expect(formatTimecode(999_999, 29.97)).toBe('00:00:29')
  })

  it('throws RangeError for invalid input', () => {
    expect(() => formatTimecode(-1, 30)).toThrow(RangeError)
    expect(() => formatTimecode(0, 0)).toThrow(RangeError)
  })
})
