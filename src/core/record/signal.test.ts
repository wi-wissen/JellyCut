import { describe, expect, it } from 'vitest'
import { BLACK_LUMA, LevelAccumulator, NO_SIGNAL_LEVEL, QuietWatch, SILENT_PEAK, judgeRecording, meanLuma, type RecordingCheck } from './signal'

describe('QuietWatch', () => {
  it('warns only after the value stayed low for the whole window, and clears at the first loud sample', () => {
    const watch = new QuietWatch(NO_SIGNAL_LEVEL)
    for (let t = 0; t <= 2900; t += 100) watch.push(t, 0)
    expect(watch.isQuiet(3000)).toBe(false)
    watch.push(3000, 0)
    expect(watch.isQuiet(3000)).toBe(true)
    watch.push(3100, 0.05)
    expect(watch.isQuiet(3000)).toBe(false)
    expect(watch.range()).toEqual({ min: 0, max: 0.05, samples: 32 })
  })

  it('measures the quiet stretch from the last loud sample, not from the start', () => {
    const watch = new QuietWatch(0.01)
    watch.push(0, 0.5)
    watch.push(1000, 0)
    watch.push(4500, 0)
    expect(watch.quietForMs()).toBe(4500)
    expect(watch.isQuiet()).toBe(true)
  })

  it('is not quiet before any sample and ignores non-finite values', () => {
    const watch = new QuietWatch(0.01)
    expect(watch.isQuiet()).toBe(false)
    watch.push(0, Number.NaN)
    expect(watch.range()).toBeNull()
  })
})

describe('meanLuma', () => {
  it('is 0 for black and 255 for white pixels', () => {
    expect(meanLuma(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]))).toBe(0)
    expect(meanLuma(new Uint8ClampedArray([255, 255, 255, 255]))).toBeCloseTo(255, 3)
    expect(meanLuma([])).toBe(0)
    expect(meanLuma(new Uint8ClampedArray([10, 10, 10, 255]))).toBeGreaterThan(BLACK_LUMA)
  })
})

describe('LevelAccumulator', () => {
  it('tracks peak and RMS over all channels', () => {
    const acc = new LevelAccumulator()
    acc.push([Float32Array.of(0.5, -0.5), Float32Array.of(0, 0)])
    expect(acc.peak).toBe(0.5)
    expect(acc.rms).toBeCloseTo(Math.sqrt(0.125), 5)
  })
})

describe('judgeRecording', () => {
  const base: RecordingCheck = { hasAudioTrack: true, audioPeak: 0.2, audioRms: 0.05, audioSeconds: 5, hasVideoTrack: true, frameLuma: [90, 91] }
  it('accepts a normal file', () => {
    expect(judgeRecording(base, true)).toEqual({ silentAudio: false, blackPicture: false })
  })
  it('flags a silent audio track and a missing one when sound was expected', () => {
    expect(judgeRecording({ ...base, audioPeak: SILENT_PEAK / 2 }, true).silentAudio).toBe(true)
    expect(judgeRecording({ ...base, hasAudioTrack: false }, true).silentAudio).toBe(true)
    expect(judgeRecording({ ...base, hasAudioTrack: false }, false).silentAudio).toBe(false)
  })
  it('flags a black picture only when every sampled frame is black', () => {
    expect(judgeRecording({ ...base, frameLuma: [0.1, 0.4] }, true).blackPicture).toBe(true)
    expect(judgeRecording({ ...base, frameLuma: [0.1, 40] }, true).blackPicture).toBe(false)
    expect(judgeRecording({ ...base, frameLuma: [] }, true).blackPicture).toBe(false)
  })
  it('does not accuse a file that could not be measured', () => {
    expect(judgeRecording(null, true)).toEqual({ silentAudio: false, blackPicture: false })
  })
})
