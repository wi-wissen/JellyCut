import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { MediaOverlay, OverlayItem, Project, RegionOverlay, StickerOverlay, StrokeOverlay } from '../project/types'
import { MARKER_PRESET } from './overlayCatalog'
import {
  addRegion,
  addStroke,
  addVectorSticker,
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
  updateOverlay
} from './overlayOps'
import { packRows, type Span } from './overlayRows'

const S = 1_000_000
const RED = '#ff0000'

/** A project with three overlays in list order: a (back), b, c (front). */
function stacked(): Project {
  let p = createProject('layers')
  p = addVectorSticker(p, 'a', 0, 'star', RED)
  p = addVectorSticker(p, 'b', 0, 'heart', RED)
  p = addVectorSticker(p, 'c', 0, 'check', RED)
  return p
}
const order = (p: Project) => p.overlays.map((o) => o.id)

describe('stacking order', () => {
  it('moves one step forward or backward, swapping with the neighbour', () => {
    expect(order(bringForward(stacked(), 'a'))).toEqual(['b', 'a', 'c'])
    expect(order(sendBackward(stacked(), 'c'))).toEqual(['a', 'c', 'b'])
  })

  it('moves to the very front or back', () => {
    expect(order(bringToFront(stacked(), 'a'))).toEqual(['b', 'c', 'a'])
    expect(order(sendToBack(stacked(), 'c'))).toEqual(['c', 'a', 'b'])
  })

  it('does nothing at the edges, for unknown ids, and returns the same object then', () => {
    const p = stacked()
    expect(bringForward(p, 'c')).toBe(p)
    expect(sendBackward(p, 'a')).toBe(p)
    expect(bringToFront(p, 'c')).toBe(p)
    expect(sendToBack(p, 'a')).toBe(p)
    expect(bringForward(p, 'missing')).toBe(p)
  })

  it('keeps every item and its data, and leaves the input untouched (undo keeps the old list)', () => {
    const p = stacked()
    const before = JSON.stringify(p)
    const next = bringToFront(p, 'a')
    expect(JSON.stringify(p)).toBe(before)
    expect(next.overlays.map((o) => o.id)).toEqual(['b', 'c', 'a'])
    expect(next.overlays).toHaveLength(3)
    expect(next.overlays.find((o) => o.id === 'a')).toEqual(p.overlays[0])
  })

  it('the timeline lanes follow the stacking: the bar in front gets the upper row', () => {
    const spans: Span[] = [
      { start: 0, end: 3 },
      { start: 1, end: 2 },
      { start: 2.5, end: 4 }
    ]
    // The last bar is in front: it takes row 0; the bar at the start overlaps it and goes lower.
    expect(packRows(spans).rows).toEqual([1, 0, 0])
    // Reversing the list reverses the front: now the first bar is in front.
    expect(packRows([...spans].reverse()).rows).toEqual([1, 1, 0])
  })
})

describe('vector stickers', () => {
  it('adds a shape sticker with colour and optional outline, and refuses bad input', () => {
    const p = addVectorSticker(createProject('s'), 's1', 2 * S, 'cloud', '#00FF00', { x: 0.2, y: 0.3 }, '#101010')
    expect(p.overlays[0]).toMatchObject({ kind: 'sticker', shape: 'cloud', color: '#00ff00', outline: '#101010', start: 2 * S, pos: { x: 0.2, y: 0.3 } })
    expect(p.overlays[0]).not.toHaveProperty('emoji')
    expect(validateProject(p).ok).toBe(true)
    expect(addVectorSticker(p, 's1', 0, 'star', RED)).toBe(p)
    expect(addVectorSticker(createProject('s'), 's2', 0, 'nope' as never, RED)).toEqual(createProject('s'))
    expect(addVectorSticker(createProject('s'), 's3', 0, 'star', 'red')).toEqual(createProject('s'))
  })

  it('recolours and changes the shape or outline of a vector sticker, but not an emoji sticker', () => {
    let p = addVectorSticker(createProject('s'), 's1', 0, 'star', RED)
    p = updateOverlay(p, 's1', { color: '#00ff00', outline: '#000000', shape: 'heart', size: 0.2 })
    expect(p.overlays[0]).toMatchObject({ color: '#00ff00', outline: '#000000', shape: 'heart', size: 0.2 })
    expect(updateOverlay(p, 's1', { outline: null }).overlays[0]).toMatchObject({ outline: null })
    expect(updateOverlay(p, 's1', { shape: 'nope' as never })).toBe(p)
    const emoji = { ...createProject('e'), overlays: [{ id: 'e1', kind: 'sticker', start: 0, duration: S, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, emoji: '⭐', size: 0.1 } as OverlayItem] }
    expect(updateOverlay(emoji, 'e1', { color: RED })).toBe(emoji)
    expect(updateOverlay(emoji, 'e1', { shape: 'heart' })).toBe(emoji)
    expect(updateOverlay(emoji, 'e1', { outline: RED })).toBe(emoji)
  })
})

