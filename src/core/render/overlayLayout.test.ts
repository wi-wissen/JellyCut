import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import type { OverlayItem } from '../project/types'
import { addRegion, addShape, addSticker, addStroke } from '../timeline/overlayOps'
import { STICKER_BOX_RATIO } from '../timeline/overlayCatalog'
import { pointInRotatedRect, rectCorners } from './layout'
import { overlayBounds, overlayBox, regionBlurSigma, regionCellSize } from './overlayLayout'
import { buildScene, planTimeline } from './scene'
import { secondsToMicros } from '../time'

const base = { id: 'o', start: 0, duration: 1, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 }
const S = 1_000_000

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
    expect(buildScene(p, planned, secondsToMicros(2)).overlays.map((o) => o.item.id)).toEqual(['a'])
    expect(buildScene(p, planned, secondsToMicros(4.5)).overlays.map((o) => o.item.id)).toEqual(['b'])
    // The sticker ends at 1 s + 3 s; a time at exactly the end is no longer on screen.
    expect(buildScene(p, planned, secondsToMicros(4)).overlays.map((o) => o.item.id)).toEqual(['b'])
  })
})

describe('overlay appearance in the scene', () => {
  const sticker = (extra: Partial<OverlayItem> = {}): OverlayItem => ({ ...base, id: 's', kind: 'sticker', emoji: '⭐', size: 0.1, start: 0, duration: 4 * S, ...extra } as OverlayItem)
  const scene = (items: OverlayItem[], t: number) => {
    const p = { ...createProject('look'), overlays: items }
    return buildScene(p, planTimeline(p), t)
  }

  it('is fully opaque and unanimated without any setting (existing projects look the same)', () => {
    const [layer] = scene([sticker()], 2 * S).overlays
    expect(layer).toMatchObject({ x: 0.5, y: 0.5, scale: 1, rotation: 0, alpha: 1, srcTime: 0 })
  })

  it('multiplies the opacity with the entrance animation', () => {
    const [half] = scene([sticker({ opacity: 0.5 })], 2 * S).overlays
    expect(half!.alpha).toBeCloseTo(0.5)
    // Fade in: after half of the default 400 ms the item is half visible; at 100 ms of opacity 0.5 it is 0.125.
    const [faded] = scene([sticker({ opacity: 0.5, animIn: 'fade' })], 100_000).overlays
    expect(faded!.alpha).toBeCloseTo(0.5 * 0.25)
  })

  it('pop starts small and grows to the item scale, slideUp starts lower on screen', () => {
    const [popStart] = scene([sticker({ animIn: 'pop', scale: 2 })], 0).overlays
    expect(popStart!.scale).toBeCloseTo(2 * 0.4)
    expect(popStart!.alpha).toBe(0)
    const [popEnd] = scene([sticker({ animIn: 'pop', scale: 2 })], 2 * S).overlays
    expect(popEnd!.scale).toBe(2)
    const [slide] = scene([sticker({ animIn: 'slideUp' })], 0).overlays
    expect(slide!.y).toBeCloseTo(0.5 + 0.06)
  })

  it('exit animations run backwards at the end of the item', () => {
    const [gone] = scene([sticker({ animOut: 'fade' })], 4 * S - 1).overlays
    expect(gone!.alpha).toBeLessThan(0.01)
    const [still] = scene([sticker({ animOut: 'fade' })], 2 * S).overlays
    expect(still!.alpha).toBe(1)
  })

  it('wiggle swings the rotation to either side over time and does not move the anchor', () => {
    const rotations = [0, 225_000, 675_000].map((dt) => scene([sticker({ loop: 'wiggle', rotation: 30, start: S })], S + dt).overlays[0]!)
    expect(rotations[0]!.rotation).toBeCloseTo(30, 6)
    expect(rotations[1]!.rotation).toBeGreaterThan(30 + 7)
    expect(rotations[2]!.rotation).toBeLessThan(30 - 7)
    expect(rotations[1]!.x).toBe(0.5)
  })

  it('a picture-in-picture video plays from its first frame and holds its last one', () => {
    const video = { id: 'v', kind: 'video', name: 'v.webm', relPath: 'v.webm', size: 1, duration: 2 * S } as const
    const picture = { ...base, id: 'm', kind: 'media', assetId: 'v', start: S, duration: 4 * S, width: 0.5, height: 0.3, radius: 0, border: 0, borderColor: '#ffffff' } as OverlayItem
    const p = { ...createProject('pip'), assets: [video], overlays: [picture] }
    const planned = planTimeline(p)
    expect(buildScene(p, planned, S).overlays[0]!.srcTime).toBe(0)
    expect(buildScene(p, planned, S + 500_000).overlays[0]!.srcTime).toBe(500_000)
    expect(buildScene(p, planned, 5 * S - 1).overlays[0]!.srcTime).toBe(2 * S - 1)
  })

  it('a picture-in-picture image has no source time', () => {
    const image = { id: 'i', kind: 'image', name: 'i.png', relPath: 'i.png', size: 1, duration: 0 } as const
    const picture = { ...base, id: 'm', kind: 'media', assetId: 'i', start: 0, duration: S, width: 0.5, height: 0.3, radius: 0, border: 0, borderColor: '#ffffff' } as OverlayItem
    const p = { ...createProject('pip'), assets: [image], overlays: [picture] }
    expect(buildScene(p, planTimeline(p), 500_000).overlays[0]!.srcTime).toBe(0)
  })
})

describe('region strength', () => {
  it('grows the blur sigma and the mosaic cell with the strength, relative to the output height', () => {
    expect(regionBlurSigma(0, 1000)).toBeCloseTo(4)
    expect(regionBlurSigma(1, 1000)).toBeCloseTo(64)
    expect(regionBlurSigma(0.5, 1000)).toBeGreaterThan(regionBlurSigma(0.2, 1000))
    expect(regionCellSize(0, 1000)).toBeCloseTo(8)
    expect(regionCellSize(1, 1000)).toBeCloseTo(88)
  })

  it('clamps strengths outside 0..1', () => {
    expect(regionBlurSigma(-3, 1000)).toBe(regionBlurSigma(0, 1000))
    expect(regionCellSize(9, 1000)).toBe(regionCellSize(1, 1000))
  })

  it('passes a blur area through the scene with its box and full opacity', () => {
    let p = createProject('region')
    p = addRegion(p, 'r', 0, 'pixelate')
    const [layer] = buildScene(p, planTimeline(p), secondsToMicros(1)).overlays
    expect(layer).toMatchObject({ x: 0.5, y: 0.5, alpha: 1, srcTime: 0 })
    expect(layer!.item.kind).toBe('region')
    const box = overlayBox(layer!.item, 1920, 1080, layer)
    expect(box.w).toBeCloseTo(0.3 * 1080)
    expect(box.h).toBeCloseTo(0.2 * 1080)
  })
})
