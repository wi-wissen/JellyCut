import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import type { Asset, Clip, Project } from '../project/types'
import {
  CODEC_FACTOR,
  DECODE_MP_PER_S,
  GIF_QUANTIZE_MP_PER_S,
  GIF_RENDER_MP_PER_S,
  RENDER_MP_PER_S,
  estimateExportSeconds,
  estimateGifSeconds,
  formatEstimate,
  sourceDecodeLoad,
  updateCalibration,
  type EstimateInput
} from './estimate'

const SECOND = 1_000_000

function asset(id: string, overrides: Partial<Asset> = {}): Asset {
  return { id, kind: 'video', name: `${id}.mp4`, relPath: `${id}.mp4`, size: 1, duration: 60 * SECOND, width: 1920, height: 1080, fps: 30, ...overrides }
}

function clip(id: string, assetId: string, srcIn: number, srcOut: number, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    track: 'video',
    assetId,
    srcIn,
    srcOut,
    start: 0,
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null,
    ...overrides
  }
}

function projectWith(assets: Asset[], clips: Clip[]): Project {
  return { ...createProject('test'), assets, clips }
}

function input(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return { width: 1920, height: 1080, fps: 30, durationMicros: 180 * SECOND, decodeMegapixels: 0, codec: 'avc', ...overrides }
}

describe('sourceDecodeLoad', () => {
  it('is zero for an empty project', () => {
    expect(sourceDecodeLoad(projectWith([], []))).toBe(0)
  })

  it('counts width * height * asset fps * source seconds for a video clip', () => {
    const p = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)])
    expect(sourceDecodeLoad(p)).toBeCloseTo((1920 * 1080 * 30 * 10) / 1e6, 6)
  })

  it('uses the source range, not the timeline length: speed does not change the decode work', () => {
    const slow = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND, { speed: 0.5 })])
    const fast = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND, { speed: 4 })])
    const normal = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)])
    expect(sourceDecodeLoad(slow)).toBeCloseTo(sourceDecodeLoad(normal), 6)
    expect(sourceDecodeLoad(fast)).toBeCloseTo(sourceDecodeLoad(normal), 6)
  })

  it('does not depend on where the clip sits on the timeline', () => {
    const early = projectWith([asset('a')], [clip('c', 'a', 2 * SECOND, 7 * SECOND, { start: 0 })])
    const late = projectWith([asset('a')], [clip('c', 'a', 2 * SECOND, 7 * SECOND, { start: 50 * SECOND })])
    expect(sourceDecodeLoad(late)).toBe(sourceDecodeLoad(early))
  })

  it('counts each clip, so one asset used twice is decoded twice', () => {
    const once = projectWith([asset('a')], [clip('c1', 'a', 0, 5 * SECOND)])
    const twice = projectWith([asset('a')], [clip('c1', 'a', 0, 5 * SECOND), clip('c2', 'a', 0, 5 * SECOND)])
    expect(sourceDecodeLoad(twice)).toBeCloseTo(2 * sourceDecodeLoad(once), 6)
  })

  it('counts an image once per clip, however long the clip is', () => {
    const img = asset('i', { kind: 'image', duration: 0, width: 1000, height: 500, fps: undefined })
    const short = projectWith([img], [clip('c', 'i', 0, 1 * SECOND)])
    const long = projectWith([img], [clip('c', 'i', 0, 120 * SECOND)])
    expect(sourceDecodeLoad(short)).toBeCloseTo(0.5, 9)
    expect(sourceDecodeLoad(long)).toBe(sourceDecodeLoad(short))
  })

  it('uses 1920x1080 at 30 fps for assets without size or fps', () => {
    const bare = asset('a', { width: undefined, height: undefined, fps: undefined })
    const p = projectWith([bare], [clip('c', 'a', 0, 4 * SECOND)])
    expect(sourceDecodeLoad(p)).toBeCloseTo((1920 * 1080 * 30 * 4) / 1e6, 6)
  })

  it('uses the same defaults for a clip whose asset is missing from the project', () => {
    const p = projectWith([], [clip('c', 'ghost', 0, 4 * SECOND)])
    expect(sourceDecodeLoad(p)).toBeCloseTo((1920 * 1080 * 30 * 4) / 1e6, 6)
  })

  it('treats a negative source range as zero work', () => {
    const p = projectWith([asset('a')], [clip('c', 'a', 5 * SECOND, 2 * SECOND)])
    expect(sourceDecodeLoad(p)).toBe(0)
  })

  it('ignores audio assets, which have no pictures to decode', () => {
    const p = projectWith([asset('m', { kind: 'audio', width: undefined, height: undefined, fps: undefined })], [clip('c', 'm', 0, 10 * SECOND)])
    expect(sourceDecodeLoad(p)).toBe(0)
  })

  it('scales with source resolution: 4K costs four times 1080p for the same range', () => {
    const hd = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)])
    const uhd = projectWith([asset('a', { width: 3840, height: 2160 })], [clip('c', 'a', 0, 10 * SECOND)])
    expect(sourceDecodeLoad(uhd)).toBeCloseTo(4 * sourceDecodeLoad(hd), 6)
  })
})

