import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import type { OverlayItem } from '../project/types'
import { addShape, addSticker, addStroke } from '../timeline/overlayOps'
import { STICKER_BOX_RATIO } from '../timeline/overlayCatalog'
import { pointInRotatedRect, rectCorners } from './layout'
import { overlayBounds, overlayBox } from './overlayLayout'
import { buildScene, planTimeline } from './scene'
import { secondsToMicros } from '../time'

const base = { id: 'o', start: 0, duration: 1, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 }

describe('overlayBounds', () => {
  it('is a square for stickers, from the glyph height and the box ratio', () => {
    const b = overlayBounds({ ...base, kind: 'sticker', emoji: '⭐', size: 0.1 })
    const half = (0.1 * STICKER_BOX_RATIO) / 2
    expect(b).toEqual({ minX: -half, minY: -half, maxX: half, maxY: half })
  })

  it('grows shapes by half the line width on every side', () => {
    const b = overlayBounds({ ...base, kind: 'shape', shape: 'rect', width: 0.4, height: 0.2, lineWidth: 0.01, color: '#000000' })
    expect(b.maxX).toBeCloseTo(0.2 + 0.005)
    expect(b.maxY).toBeCloseTo(0.1 + 0.005)
    expect(b.minX).toBeCloseTo(-b.maxX)
  })

  it('encloses every stroke point plus half the line width', () => {
    const b = overlayBounds({ ...base, kind: 'stroke', points: [[-0.1, 0.02], [0.3, -0.05]], lineWidth: 0.02, color: '#000000' })
    expect(b.minX).toBeCloseTo(-0.11)
    expect(b.minY).toBeCloseTo(-0.06)
    expect(b.maxX).toBeCloseTo(0.31)
    expect(b.maxY).toBeCloseTo(0.03)
  })
})

describe('overlayBox', () => {
  it('places an unrotated, unscaled item centred on its anchor in output pixels', () => {
    const item: OverlayItem = { ...base, kind: 'shape', shape: 'ellipse', width: 0.2, height: 0.1, lineWidth: 0, color: '#000000', pos: { x: 0.25, y: 0.5 } }
    const box = overlayBox(item, 1920, 1080)
    expect(box.cx).toBeCloseTo(480)
    expect(box.cy).toBeCloseTo(540)
    expect(box.w).toBeCloseTo(0.2 * 1080)
    expect(box.h).toBeCloseTo(0.1 * 1080)
    expect(box.rotationDeg).toBe(0)
  })

  it('scales the box around the anchor and rotates its offset clockwise on screen', () => {
    // A stroke whose centre sits 0.1 output-height units right of the anchor, rotated by 90 degrees.
    const item: OverlayItem = { ...base, kind: 'stroke', points: [[0.05, 0], [0.15, 0]], lineWidth: 0, color: '#000000', scale: 2, rotation: 90 }
    const box = overlayBox(item, 1000, 1000)
    // Offset (0.1 * 2 * 1000, 0) rotated by 90 degrees clockwise (y down) becomes (0, 200).
    expect(box.cx).toBeCloseTo(500, 3)
    expect(box.cy).toBeCloseTo(700, 3)
    expect(box.w).toBeCloseTo(0.1 * 1000 * 2, 3)
  })

  it('matches the corners the compositor would draw', () => {
    const item: OverlayItem = { ...base, kind: 'sticker', emoji: '⭐', size: 0.2, rotation: 30 }
    const box = overlayBox(item, 1280, 720)
    const corners = rectCorners(box)
    const centre = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 }
    expect(centre.x).toBeCloseTo(box.cx)
    expect(centre.y).toBeCloseTo(box.cy)
    expect(pointInRotatedRect({ x: box.cx, y: box.cy }, box)).toBe(true)
  })
})

describe('overlay geometry round trip', () => {
  it('keeps a stroke in place when its points are rebuilt from the anchor', () => {
    let p = createProject('g')
    p = addStroke(p, 's', 0, [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.4 }], '#ff0000')
    const item = p.overlays[0]!
    if (item.kind !== 'stroke') throw new Error('expected a stroke')
    const aspect = 16 / 9
    const first = { x: (item.pos.x + item.points[0]![0] / aspect) * 1, y: item.pos.y + item.points[0]![1] }
    expect(first.x).toBeCloseTo(0.2, 4)
    expect(first.y).toBeCloseTo(0.2, 4)
  })
})

describe('buildScene overlays', () => {
  it('includes only items active at the time, in list order', () => {
    let p = createProject('scene')
    p = addSticker(p, 'a', secondsToMicros(1), '⭐')
    p = addShape(p, 'b', secondsToMicros(4), 'rect', '#00ff00')
    const planned = planTimeline(p)
    expect(buildScene(p, planned, secondsToMicros(0.5)).overlays).toEqual([])
    expect(buildScene(p, planned, secondsToMicros(2)).overlays.map((o) => o.id)).toEqual(['a'])
    expect(buildScene(p, planned, secondsToMicros(4.5)).overlays.map((o) => o.id)).toEqual(['b'])
    // The sticker ends at 1 s + 3 s; a time at exactly the end is no longer on screen.
    expect(buildScene(p, planned, secondsToMicros(4)).overlays.map((o) => o.id)).toEqual(['b'])
  })
})
