import { describe, expect, it } from 'vitest'
import { MICROS_PER_SECOND } from '../time'
import { changedMask, countSet, demoWaveform, frameAt, jumpSteps, meanDifferencePercent, rawVideoBytes, storedShares } from './demo'

const S = MICROS_PER_SECOND

describe('raw video size', () => {
  it('is 11.2 GB for one minute of 1080p at 30 fps', () => {
    expect(rawVideoBytes(1920, 1080, 30, 60)).toBe(11_197_440_000)
  })
})

describe('frames and keyframes', () => {
  it('finds the frame on screen at a time', () => {
    expect(frameAt(30 * S, 30)).toBe(900)
    expect(frameAt(S / 2, 30)).toBe(15)
  })

  it('stores whole pictures at keyframes and changes elsewhere', () => {
    expect(storedShares([0, 10, 20, 30], 100, 2)).toEqual([1, 0.1, 1, 0.3])
    expect(storedShares([0, 10, 20, 30], 100, 4)).toEqual([1, 0.1, 0.2, 0.3])
  })
})

describe('pixel comparison', () => {
  const pixel = (r: number, g: number, b: number) => [r, g, b, 255]
  const image = (...pixels: number[][]) => new Uint8ClampedArray(pixels.flat())

  it('marks pixels whose largest channel difference exceeds the threshold', () => {
    const a = image(pixel(0, 0, 0), pixel(100, 100, 100), pixel(10, 10, 10))
    const b = image(pixel(5, 0, 0), pixel(100, 100, 150), pixel(10, 10, 10))
    expect([...changedMask(a, b, 8)]).toEqual([0, 1, 0])
    expect(countSet(changedMask(a, b, 4))).toBe(2)
  })

  it('averages colour differences in percent', () => {
    const a = image(pixel(0, 0, 0))
    expect(meanDifferencePercent(a, a)).toBe(0)
    expect(meanDifferencePercent(a, image(pixel(255, 255, 255)))).toBe(100)
  })
})

describe('jump plan', () => {
  it('rebuilds the frames between the keyframe before the target and the target', () => {
    expect(jumpSteps(23, 8)).toEqual({ keyframe: 16, rebuild: [17, 18, 19, 20, 21, 22, 23] })
    expect(jumpSteps(24, 8)).toEqual({ keyframe: 24, rebuild: [] })
    expect(jumpSteps(0, 4)).toEqual({ keyframe: 0, rebuild: [] })
  })
})

describe('demo waveform', () => {
  it('is the same for the same seed and has many different bar heights', () => {
    const bars = demoWaveform(120)
    expect(demoWaveform(120)).toEqual(bars)
    expect(new Set(bars.map((b) => b.toFixed(3))).size).toBeGreaterThanOrEqual(6)
    expect(Math.max(...bars)).toBe(1)
  })

  it('is not periodic: no lag up to 40 bars correlates strongly with the original', () => {
    const bars = demoWaveform(120)
    const mean = bars.reduce((a, b) => a + b, 0) / bars.length
    const variance = bars.reduce((a, b) => a + (b - mean) ** 2, 0)
    for (let lag = 4; lag <= 40; lag++) {
      let sum = 0
      for (let i = 0; i + lag < bars.length; i++) sum += (bars[i]! - mean) * (bars[i + lag]! - mean)
      expect(Math.abs(sum / variance)).toBeLessThan(0.4)
    }
  })
})