describe('estimateExportSeconds', () => {
  it('reproduces the owner example in its parts: 3 min 1080p30 render plus decode of 3 min 1080p30 source', () => {
    const decode = (1920 * 1080 * 30 * 180) / 1e6
    const seconds = estimateExportSeconds(input({ decodeMegapixels: decode }))
    const render = ((1920 * 1080 * 30 * 180) / 1e6 / RENDER_MP_PER_S) * CODEC_FACTOR.avc
    const expected = render + decode / DECODE_MP_PER_S + 180 * 0.02 + 1.5
    expect(seconds).toBeCloseTo(expected, 6)
    // Owner measurement was about 4:40 with about 60 MP/s; the default 55 MP/s gives a bit more.
    expect(seconds).toBeGreaterThan(270)
    expect(seconds).toBeLessThan(310)
  })

  it('has only the fixed start-up when the project is empty', () => {
    expect(estimateExportSeconds(input({ durationMicros: 0, decodeMegapixels: 0 }))).toBeCloseTo(1.5, 9)
  })

  it('grows with the output pixels and with the frame rate', () => {
    const base = estimateExportSeconds(input({ width: 854, height: 480, fps: 30 }))
    expect(estimateExportSeconds(input({ width: 1280, height: 720, fps: 30 }))).toBeGreaterThan(base)
    expect(estimateExportSeconds(input({ width: 1920, height: 1080, fps: 30 }))).toBeGreaterThan(
      estimateExportSeconds(input({ width: 1280, height: 720, fps: 30 }))
    )
    expect(estimateExportSeconds(input({ fps: 60 }))).toBeGreaterThan(estimateExportSeconds(input({ fps: 30 })))
    expect(estimateExportSeconds(input({ fps: 30 }))).toBeGreaterThan(estimateExportSeconds(input({ fps: 24 })))
  })

  it('does not depend on the quality setting (quality is not an input at all)', () => {
    expect(estimateExportSeconds(input())).toBe(estimateExportSeconds(input()))
  })

  it('counts a partial frame as a whole one, like the exporter', () => {
    const oneFrame = estimateExportSeconds(input({ durationMicros: 1, decodeMegapixels: 0, width: 1000, height: 1000, fps: 30 }))
    const oneFrameExact = estimateExportSeconds(input({ durationMicros: 33_333, decodeMegapixels: 0, width: 1000, height: 1000, fps: 30 }))
    expect(oneFrame).toBeCloseTo(1.5 + (1000 * 1000 * 1) / 1e6 / RENDER_MP_PER_S + 0.02 * 1e-6, 9)
    expect(oneFrameExact).toBeCloseTo(1.5 + (1000 * 1000 * 1) / 1e6 / RENDER_MP_PER_S + 0.02 * 0.033333, 9)
  })

  it('applies the software codec factor to the drawing and encoding part only', () => {
    const avc = estimateExportSeconds(input({ decodeMegapixels: 500 }))
    const vp9 = estimateExportSeconds(input({ decodeMegapixels: 500, codec: 'vp9' }))
    const av1 = estimateExportSeconds(input({ decodeMegapixels: 500, codec: 'av1' }))
    const render = ((1920 * 1080 * 30 * 180) / 1e6 / RENDER_MP_PER_S)
    expect(vp9 - avc).toBeCloseTo(render * (CODEC_FACTOR.vp9 - 1), 6)
    expect(av1).toBeCloseTo(vp9, 9)
  })

  it('multiplies the whole result by the calibration factor', () => {
    const raw = estimateExportSeconds(input({ decodeMegapixels: 300 }))
    expect(estimateExportSeconds(input({ decodeMegapixels: 300, calibration: 1 }))).toBe(raw)
    expect(estimateExportSeconds(input({ decodeMegapixels: 300, calibration: 2.5 }))).toBeCloseTo(raw * 2.5, 9)
  })

  it('is never negative or NaN for odd inputs', () => {
    const odd = estimateExportSeconds(input({ durationMicros: Number.NaN, decodeMegapixels: -5 }))
    expect(Number.isFinite(odd)).toBe(true)
    expect(odd).toBeGreaterThan(0)
  })
})

