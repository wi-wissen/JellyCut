import { describe, expect, it } from 'vitest'
import { MICROS_PER_SECOND } from '../time'
import { changedMask, countSet, frameAt, keyframeBefore, meanDifferencePercent, rawVideoBytes, seekPlan, storedShares } from './demo'
import { polygonMask, removeSubject, renderFlipbook } from './flipbook'

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
