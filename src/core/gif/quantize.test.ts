import { describe, expect, it } from 'vitest'
import { PaletteMapper, buildPalette, quantize } from './quantize'

function rgbaOf(pixels: [number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4)
  pixels.forEach(([r, g, b], i) => {
    out.set([r, g, b, 255], i * 4)
  })
  return out
}

function gradientRgba(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      out[o] = (x * 255) / (width - 1)
      out[o + 1] = (y * 255) / (height - 1)
      out[o + 2] = ((x + y) * 255) / (width + height - 2)
      out[o + 3] = 255
    }
  }
  return out
}

function paletteColors(palette: Uint8Array): string[] {
  const colors: string[] = []
  for (let i = 0; i < palette.length; i += 3) colors.push(`${palette[i]},${palette[i + 1]},${palette[i + 2]}`)
  return colors
}

function meanError(rgba: Uint8ClampedArray, palette: Uint8Array, indexes: Uint8Array): number {
  let sum = 0
  for (let p = 0; p < indexes.length; p++) {
    for (let c = 0; c < 3; c++) sum += Math.abs(rgba[p * 4 + c]! - palette[indexes[p]! * 3 + c]!)
  }
  return sum / (indexes.length * 3)
}

describe('quantize', () => {
  it('gives one exact colour for a flat image', () => {
    const rgba = rgbaOf(Array.from({ length: 64 }, () => [12, 200, 77] as [number, number, number]))
    const { palette, indexes } = quantize(rgba, 8, 8)
    expect(paletteColors(palette)).toEqual(['12,200,77'])
    expect(indexes.every((i) => i === 0)).toBe(true)
  })

  it('keeps every colour exactly when there are at most maxColors distinct colours', () => {
    const colors: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [250, 10, 10],
      [10, 250, 10],
      [10, 10, 250],
      [128, 128, 128]
    ]
    const pixels = Array.from({ length: 600 }, (_, i) => colors[(i * 7) % colors.length]!)
    const rgba = rgbaOf(pixels)
    const { palette, indexes } = quantize(rgba, 30, 20, 16)
    expect(palette.length / 3).toBe(colors.length)
    pixels.forEach((c, p) => {
      const i = indexes[p]!
      expect([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]]).toEqual(c)
    })
  })

  it('reduces a smooth gradient to maxColors with a small mean error', () => {
    const rgba = gradientRgba(128, 96)
    const { palette, indexes } = quantize(rgba, 128, 96, 256)
    expect(palette.length / 3).toBeLessThanOrEqual(256)
    expect(palette.length / 3).toBeGreaterThan(200)
    expect(meanError(rgba, palette, indexes)).toBeLessThan(6)
  })

  it('respects a smaller colour limit', () => {
    const rgba = gradientRgba(64, 64)
    const { palette, indexes } = quantize(rgba, 64, 64, 16)
    expect(palette.length / 3).toBeLessThanOrEqual(16)
    expect(Math.max(...indexes)).toBeLessThan(palette.length / 3)
  })

  it('is deterministic', () => {
    const rgba = gradientRgba(40, 30)
    const a = quantize(rgba, 40, 30, 64)
    const b = quantize(rgba, 40, 30, 64)
    expect(a.palette).toEqual(b.palette)
    expect(a.indexes).toEqual(b.indexes)
  })

  it('dithering keeps the indexes valid and changes the error only a little', () => {
    const rgba = gradientRgba(48, 32)
    const plain = quantize(rgba, 48, 32, 8)
    const dithered = quantize(rgba, 48, 32, 8, { dither: true })
    expect(dithered.palette).toEqual(plain.palette)
    expect(Math.max(...dithered.indexes)).toBeLessThan(plain.palette.length / 3)
    expect(meanError(rgba, dithered.palette, dithered.indexes)).toBeLessThan(meanError(rgba, plain.palette, plain.indexes) * 1.5)
  })

  it('builds one palette over several frames so each frame sees the same colours', () => {
    const red = rgbaOf(Array.from({ length: 100 }, () => [255, 0, 0] as [number, number, number]))
    const blue = rgbaOf(Array.from({ length: 100 }, () => [0, 0, 255] as [number, number, number]))
    const palette = buildPalette([red, blue], 2)
    const colors = paletteColors(palette)
    expect(colors).toEqual(expect.arrayContaining(['255,0,0', '0,0,255']))
    const mapper = new PaletteMapper(palette)
    expect(Array.from(mapper.map(red, 10, 10)).every((i) => palette[i * 3] === 255)).toBe(true)
    expect(Array.from(mapper.map(blue, 10, 10)).every((i) => palette[i * 3 + 2] === 255)).toBe(true)
  })

  it('takes colours from every frame, not only the first', () => {
    const frames = [0, 1, 2, 3].map((k) => rgbaOf(Array.from({ length: 50 }, () => (k === 3 ? [0, 255, 0] : [k * 10, 0, 0]) as [number, number, number])))
    const colors = paletteColors(buildPalette(frames, 8))
    expect(colors).toContain('0,255,0')
  })

  it('returns an empty palette for no pixels', () => {
    expect(buildPalette([], 16).length).toBe(0)
  })
})

describe('PaletteMapper', () => {
  it('maps an unseen colour to the nearest palette entry', () => {
    const mapper = new PaletteMapper(Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 0, 0]))
    const indexes = mapper.map(rgbaOf([[10, 5, 0], [240, 250, 255], [200, 30, 20]]), 3, 1)
    expect(Array.from(indexes)).toEqual([0, 1, 2])
  })

  it('rejects palettes that do not fit a GIF', () => {
    expect(() => new PaletteMapper(new Uint8Array(0))).toThrow(RangeError)
    expect(() => new PaletteMapper(new Uint8Array(4))).toThrow(RangeError)
    expect(() => new PaletteMapper(new Uint8Array(257 * 3))).toThrow(RangeError)
  })
})