describe('updateCalibration', () => {
  it('takes the ratio of measured to predicted as the first sample', () => {
    expect(updateCalibration(null, 100, 150)).toBeCloseTo(1.5, 12)
    expect(updateCalibration(null, 100, 50)).toBeCloseTo(0.5, 12)
  })

  it('averages with weight 0.5 against the previous factor', () => {
    expect(updateCalibration(2, 100, 100)).toBeCloseTo(1.5, 12)
    expect(updateCalibration(1, 100, 300)).toBeCloseTo(2, 12)
  })

  it('moves towards the truth over repeated identical exports', () => {
    let factor: number | null = null
    for (let i = 0; i < 12; i++) factor = updateCalibration(factor, 100, 200)
    expect(factor).toBeCloseTo(2, 2)
  })

  it('clamps the factor to 0.1 .. 10', () => {
    expect(updateCalibration(null, 1, 1000)).toBe(10)
    expect(updateCalibration(null, 1000, 3)).toBe(0.1)
    expect(updateCalibration(9, 1, 100)).toBe(10)
  })

  it('ignores nonsense samples and keeps the previous factor', () => {
    expect(updateCalibration(1.7, Number.NaN, 100)).toBe(1.7)
    expect(updateCalibration(1.7, 100, Number.POSITIVE_INFINITY)).toBe(1.7)
    expect(updateCalibration(1.7, 0, 100)).toBe(1.7)
    expect(updateCalibration(1.7, -10, 100)).toBe(1.7)
    expect(updateCalibration(1.7, 100, 0)).toBe(1.7)
    expect(updateCalibration(1.7, 100, -4)).toBe(1.7)
  })

  it('ignores exports shorter than 3 s of measured time', () => {
    expect(updateCalibration(null, 2, 2.9)).toBeNull()
    expect(updateCalibration(1.2, 2, 2.9)).toBe(1.2)
    expect(updateCalibration(null, 2, 3)).toBeCloseTo(1.5, 12)
  })

  it('returns null when there is no earlier factor and the sample is unusable', () => {
    expect(updateCalibration(null, Number.NaN, 100)).toBeNull()
  })

  it('treats a broken previous value as no previous value', () => {
    expect(updateCalibration(Number.NaN, 100, 150)).toBeCloseTo(1.5, 12)
    expect(updateCalibration(-3, 100, 150)).toBeCloseTo(1.5, 12)
  })
})

