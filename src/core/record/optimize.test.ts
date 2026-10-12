import { describe, expect, it } from 'vitest'
import {
  MAX_OPTIMIZE_SECONDS,
  MAX_VIDEO_BITRATE,
  MIN_VIDEO_BITRATE,
  judgeOptimized,
  maxFrameGap,
  maxKeyGap,
  planOptimization,
  type Measure,
  type OptimizePlan,
  type PlanInput
} from './optimize'

const base: PlanInput = {
  durationSeconds: 30,
  sourceBitrate: 2_000_000,
  videoCodec: 'vp8',
  hasVideoEncoder: true,
  sourceMaxKeyGapSeconds: 30,
  sourceMaxFrameGapSeconds: 0.05
}

describe('planOptimization', () => {
  it('asks for about twice the source bitrate and prefers VP9 for speed', () => {
    const plan = planOptimization(base) as OptimizePlan
    expect(plan.bitrate).toBe(4_000_000)
    expect(plan.container).toBe('webm')
    expect(plan.codecs).toEqual(['vp9', 'vp8'])
  })

  it('keeps the bitrate between the floor and the ceiling', () => {
    expect((planOptimization({ ...base, sourceBitrate: 100_000 }) as OptimizePlan).bitrate).toBe(MIN_VIDEO_BITRATE)
    expect((planOptimization({ ...base, sourceBitrate: 50_000_000 }) as OptimizePlan).bitrate).toBe(MAX_VIDEO_BITRATE)
  })

  it('skips what it should not touch', () => {
    expect(planOptimization({ ...base, durationSeconds: MAX_OPTIMIZE_SECONDS + 1 })).toBe('tooLong')
    expect(planOptimization({ ...base, hasVideoEncoder: false })).toBe('noEncoder')
    expect(planOptimization({ ...base, videoCodec: null })).toBe('noVideo')
    expect(planOptimization({ ...base, videoCodec: 'hevc' })).toBe('unsupportedCodec')
    expect(planOptimization({ ...base, sourceMaxKeyGapSeconds: 1, sourceMaxFrameGapSeconds: 0.04 })).toBe('alreadyDense')
  })

  it('allows a key gap that a slow stretch of the source explains', () => {
    expect(planOptimization({ ...base, sourceMaxKeyGapSeconds: 1.5, sourceMaxFrameGapSeconds: 0.6 })).toBe('alreadyDense')
    expect(typeof planOptimization({ ...base, sourceMaxKeyGapSeconds: 1.5, sourceMaxFrameGapSeconds: 0.1 })).toBe('object')
  })

  it('keeps MP4 sources in MP4 and refuses results that would not fit in memory', () => {
    expect((planOptimization({ ...base, videoCodec: 'avc' }) as OptimizePlan).container).toBe('mp4')
    expect(planOptimization({ ...base, durationSeconds: 590, sourceBitrate: 8_000_000 })).toBe('tooBig')
  })
})

describe('measures', () => {
  it('finds the widest keyframe gap including the stretch to the end', () => {
    expect(maxKeyGap([0, 1, 2.5], 3)).toBe(1.5)
    expect(maxKeyGap([0], 29.97)).toBeCloseTo(29.97)
    expect(maxKeyGap([], 5)).toBe(5)
  })

  it('finds the widest gap between pictures', () => {
    expect(maxFrameGap([0, 0.04, 0.62, 0.66])).toBeCloseTo(0.58)
    expect(maxFrameGap([1])).toBe(0)
  })
})

describe('judgeOptimized', () => {
  const raw: Measure = { durationSeconds: 30, frames: 720, maxKeyGapSeconds: 30, maxFrameGapSeconds: 0.04, luma: [60, 120, 180] }
  const good: Measure = { durationSeconds: 30.02, frames: 720, maxKeyGapSeconds: 1.02, maxFrameGapSeconds: 0.04, luma: [61, 119, 181] }

  it('accepts a file with the same length, pictures and look and dense keyframes', () => {
    expect(judgeOptimized(raw, good)).toBe('ok')
  })

  it.each([
    ['a different length', { durationSeconds: 30.2 }],
    ['lost pictures', { frames: 690 }],
    ['sparse keyframes', { maxKeyGapSeconds: 3 }],
    ['a changed picture', { luma: [60, 120, 40] }],
    ['no picture samples', { luma: [] as number[] }]
  ])('keeps the raw file for %s', (_name, change) => {
    expect(judgeOptimized(raw, { ...good, ...change })).toBe('mismatch')
  })

  it('tolerates a couple of lost pictures in a short clip', () => {
    expect(judgeOptimized({ ...raw, frames: 60 }, { ...good, frames: 58 })).toBe('ok')
  })

  it('allows a wider keyframe gap where the pictures themselves are far apart', () => {
    expect(judgeOptimized(raw, { ...good, maxKeyGapSeconds: 1.5, maxFrameGapSeconds: 0.6 })).toBe('ok')
  })
})
