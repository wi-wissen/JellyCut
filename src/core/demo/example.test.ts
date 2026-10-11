import { describe, expect, it } from 'vitest'
import { secondsToMicros } from '../time'
import {
  EXAMPLE_CLIPS,
  EXAMPLE_HEIGHT,
  EXAMPLE_WIDTH,
  PALETTE_OCEAN,
  clockLabel,
  counterLabel,
  exampleFrameCount,
  exampleScene,
  gradientAt,
  mixRgb,
  percentOf,
  rgbCss,
  shapeCenter
} from './example'
import { melodySampleCount } from './melody'

describe('example clips', () => {
  it('have whole-second lengths and melodies that match them', () => {
    for (const clip of EXAMPLE_CLIPS) {
      expect(Number.isInteger(clip.seconds)).toBe(true)
      expect(melodySampleCount(clip.melody, 48000)).toBe(clip.seconds * 48000)
    }
    expect(exampleFrameCount(6)).toBe(180)
  })

  it('counts frames and percentages', () => {
    expect(exampleFrameCount(6, 30)).toBe(180)
    expect(percentOf(105, 300)).toBe(35)
    expect(percentOf(0, 0)).toBe(0)
    expect(percentOf(400, 300)).toBe(100)
  })
})

describe('colour maths', () => {
  it('mixes whole channel values and clamps the weight', () => {
    expect(mixRgb([0, 0, 0], [255, 100, 10], 0.5)).toEqual([128, 50, 5])
    expect(mixRgb([10, 20, 30], [200, 200, 200], -1)).toEqual([10, 20, 30])
    expect(mixRgb([10, 20, 30], [200, 200, 200], 3)).toEqual([200, 200, 200])
  })

  it('formats an rgb() string', () => {
    expect(rgbCss([1, 2, 3])).toBe('rgb(1, 2, 3)')
  })

  it('starts the gradient at the palette bottom and repeats after one cycle', () => {
    expect(gradientAt(PALETTE_OCEAN, 0).bottom).toEqual(PALETTE_OCEAN.bottom)
    expect(gradientAt(PALETTE_OCEAN, secondsToMicros(8.5))).toEqual(gradientAt(PALETTE_OCEAN, secondsToMicros(2.5)))
    const later = gradientAt(PALETTE_OCEAN, secondsToMicros(2.5))
    for (const c of [later.top, later.bottom]) {
      for (const v of c) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true)
    }
  })
})

describe('shape position', () => {
  it('keeps the shape inside the frame at every time', () => {
    const radius = Math.round(EXAMPLE_HEIGHT * 0.11)
    for (let t = 0; t <= 12_000_000; t += 250_000) {
      const { x, y } = shapeCenter(t, EXAMPLE_WIDTH, EXAMPLE_HEIGHT, radius)
      expect(x - radius).toBeGreaterThanOrEqual(0)
      expect(x + radius).toBeLessThanOrEqual(EXAMPLE_WIDTH)
      expect(y - radius).toBeGreaterThanOrEqual(0)
      expect(y + radius).toBeLessThanOrEqual(EXAMPLE_HEIGHT)
    }
  })
})

describe('labels', () => {
  it('shows the running counter with two decimals', () => {
    expect(counterLabel(0)).toBe('0.00 s')
    expect(counterLabel(1_234_567)).toBe('1.23 s')
  })

  it('shows clock labels as mm:ss', () => {
    expect(clockLabel(0)).toBe('00:00')
    expect(clockLabel(65_900_000)).toBe('01:05')
    expect(clockLabel(600_000_000)).toBe('10:00')
  })

  it('builds one scene with the title, counter and clock', () => {
    const palette = EXAMPLE_CLIPS[0]?.palette ?? PALETTE_OCEAN
    const scene = exampleScene(palette, secondsToMicros(4), secondsToMicros(6))
    expect(scene.title).toBe('Jelly Cut')
    expect(scene.counter).toBe('4.00 s')
    expect(scene.clock).toBe('00:04 / 00:06')
    expect(scene.shape.radius).toBeGreaterThan(0)
  })
})