describe('formatEstimate', () => {
  it('shows at least 5 seconds', () => {
    expect(formatEstimate(0)).toEqual({ unit: 'seconds', value: 5 })
    expect(formatEstimate(1.2)).toEqual({ unit: 'seconds', value: 5 })
    expect(formatEstimate(-30)).toEqual({ unit: 'seconds', value: 5 })
    expect(formatEstimate(Number.NaN)).toEqual({ unit: 'seconds', value: 5 })
  })

  it('rounds to 5 seconds below one minute', () => {
    expect(formatEstimate(40)).toEqual({ unit: 'seconds', value: 40 })
    expect(formatEstimate(41.2)).toEqual({ unit: 'seconds', value: 40 })
    expect(formatEstimate(42.6)).toEqual({ unit: 'seconds', value: 45 })
  })

  it('shows minutes and seconds up to 10 minutes, rounded to 5 s below 2 min and 10 s above', () => {
    expect(formatEstimate(280)).toEqual({ unit: 'minutes', value: 4, seconds: 40 })
    expect(formatEstimate(65)).toEqual({ unit: 'minutes', value: 1, seconds: 5 })
    expect(formatEstimate(61.3)).toEqual({ unit: 'minutes', value: 1 })
    expect(formatEstimate(118)).toEqual({ unit: 'minutes', value: 2 })
    expect(formatEstimate(124)).toEqual({ unit: 'minutes', value: 2 })
    expect(formatEstimate(283)).toEqual({ unit: 'minutes', value: 4, seconds: 40 })
    expect(formatEstimate(288)).toEqual({ unit: 'minutes', value: 4, seconds: 50 })
  })

  it('shows whole minutes above 10 minutes', () => {
    expect(formatEstimate(595)).toEqual({ unit: 'minutes', value: 10 })
    expect(formatEstimate(601)).toEqual({ unit: 'minutes', value: 10 })
    expect(formatEstimate(900)).toEqual({ unit: 'minutes', value: 15 })
    expect(formatEstimate(1500 + 29)).toEqual({ unit: 'minutes', value: 25 })
    expect(formatEstimate(1500 + 31)).toEqual({ unit: 'minutes', value: 26 })
  })

  it('switches to hours from 60 minutes on, with the remaining minutes', () => {
    expect(formatEstimate(3900)).toEqual({ unit: 'hours', value: 1, minutes: 5 })
    expect(formatEstimate(3600)).toEqual({ unit: 'hours', value: 1 })
    expect(formatEstimate(3570)).toEqual({ unit: 'hours', value: 1 })
    expect(formatEstimate(7500)).toEqual({ unit: 'hours', value: 2, minutes: 5 })
  })

  it('is monotone: a longer time never shows a smaller value', () => {
    const toSeconds = (f: ReturnType<typeof formatEstimate>): number =>
      f.unit === 'seconds' ? f.value : f.unit === 'minutes' ? f.value * 60 + (f.seconds ?? 0) : f.value * 3600 + (f.minutes ?? 0) * 60
    let last = 0
    for (let s = 0; s <= 8000; s += 3.7) {
      const shown = toSeconds(formatEstimate(s))
      expect(shown).toBeGreaterThanOrEqual(last)
      last = shown
    }
  })
})

describe('estimateGifSeconds', () => {
  const base = { width: 480, height: 270, fps: 15, durationMicros: 10_000_000, decodeMegapixels: 0 }
  it('is the render and quantize time for every frame plus start-up', () => {
    const frames = 150
    const megapixels = (480 * 270 * frames) / 1_000_000
    const expected = megapixels / GIF_RENDER_MP_PER_S + megapixels / GIF_QUANTIZE_MP_PER_S + 1.5
    expect(estimateGifSeconds(base)).toBeCloseTo(expected, 9)
  })
  it('grows with size and frame rate, and applies the calibration factor', () => {
    expect(estimateGifSeconds({ ...base, width: 640, height: 360 })).toBeGreaterThan(estimateGifSeconds(base))
    expect(estimateGifSeconds({ ...base, fps: 20 })).toBeGreaterThan(estimateGifSeconds(base))
    expect(estimateGifSeconds({ ...base, calibration: 2 })).toBeCloseTo(estimateGifSeconds(base) * 2, 9)
  })
  it('counts source decoding and treats an empty project as start-up only', () => {
    expect(estimateGifSeconds({ ...base, decodeMegapixels: 120 })).toBeCloseTo(estimateGifSeconds(base) + 1, 9)
    expect(estimateGifSeconds({ ...base, durationMicros: 0 })).toBeCloseTo(1.5, 9)
  })
})
