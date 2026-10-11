import { describe, expect, it } from 'vitest'
import { FallbackLog, isNearlyBlack } from './blank'

const rgba = (...pixels: number[][]): Uint8ClampedArray => Uint8ClampedArray.from(pixels.flatMap(([r, g, b, a]) => [r!, g!, b!, a ?? 255]))

describe('isNearlyBlack', () => {
  it('accepts black and compression noise', () => {
    expect(isNearlyBlack(rgba([0, 0, 0], [3, 2, 1], [10, 10, 10]))).toBe(true)
    expect(isNearlyBlack(new Uint8ClampedArray(0))).toBe(true)
  })

  it('rejects a picture with any visible pixel', () => {
    expect(isNearlyBlack(rgba([0, 0, 0], [0, 40, 0]))).toBe(false)
    expect(isNearlyBlack(rgba([11, 0, 0]))).toBe(false)
  })

  it('ignores the alpha channel', () => {
    expect(isNearlyBlack(rgba([0, 0, 0, 255], [0, 0, 0, 0]))).toBe(true)
  })
})

describe('FallbackLog', () => {
  it('reports the first fallback of an asset once', () => {
    const log = new FallbackLog()
    expect(log.note('a', 'missing')).toBe(true)
    expect(log.note('a', 'black')).toBe(false)
    expect(log.note('b', 'error')).toBe(true)
    expect(log.assets).toEqual(['a', 'b'])
    expect(log.has('a')).toBe(true)
    expect(log.has('c')).toBe(false)
    expect(log.reasonOf('a')).toBe('missing')
  })
})
