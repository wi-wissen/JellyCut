import { describe, expect, it } from 'vitest'
import { MICROS_PER_SECOND } from '../time'
import { changedMask, countSet, demoWaveform, frameAt, jumpSteps, keyframeBefore, meanDifferencePercent, rawVideoBytes, seekPlan, storedShares } from './demo'
import { changeKinds, INSIDE_CHANGE, NEWLY_COVERED, polygonMask, removeSubject, renderFlipbook, shiftMask, UNCOVERED } from './flipbook'

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

  it('starts at the keyframe before the target', () => {
    expect(keyframeBefore(30 * S, 4 * S)).toBe(28 * S)
    expect(keyframeBefore(30 * S, 6 * S)).toBe(30 * S)
  })

  it('plans a seek: keyframe and the frames that must be rebuilt', () => {
    expect(seekPlan(30 * S, 4 * S, 30)).toEqual({ keyframe: 28 * S, framesToDecode: 60 })
    expect(seekPlan(30 * S, 6 * S, 30)).toEqual({ keyframe: 30 * S, framesToDecode: 0 })
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

describe('flipbook pixels', () => {
  it('fills a polygon by pixel centres', () => {
    const square = [[1, 1], [3, 1], [3, 3], [1, 3]] as const
    const mask = polygonMask(4, 4, square)
    expect(countSet(mask)).toBe(4)
    expect(mask[1 * 4 + 1]).toBe(1)
    expect(mask[0]).toBe(0)
  })

  it('removes the subject by blending across each masked run', () => {
    const row = new Uint8ClampedArray([0, 0, 0, 255, 90, 90, 90, 255, 90, 90, 90, 255, 90, 90, 90, 255])
    const mask = new Uint8Array([0, 1, 1, 0])
    const out = removeSubject(new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255, 200, 200, 200, 255, 90, 90, 90, 255]), 4, 1, mask)
    expect(out[4]).toBe(Math.round(0 + 90 / 3))
    expect(out[8]).toBe(Math.round(0 + (2 * 90) / 3))
    expect(out.slice(12)).toEqual(row.slice(12))
  })

  it('moves only the subject, and the background stays identical between frames', () => {
    const w = 6
    const source = new Uint8ClampedArray(w * 4)
    for (let x = 0; x < w; x++) source.set([x * 10, 0, 0, 255], x * 4)
    const mask = new Uint8Array([0, 1, 1, 0, 0, 0])
    const background = new Uint8ClampedArray(source.length).fill(7)
    const [first, second] = renderFlipbook(source, background, mask, w, 1, [0, 2])
    expect(first![0]).toBe(7)
    expect(second![0]).toBe(7)
    expect(second![3 * 4]).toBe(10)
    expect(second![4 * 4]).toBe(20)
    expect(countSet(changedMask(first!, second!, 0))).toBe(4)
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

describe('changed pixels at the moving edges', () => {
  // A 20 x 3 picture: the background is one grey, the subject a dark silhouette 8 px wide, moved 5 px.
  const width = 20
  const height = 3
  const background = new Uint8ClampedArray(width * height * 4).fill(200)
  for (let p = 0; p < width * height; p++) background[p * 4 + 3] = 255
  const source = new Uint8ClampedArray(background)
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 4; x < 12; x++) mask[y * width + x] = 1
  for (let p = 0; p < width * height; p++) if (mask[p]) source.set([30, 30, 30, 255], p * 4)

  it('marks the leading edge as newly covered and the trailing edge as uncovered', () => {
    const [before, now] = renderFlipbook(source, background, mask, width, height, [0, 5])
    const kinds = changeKinds(changedMask(before!, now!, 12), shiftMask(mask, width, height, 0), shiftMask(mask, width, height, 5))
    const expected = Array.from({ length: width }, (_, x) => (x >= 4 && x <= 8 ? UNCOVERED : x >= 12 && x <= 16 ? NEWLY_COVERED : 0))
    expect([...kinds.slice(width, 2 * width)]).toEqual(expected)
  })

  it('counts the uncovered background as changed, so both edges show up', () => {
    const [before, now] = renderFlipbook(source, background, mask, width, height, [0, 5])
    const changed = changedMask(before!, now!, 12)
    const kinds = changeKinds(changed, shiftMask(mask, width, height, 0), shiftMask(mask, width, height, 5))
    expect(countSet(changed)).toBe(10 * height)
    expect(kinds.filter((k) => k === NEWLY_COVERED).length).toBe(5 * height)
    expect(kinds.filter((k) => k === UNCOVERED).length).toBe(5 * height)
    expect(kinds.filter((k) => k === INSIDE_CHANGE).length).toBe(0)
    expect(now![4 * 4]).toBe(200)
    expect(before![4 * 4]).toBe(30)
  })
})
