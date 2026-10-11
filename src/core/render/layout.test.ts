import { describe, expect, it } from 'vitest'
import {
  axisLock,
  dragToTransformDelta,
  fittedFrameRect,
  pointInRotatedRect,
  previewSize,
  rectCorners,
  scaleFromHandle,
  snapToGuides,
  textFontPx,
  textLineHeightPx,
  textPadPx,
  textRect,
  SNAP_GUIDES,
  type Box
} from './layout'

/** Mirror of the compositor's drawPicture corner maths, written independently of layout.ts. */
function compositorCorners(outW: number, outH: number, srcW: number, srcH: number, t: { fit: 'fit' | 'fill'; scale: number; x: number; y: number; rotation: number }) {
  const base = t.fit === 'fill' ? Math.max(outW / srcW, outH / srcH) : Math.min(outW / srcW, outH / srcH)
  const hw = (srcW * base * t.scale) / 2
  const hh = (srcH * base * t.scale) / 2
  const cx = outW / 2 + t.x * outW
  const cy = outH / 2 + t.y * outH
  const rad = (t.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const at = (dx: number, dy: number) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos })
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)]
}

/** Deterministic pseudo random numbers, so the property test is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('fittedFrameRect', () => {
  it('fit shows the whole 16:9 picture inside a 9:16 output', () => {
    const r = fittedFrameRect(1080, 1920, 1920, 1080, { fit: 'fit' })
    expect(r.w).toBeCloseTo(1080, 6)
    expect(r.h).toBeCloseTo(607.5, 6)
    expect(r).toMatchObject({ cx: 540, cy: 960, rotationDeg: 0, flipX: false })
  })

  it('fill covers the whole output and crops the picture', () => {
    const r = fittedFrameRect(1080, 1920, 1920, 1080, { fit: 'fill' })
    expect(r.h).toBeCloseTo(1920, 6)
    expect(r.w).toBeCloseTo(3413.333, 2)
  })

  it('scale is around the centre and x/y are fractions of the output', () => {
    const r = fittedFrameRect(1920, 1080, 1920, 1080, { fit: 'fit', scale: 0.5, x: 0.1, y: -0.2 })
    expect(r.w).toBeCloseTo(960, 6)
    expect(r.h).toBeCloseTo(540, 6)
    expect(r.cx).toBeCloseTo(960 + 192, 6)
    expect(r.cy).toBeCloseTo(540 - 216, 6)
  })

  it('sanitises invalid transform values like the compositor does', () => {
    const r = fittedFrameRect(100, 100, 100, 100, { scale: -3, x: Number.NaN, rotation: Number.NaN, flipX: 1 as unknown as boolean })
    expect(r).toMatchObject({ w: 100, h: 100, cx: 50, cy: 50, rotationDeg: 0, flipX: false })
  })

  it('matches the compositor corners for random transforms (property test)', () => {
    const next = rng(42)
    for (let i = 0; i < 500; i++) {
      const outW = 2 + Math.floor(next() * 2000)
      const outH = 2 + Math.floor(next() * 2000)
      const srcW = 1 + Math.floor(next() * 3000)
      const srcH = 1 + Math.floor(next() * 3000)
      const t = {
        fit: next() < 0.5 ? ('fit' as const) : ('fill' as const),
        scale: 0.25 + next() * 3.75,
        x: next() * 2 - 1,
        y: next() * 2 - 1,
        rotation: next() * 720 - 360
      }
      const expected = compositorCorners(outW, outH, srcW, srcH, t)
      const actual = rectCorners(fittedFrameRect(outW, outH, srcW, srcH, t))
      expected.forEach((p, k) => {
        expect(actual[k]!.x).toBeCloseTo(p.x, 6)
        expect(actual[k]!.y).toBeCloseTo(p.y, 6)
      })
    }
  })
})

describe('text geometry', () => {
  // Fake metrics: 0.5 px advance per px of font size and character, glyphs 0.7 em high, 0.2 em below the middle.
  const measure = (line: string, px: number) => {
    const width = line.length * px * 0.5
    return { width, left: width / 2, right: width / 2, ascent: 0.7 * px, descent: 0.2 * px }
  }

  it('scales the font size with the output height like the rasteriser', () => {
    expect(textFontPx(26, 1080)).toBe(26)
    expect(textFontPx(26, 720)).toBe(17)
    expect(textFontPx(0, 1080)).toBe(48)
    expect(textFontPx(1, 100)).toBe(1)
  })

  it('pads by the outline stroke plus 2 px', () => {
    expect(textPadPx(80, null)).toBe(2)
    expect(textPadPx(80, '#000000')).toBe(12)
  })

  it('boxes the glyphs, centred on pos, scaled by the layer scale and offset by offsetY', () => {
    // size 100 at 500 px high is a 46 px font: ink 92 wide, glyphs from -32.2 to +9.2 around the middle.
    const box = textRect(1000, 500, { text: 'abcd', style: { size: 100, outline: null }, pos: { x: 0.25, y: 0.5 }, scale: 2, offsetY: 0.1 }, measure)!
    expect(box.cx).toBeCloseTo(250, 6)
    expect(box.cy).toBeCloseTo(0.6 * 500 - 23, 6)
    expect(box.w).toBeCloseTo(2 * 92, 6)
    expect(box.h).toBeCloseTo(2 * (32.2 + 9.2), 6)
    expect(box.rotationDeg).toBe(0)
  })

  it('grows the box by half the outline stroke', () => {
    const plain = textRect(1000, 1080, { text: 'ab', style: { size: 80, outline: null }, pos: { x: 0.5, y: 0.5 } }, measure)!
    const outlined = textRect(1000, 1080, { text: 'ab', style: { size: 80, outline: '#000000' }, pos: { x: 0.5, y: 0.5 } }, measure)!
    expect(outlined.w - plain.w).toBeCloseTo(10, 6)
    expect(outlined.h - plain.h).toBeCloseTo(10, 6)
  })

  it('gives every line its own glyph rows', () => {
    const one = textRect(1000, 1080, { text: 'ab', style: { size: 80, outline: null }, pos: { x: 0.5, y: 0.5 } }, measure)!
    const two = textRect(1000, 1080, { text: 'ab\ncd', style: { size: 80, outline: null }, pos: { x: 0.5, y: 0.5 } }, measure)!
    expect(two.h).toBeCloseTo(one.h + 96, 6)
  })

  it('returns null for empty or blank text', () => {
    expect(textRect(100, 100, { text: '', style: { size: 10, outline: null }, pos: { x: 0.5, y: 0.5 } }, measure)).toBeNull()
    expect(textRect(100, 100, { text: ' ', style: { size: 10, outline: null }, pos: { x: 0.5, y: 0.5 } }, (l, px) => ({ ...measure(l, px), width: 0 }))).toBeNull()
  })

  it('hit-tests points in a rotated box', () => {
    const box: Box = { cx: 0, cy: 0, w: 40, h: 10, rotationDeg: 90 }
    expect(pointInRotatedRect({ x: 0, y: 15 }, box)).toBe(true)
    expect(pointInRotatedRect({ x: 15, y: 0 }, box)).toBe(false)
    expect(pointInRotatedRect({ x: 4.9, y: 19.9 }, box)).toBe(true)
  })
})

describe('gesture helpers', () => {
  it('converts a pixel drag into transform fractions', () => {
    expect(dragToTransformDelta(192, -108, 1920, 1080)).toEqual({ x: 0.1, y: -0.1 })
  })

  it('scales around the centre so that the dragged corner follows the pointer', () => {
    const box: Box = { cx: 500, cy: 300, w: 200, h: 100, rotationDeg: 0 }
    // Dragging the top right corner to twice the distance doubles the size.
    const corner = { x: 500 + 100, y: 300 - 50 }
    expect(scaleFromHandle(box, { sx: 1, sy: -1 }, corner, 1, 0.25, 4)).toBeCloseTo(1, 9)
    const far = { x: 500 + 200, y: 300 - 100 }
    expect(scaleFromHandle(box, { sx: 1, sy: -1 }, far, 1, 0.25, 4)).toBeCloseTo(2, 9)
    expect(scaleFromHandle(box, { sx: 1, sy: -1 }, far, 40, 8, 400)).toBeCloseTo(80, 9)
  })

  it('clamps scale results', () => {
    const box: Box = { cx: 0, cy: 0, w: 100, h: 100, rotationDeg: 0 }
    expect(scaleFromHandle(box, { sx: 1, sy: 1 }, { x: 1000, y: 1000 }, 1, 0.25, 4)).toBe(4)
    expect(scaleFromHandle(box, { sx: 1, sy: 1 }, { x: -1000, y: -1000 }, 1, 0.25, 4)).toBe(0.25)
  })

  it('handles rotated boxes', () => {
    const box: Box = { cx: 0, cy: 0, w: 100, h: 100, rotationDeg: 90 }
    // After a 90 degree turn the top right corner sits at the bottom right of the screen.
    const corner = rectCorners(box)[2]
    expect(scaleFromHandle(box, { sx: 1, sy: 1 }, { x: corner.x * 2, y: corner.y * 2 }, 1, 0, 10)).toBeCloseTo(2, 9)
  })

  it('snaps to the nearest guide within the threshold only', () => {
    expect(snapToGuides(0.495, SNAP_GUIDES, 0.01)).toEqual({ value: 0.5, guide: 0.5 })
    expect(snapToGuides(0.45, SNAP_GUIDES, 0.01)).toEqual({ value: 0.45, guide: null })
    expect(snapToGuides(0.34, SNAP_GUIDES, 0.02).guide).toBeCloseTo(1 / 3, 9)
    expect(snapToGuides(0.76, SNAP_GUIDES, 0.02).guide).toBe(0.75)
    expect(snapToGuides(0.5, SNAP_GUIDES, 0.0).guide).toBe(0.5)
  })

  it('locks a drag to the dominant axis', () => {
    expect(axisLock(10, 3)).toEqual({ x: 10, y: 0 })
    expect(axisLock(-2, 7)).toEqual({ x: 0, y: 7 })
  })
})

describe('previewSize', () => {
  it('caps the longest side at 1280 and keeps the ratio', () => {
    expect(previewSize({ width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 })
    expect(previewSize({ width: 1080, height: 1920 })).toEqual({ width: 720, height: 1280 })
    expect(previewSize({ width: 640, height: 360 })).toEqual({ width: 640, height: 360 })
  })
})
