import { describe, expect, it } from 'vitest'
import { pictureShapeOf, pictureShapePatch } from './mediaShape'

const base = { width: 0.533, height: 0.3, radius: 0 }

describe('picture shape presets', () => {
  it('reads the preset back from the box', () => {
    expect(pictureShapeOf(base)).toBe('rect')
    expect(pictureShapeOf({ ...base, radius: 0.04 })).toBe('rounded')
    expect(pictureShapeOf({ width: 0.3, height: 0.3, radius: 0.5 })).toBe('round')
    // A rounded box that is not square is not a circle.
    expect(pictureShapeOf({ width: 0.5, height: 0.3, radius: 0.5 })).toBe('rounded')
  })

  it('round makes a square of the current height with a full radius', () => {
    expect(pictureShapePatch('round', base, 16 / 9)).toEqual({ width: 0.3, height: 0.3, radius: 0.5 })
  })

  it('rect and rounded keep the asset proportions', () => {
    const rect = pictureShapePatch('rect', base, 2)
    expect(rect).toEqual({ width: 0.6, height: 0.3, radius: 0 })
    expect(pictureShapePatch('rounded', base, 2)).toMatchObject({ width: 0.6, radius: 0.04 })
  })

  it('falls back to 16:9 when the asset has no usable size', () => {
    expect(pictureShapePatch('rect', base, 0)).toMatchObject({ width: 0.3 * (16 / 9) })
  })
})