describe('pen opacity and the marker preset', () => {
  const pts = [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }]

  it('a default stroke is fully opaque with round caps (existing data is unchanged)', () => {
    const p = addStroke(createProject('p'), 'k', 0, pts, RED)
    const item = p.overlays[0] as StrokeOverlay
    expect(item.opacity).toBeUndefined()
    expect(item.cap).toBeUndefined()
  })

  it('stores opacity below 1 and a flat cap, clamped to 0..1', () => {
    const p = addStroke(createProject('p'), 'k', 0, pts, RED, 'thick', { opacity: 0.4, cap: 'flat' })
    expect(p.overlays[0]).toMatchObject({ opacity: 0.4, cap: 'flat', lineWidth: 0.016 })
    expect(addStroke(createProject('p'), 'k', 0, pts, RED, 'thick', { opacity: 7 }).overlays[0]).not.toHaveProperty('opacity')
    expect(addStroke(createProject('p'), 'k', 0, pts, RED, 'thick', { opacity: Number.NaN })).toEqual(createProject('p'))
  })

  it('the marker preset is a wide flat stroke at 40 % opacity', () => {
    expect(MARKER_PRESET).toMatchObject({ opacity: 0.4, cap: 'flat', width: 'thick' })
    const p = addStroke(createProject('p'), 'k', 0, pts, MARKER_PRESET.color, MARKER_PRESET.width, { opacity: MARKER_PRESET.opacity, cap: MARKER_PRESET.cap })
    expect(validateProject(p).ok).toBe(true)
  })

  it('opacity and cap are patched only on the items they apply to', () => {
    const p = addStroke(createProject('p'), 'k', 0, pts, RED)
    expect(updateOverlay(p, 'k', { opacity: 0.25, cap: 'flat' }).overlays[0]).toMatchObject({ opacity: 0.25, cap: 'flat' })
    expect(updateOverlay(p, 'k', { cap: 'square' as never })).toBe(p)
    const shape = { ...createProject('x'), overlays: [{ ...p.overlays[0]!, kind: 'shape', shape: 'rect', width: 0.2, height: 0.2 } as unknown as OverlayItem] }
    expect(updateOverlay(shape, 'k', { cap: 'flat' })).toBe(shape)
  })

  it('an invalid cap in a saved file is reported by the schema', () => {
    const p = addStroke(createProject('p'), 'k', 0, pts, RED)
    const broken = { ...p, overlays: [{ ...p.overlays[0], cap: 'square' }] }
    expect(validateProject(broken).ok).toBe(false)
  })
})

describe('regions: shapes and rounded corners', () => {
  it('adds a rectangle by default, and accepts the three shapes with a corner radius', () => {
    const p = addRegion(createProject('r'), 'r1', 0, 'blur')
    expect(p.overlays[0]).toMatchObject({ kind: 'region', shape: 'rect', radius: 0.03 })
    for (const shape of ['rect', 'ellipse', 'roundRect'] as const) {
      const q = addRegion(createProject('r'), 'r1', 0, 'pixelate', { x: 0.5, y: 0.5 }, shape)
      expect((q.overlays[0] as RegionOverlay).shape).toBe(shape)
      expect(validateProject(q).ok).toBe(true)
    }
    expect(addRegion(createProject('r'), 'r1', 0, 'blur', { x: 0.5, y: 0.5 }, 'hexagon' as never)).toEqual(createProject('r'))
  })

  it('patches the shape, the radius and the rotation of a region', () => {
    const p = addRegion(createProject('r'), 'r1', 0, 'blur')
    const next = updateOverlay(p, 'r1', { shape: 'roundRect', radius: 0.08, rotation: 370 })
    expect(next.overlays[0]).toMatchObject({ shape: 'roundRect', radius: 0.08, rotation: 10 })
    expect(updateOverlay(p, 'r1', { radius: -1 }).overlays[0]).toMatchObject({ radius: 0 })
  })
})

describe('pictures: source offset and speed', () => {
  function picture(): Project {
    const p = createProject('m')
    p.assets.push({ id: 'v', kind: 'video', name: 'v.webm', relPath: 'v.webm', size: 1, duration: 10 * S, width: 1920, height: 1080 })
    p.overlays = [{ id: 'm1', kind: 'media', start: 0, duration: S, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, assetId: 'v', width: 0.3, height: 0.2, radius: 0, border: 0, borderColor: '#ffffff' } as MediaOverlay]
    return p
  }

  it('sets srcIn (rounded to whole microseconds, not negative) and speed (clamped 0.1..4)', () => {
    const next = updateOverlay(picture(), 'm1', { srcIn: 2.4 * S, speed: 2 })
    expect(next.overlays[0]).toMatchObject({ srcIn: 2_400_000, speed: 2 })
    expect(updateOverlay(picture(), 'm1', { srcIn: -5 }).overlays[0]).toMatchObject({ srcIn: 0 })
    expect(updateOverlay(picture(), 'm1', { speed: 100 }).overlays[0]).toMatchObject({ speed: 4 })
    expect(updateOverlay(picture(), 'm1', { speed: 0.01 }).overlays[0]).toMatchObject({ speed: 0.1 })
  })

  it('refuses srcIn and speed on other kinds, and a non-finite value', () => {
    const p = picture()
    expect(updateOverlay(p, 'm1', { speed: Number.NaN })).toBe(p)
    const star = addVectorSticker(createProject('s'), 's', 0, 'star', RED)
    expect(updateOverlay(star, 's', { speed: 2 })).toBe(star)
    expect(updateOverlay(star, 's', { srcIn: S })).toBe(star)
  })

  it('a saved file with srcIn and speed validates; a negative speed does not', () => {
    const ok = updateOverlay(picture(), 'm1', { srcIn: S, speed: 1.5 })
    expect(validateProject(ok).ok).toBe(true)
    const bad = { ...ok, overlays: [{ ...ok.overlays[0], speed: -1 }] }
    expect(validateProject(bad).ok).toBe(false)
  })
})
