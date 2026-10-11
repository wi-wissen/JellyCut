import { describe, expect, it } from 'vitest'
import {
  AUDIO_BITRATE,
  defaultExportOptions,
  estimateFileSize,
  outputSize,
  totalFrames,
  videoBitrate,
  type ExportOptions
} from './presets'
import { createProject } from '../project/schema'

describe('outputSize', () => {
  it('uses the resolution as the short side and keeps the aspect ratio', () => {
    expect(outputSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 })
    expect(outputSize('16:9', 720)).toEqual({ width: 1280, height: 720 })
    expect(outputSize('16:9', 480)).toEqual({ width: 854, height: 480 })
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 })
    expect(outputSize('9:16', 720)).toEqual({ width: 720, height: 1280 })
    expect(outputSize('1:1', 480)).toEqual({ width: 480, height: 480 })
    expect(outputSize('4:5', 1080)).toEqual({ width: 1080, height: 1350 })
    expect(outputSize('4:5', 720)).toEqual({ width: 720, height: 900 })
    expect(outputSize('4:5', 480)).toEqual({ width: 480, height: 600 })
  })
  it('always returns even numbers (required by H.264)', () => {
    for (const ratio of ['16:9', '9:16', '1:1', '4:5'] as const) {
      for (const res of [480, 720, 1080] as const) {
        const { width, height } = outputSize(ratio, res)
        expect(width % 2).toBe(0)
        expect(height % 2).toBe(0)
      }
    }
  })
})

describe('videoBitrate', () => {
  it('has the documented start values for 1080p30', () => {
    expect(videoBitrate(1920, 1080, 30, 'good')).toBe(7_000_000)
    expect(videoBitrate(1920, 1080, 30, 'small')).toBe(3_500_000)
    expect(videoBitrate(1920, 1080, 30, 'tiny')).toBe(1_800_000)
  })
  it('is ordered by quality and grows with size and frame rate', () => {
    const b = (w: number, h: number, f: number, q: 'good' | 'small' | 'tiny') => videoBitrate(w, h, f, q)
    expect(b(1280, 720, 30, 'good')).toBeGreaterThan(b(1280, 720, 30, 'small'))
    expect(b(1280, 720, 30, 'small')).toBeGreaterThan(b(1280, 720, 30, 'tiny'))
    expect(b(1920, 1080, 30, 'good')).toBeGreaterThan(b(1280, 720, 30, 'good'))
    expect(b(1280, 720, 30, 'good')).toBeGreaterThan(b(854, 480, 30, 'good'))
    expect(b(1920, 1080, 60, 'good')).toBeGreaterThan(b(1920, 1080, 30, 'good'))
    expect(b(1920, 1080, 24, 'good')).toBeLessThan(b(1920, 1080, 30, 'good'))
  })
  it('scales proportionally to the pixel count and returns whole bits per second', () => {
    expect(videoBitrate(1280, 720, 30, 'good')).toBeCloseTo((7_000_000 * 1280 * 720) / (1920 * 1080), -3)
    expect(Number.isInteger(videoBitrate(854, 480, 24, 'tiny'))).toBe(true)
  })
  it('never goes below a sensible floor', () => {
    expect(videoBitrate(160, 90, 24, 'tiny')).toBeGreaterThanOrEqual(250_000)
  })
})

describe('estimateFileSize', () => {
  const opts: ExportOptions = { resolution: 1080, fps: 30, quality: 'good', format: 'mp4' }
  it('is (video + audio bitrate) times duration in bytes', () => {
    const bytes = estimateFileSize(opts, '16:9', 10_000_000)
    expect(bytes).toBeCloseTo(((7_000_000 + AUDIO_BITRATE) * 10) / 8, -2)
  })
  it('is zero for an empty project', () => {
    expect(estimateFileSize(opts, '16:9', 0)).toBe(0)
  })
  it('is smaller for smaller settings', () => {
    const big = estimateFileSize(opts, '16:9', 30_000_000)
    const small = estimateFileSize({ ...opts, quality: 'tiny', resolution: 480 }, '16:9', 30_000_000)
    expect(small).toBeLessThan(big / 4)
  })
})

describe('totalFrames', () => {
  it('rounds up so the last partial frame is included', () => {
    expect(totalFrames(1_000_000, 30)).toBe(30)
    expect(totalFrames(1_000_001, 30)).toBe(31)
    expect(totalFrames(33_333, 30)).toBe(1)
    expect(totalFrames(33_334, 30)).toBe(2)
    expect(totalFrames(0, 30)).toBe(0)
    expect(totalFrames(3 * 60 * 1_000_000, 60)).toBe(10_800)
  })
  it('is exact for large durations (50 minutes at 60 fps)', () => {
    expect(totalFrames(50 * 60 * 1_000_000, 60)).toBe(180_000)
  })
})

describe('defaultExportOptions', () => {
  it('starts with 1080p, the project frame rate and good quality', () => {
    const p = createProject('x')
    expect(defaultExportOptions(p)).toEqual({ resolution: 1080, fps: 30, quality: 'good', format: 'mp4' })
  })
  it('snaps an unusual project frame rate to the nearest offered one', () => {
    const p = createProject('x')
    p.format.fps = 29.97
    expect(defaultExportOptions(p).fps).toBe(30)
    p.format.fps = 50
    expect(defaultExportOptions(p).fps).toBe(60)
    p.format.fps = 25
    expect(defaultExportOptions(p).fps).toBe(24)
  })
})
