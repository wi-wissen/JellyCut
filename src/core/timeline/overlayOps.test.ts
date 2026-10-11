import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Project } from '../project/types'
import { secondsToMicros } from '../time'
import { DEFAULT_OVERLAY_DURATION, DEFAULT_REGION_STRENGTH, LINE_WIDTHS } from './overlayCatalog'
import {
  MIN_OVERLAY_DURATION,
  addMedia,
  addRegion,
  addShape,
  addSticker,
  addStroke,
  duplicateOverlay,
  moveOverlay,
  moveOverlayToLane,
  overlayRowOf,
  removeLastStroke,
  trimOverlayEnd,
  trimOverlayStart,
  updateOverlay
} from './overlayOps'
import { OVERLAY_ROW_LIMIT } from './overlayRows'
import { deleteItem, duplicateItem, projectIds } from './ops'

const s = (seconds: number) => secondsToMicros(seconds)
const RED = '#ff0000'

function base(): Project {
  return createProject('Overlays')
}

function withSticker(): Project {
  return addSticker(base(), 'overlay-1', s(2), '⭐')
}

describe('addSticker', () => {
  it('adds a centred sticker at the given start with default size and duration', () => {
    const p = withSticker()
    expect(p.overlays).toHaveLength(1)
    const item = p.overlays[0]!
    expect(item).toMatchObject({ kind: 'sticker', id: 'overlay-1', start: s(2), duration: DEFAULT_OVERLAY_DURATION, scale: 1, rotation: 0, emoji: '⭐' })
    expect(item.pos).toEqual({ x: 0.5, y: 0.5 })
    expect(validateProject(p).ok).toBe(true)
  })

  it('rounds the start to whole microseconds, clamps it to 0, and refuses reused ids or empty emoji', () => {
    expect(addSticker(base(), 'o1', -5.4, '⭐').overlays[0]!.start).toBe(0)
    expect(addSticker(base(), 'o1', 1000.6, '⭐').overlays[0]!.start).toBe(1001)
    const p = withSticker()
    expect(addSticker(p, 'overlay-1', 0, '🔥')).toBe(p)
    expect(addSticker(p, 'overlay-2', 0, '')).toBe(p)
    expect(addSticker(p, 'overlay-3', Number.NaN, '🔥')).toBe(p)
  })

  it('shares the id namespace with clips, texts and music', () => {
    const p: Project = {
      ...base(),
      texts: [{ id: 'x', start: 0, duration: s(1), text: 'a', style: { font: 'Sora', size: 10, color: '#ffffff', outline: null }, pos: { x: 0.5, y: 0.5 }, animIn: null, animOut: null }]
    }
    expect(projectIds(p).has('x')).toBe(true)
    expect(addSticker(p, 'x', 0, '⭐')).toBe(p)
  })
})

describe('addShape', () => {
  it('adds a shape with the chosen colour, lower-cased, and the medium line width', () => {
    const p = addShape(base(), 'overlay-1', 0, 'arrow', '#FF00AA')
    expect(p.overlays[0]).toMatchObject({ kind: 'shape', shape: 'arrow', color: '#ff00aa', lineWidth: LINE_WIDTHS.medium })
    expect(validateProject(p).ok).toBe(true)
  })

  it('refuses a colour that is not #RRGGBB', () => {
    const p = base()
    expect(addShape(p, 'o1', 0, 'rect', 'red')).toBe(p)
    expect(addShape(p, 'o1', 0, 'rect', '#fff')).toBe(p)
  })
})

describe('addStroke', () => {
  it('stores points relative to the bounding-box centre, in output-height units', () => {
    // 16:9 format: an x fraction of 0.5 is 0.5 * 16/9 height units.
    const p = addStroke(base(), 'overlay-1', 0, [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }], RED)
    const item = p.overlays[0]!
    expect(item.kind).toBe('stroke')
    if (item.kind !== 'stroke') return
    const aspect = 16 / 9
    expect(item.pos.x).toBeCloseTo(0.5, 5)
    expect(item.pos.y).toBeCloseTo(0.5, 5)
    expect(item.points[0]![0]).toBeCloseTo(-0.25 * aspect, 4)
    expect(item.points[0]![1]).toBeCloseTo(-0.25, 4)
    expect(item.points[1]![0]).toBeCloseTo(0.25 * aspect, 4)
    expect(item.points[1]![1]).toBeCloseTo(0.25, 4)
    expect(item.lineWidth).toBe(LINE_WIDTHS.medium)
  })

  it('drops points that sit on top of the previous kept point, and refuses a stroke with fewer than two points', () => {
    const p = base()
    const same = addStroke(p, 'o1', 0, [{ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }, { x: 0.3001, y: 0.3 }], RED)
    expect(same).toBe(p)
    const line = addStroke(p, 'o1', 0, [{ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: Number.NaN, y: 0 }], RED, 'thick')
    const item = line.overlays[0]!
    expect(item.kind === 'stroke' && item.points).toHaveLength(2)
    expect(item.kind === 'stroke' && item.lineWidth).toBe(LINE_WIDTHS.thick)
    expect(validateProject(line).ok).toBe(true)
  })
})

describe('updateOverlay', () => {
  it('changes position, scale and rotation, normalising the angle', () => {
    const p = updateOverlay(withSticker(), 'overlay-1', { pos: { x: 0.2 }, scale: 2, rotation: -90 })
    const item = p.overlays[0]!
    expect(item.pos).toEqual({ x: 0.2, y: 0.5 })
    expect(item.scale).toBe(2)
    expect(item.rotation).toBe(270)
  })

  it('clamps scale and clamps positions to the picture', () => {
    const p = updateOverlay(withSticker(), 'overlay-1', { scale: 1000, pos: { x: 3, y: -1 } })
    expect(p.overlays[0]!.scale).toBe(10)
    expect(p.overlays[0]!.pos).toEqual({ x: 1, y: 0 })
  })

  it('rejects the whole patch for non-finite values, bad colours, or fields that do not apply to the kind', () => {
    const p = withSticker()
    expect(updateOverlay(p, 'overlay-1', { scale: Number.NaN })).toBe(p)
    expect(updateOverlay(p, 'overlay-1', { color: '#ff0000' })).toBe(p)
    expect(updateOverlay(p, 'overlay-1', { size: 0.2, width: 0.3 })).toBe(p)
    expect(updateOverlay(p, 'missing', { scale: 2 })).toBe(p)
  })

  it('returns the same project when nothing changes', () => {
    const p = withSticker()
    expect(updateOverlay(p, 'overlay-1', { scale: 1, rotation: 0 })).toBe(p)
  })

  it('sets size on stickers and width, height, line width and colour on shapes', () => {
    const sticker = updateOverlay(withSticker(), 'overlay-1', { size: 0.2 })
    expect(sticker.overlays[0]).toMatchObject({ size: 0.2 })
    const shape = addShape(base(), 'o1', 0, 'rect', RED)
    const next = updateOverlay(shape, 'o1', { width: 0.5, height: 0.25, lineWidth: 0.01, color: '#00FF00' })
    expect(next.overlays[0]).toMatchObject({ width: 0.5, height: 0.25, lineWidth: 0.01, color: '#00ff00' })
  })
})

describe('moving and trimming', () => {
  it('moves an overlay in time and keeps its duration', () => {
    const p = moveOverlay(withSticker(), 'overlay-1', s(7.25))
    expect(p.overlays[0]).toMatchObject({ start: s(7.25), duration: DEFAULT_OVERLAY_DURATION })
    expect(moveOverlay(withSticker(), 'overlay-1', -10).overlays[0]!.start).toBe(0)
  })

  it('trims the start with the end fixed, and never below the minimum duration', () => {
    const p = withSticker() // 2 s .. 5 s
    const t = trimOverlayStart(p, 'overlay-1', s(3))
    expect(t.overlays[0]).toMatchObject({ start: s(3), duration: s(2) })
    const tooFar = trimOverlayStart(p, 'overlay-1', s(9))
    expect(tooFar.overlays[0]!.start + tooFar.overlays[0]!.duration).toBe(s(5))
    expect(tooFar.overlays[0]!.duration).toBe(MIN_OVERLAY_DURATION)
  })

  it('trims the end with the start fixed, and never below the minimum duration', () => {
    const p = withSticker()
    expect(trimOverlayEnd(p, 'overlay-1', s(4)).overlays[0]!.duration).toBe(s(2))
    const tiny = trimOverlayEnd(p, 'overlay-1', 0)
    expect(tiny.overlays[0]).toMatchObject({ start: s(2), duration: MIN_OVERLAY_DURATION })
  })
})

describe('duplicate, delete and undo of strokes', () => {
  it('duplicates right after the original, in time and in the list', () => {
    const p = addStroke(withSticker(), 'stroke-1', s(0), [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], RED)
    const d = duplicateOverlay(p, 'stroke-1', 'stroke-2')
    expect(d.overlays.map((o) => o.id)).toEqual(['overlay-1', 'stroke-1', 'stroke-2'])
    expect(d.overlays[2]!.start).toBe(d.overlays[1]!.start + d.overlays[1]!.duration)
    expect(duplicateItem(p, { kind: 'overlay', id: 'overlay-1' }, 'overlay-9').overlays).toHaveLength(3)
  })

  it('deletes overlays through the shared item ops', () => {
    const p = withSticker()
    expect(deleteItem(p, { kind: 'overlay', id: 'overlay-1' }).overlays).toHaveLength(0)
    expect(deleteItem(p, { kind: 'overlay', id: 'nope' })).toBe(p)
  })

  it('removes only the most recent stroke and leaves stickers and shapes alone', () => {
    let p = withSticker()
    p = addStroke(p, 'stroke-1', 0, [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], RED)
    p = addStroke(p, 'stroke-2', 0, [{ x: 0.3, y: 0.1 }, { x: 0.4, y: 0.2 }], RED)
    const once = removeLastStroke(p)
    expect(once.overlays.map((o) => o.id)).toEqual(['overlay-1', 'stroke-1'])
    const twice = removeLastStroke(once)
    expect(twice.overlays.map((o) => o.id)).toEqual(['overlay-1'])
    expect(removeLastStroke(twice)).toBe(twice)
  })
})

describe('opacity and animations (any kind)', () => {
  it('sets opacity clamped to 0..1 and the animations, and clears them with null', () => {
    const p = withSticker()
    const next = updateOverlay(p, 'overlay-1', { opacity: 1.4, animIn: 'pop', animOut: 'fade', loop: 'wiggle' })
    expect(next.overlays[0]).toMatchObject({ opacity: 1, animIn: 'pop', animOut: 'fade', loop: 'wiggle' })
    const cleared = updateOverlay(next, 'overlay-1', { opacity: 0.25, animIn: null, animOut: null, loop: null })
    expect(cleared.overlays[0]).toMatchObject({ opacity: 0.25, animIn: null, animOut: null, loop: null })
  })

  it('rejects unknown animations and non-finite opacity for every kind', () => {
    const p = withSticker()
    expect(updateOverlay(p, 'overlay-1', { animIn: 'spin' as never })).toBe(p)
    expect(updateOverlay(p, 'overlay-1', { loop: 'bounce' as never })).toBe(p)
    expect(updateOverlay(p, 'overlay-1', { opacity: Number.NaN })).toBe(p)
    const stroke = addStroke(base(), 'st', 0, [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], RED)
    expect(updateOverlay(stroke, 'st', { opacity: 0.5 }).overlays[0]).toMatchObject({ opacity: 0.5 })
  })
})

describe('addRegion', () => {
  it('adds a blur or pixelate rectangle centred on the picture, with the default strength and size', () => {
    const p = addRegion(base(), 'r1', s(2), 'blur')
    expect(p.overlays[0]).toMatchObject({ kind: 'region', shape: 'rect', effect: 'blur', start: s(2), duration: DEFAULT_OVERLAY_DURATION, pos: { x: 0.5, y: 0.5 }, strength: DEFAULT_REGION_STRENGTH })
  })

  it('refuses unknown effects and reused ids', () => {
    const p = base()
    expect(addRegion(p, 'r1', 0, 'sparkle' as never)).toBe(p)
    expect(addRegion(addRegion(p, 'r1', 0, 'blur'), 'r1', 0, 'pixelate').overlays).toHaveLength(1)
  })

  it('changes effect, shape and strength (clamped) but not colour or the picture fields', () => {
    const p = addRegion(base(), 'r1', 0, 'blur')
    const next = updateOverlay(p, 'r1', { effect: 'pixelate', shape: 'ellipse', strength: 3, width: 0.5, height: 0.4 })
    expect(next.overlays[0]).toMatchObject({ effect: 'pixelate', shape: 'ellipse', strength: 1, width: 0.5, height: 0.4 })
    expect(updateOverlay(p, 'r1', { color: RED })).toBe(p)
    expect(updateOverlay(p, 'r1', { radius: 0.1 }).overlays[0]).toMatchObject({ radius: 0.1 })
    expect(updateOverlay(p, 'r1', { shape: 'arrow' as never })).toBe(p)
    expect(updateOverlay(p, 'r1', { effect: 'wobble' as never })).toBe(p)
  })
})

describe('addMedia', () => {
  const withAssets = () => {
    const p = base()
    const image = { id: 'img', kind: 'image' as const, name: 'a.png', relPath: 'a.png', size: 1, duration: 0, width: 800, height: 400 }
    const audio = { id: 'snd', kind: 'audio' as const, name: 'a.mp3', relPath: 'a.mp3', size: 1, duration: s(3) }
    return { ...p, assets: [image, audio] }
  }

  it('adds a picture with the asset shape, the default height and no border', () => {
    const p = addMedia(withAssets(), 'm1', s(1), 'img')
    const item = p.overlays[0]
    expect(item).toMatchObject({ kind: 'media', assetId: 'img', start: s(1), height: 0.3, radius: 0, border: 0, borderColor: '#ffffff' })
    if (item?.kind !== 'media') throw new Error('expected a media overlay')
    expect(item.width / item.height).toBeCloseTo(2, 6)
  })

  it('refuses audio assets, unknown assets and reused ids', () => {
    const p = withAssets()
    expect(addMedia(p, 'm1', 0, 'snd')).toBe(p)
    expect(addMedia(p, 'm1', 0, 'missing')).toBe(p)
    expect(addMedia(addMedia(p, 'm1', 0, 'img'), 'm1', 0, 'img').overlays).toHaveLength(1)
  })

  it('sets the box, corner radius, border and border colour', () => {
    const p = addMedia(withAssets(), 'm1', 0, 'img')
    const next = updateOverlay(p, 'm1', { width: 0.6, height: 0.2, radius: 0.9, border: 0.01, borderColor: '#00FF00' })
    expect(next.overlays[0]).toMatchObject({ width: 0.6, height: 0.2, radius: 0.5, border: 0.01, borderColor: '#00ff00' })
    expect(updateOverlay(p, 'm1', { border: Number.NaN })).toBe(p)
    expect(updateOverlay(p, 'm1', { borderColor: 'green' })).toBe(p)
    expect(updateOverlay(p, 'm1', { color: RED })).toBe(p)
    expect(updateOverlay(p, 'm1', { lineWidth: 0.01 })).toBe(p)
  })

  it('stays valid as a project file', () => {
    const p = addMedia(withAssets(), 'm1', s(1), 'img')
    expect(validateProject(JSON.parse(JSON.stringify(p))).ok).toBe(true)
  })
})

describe('overlays and the video end', () => {
  /** A video of the given length: one clip from a 120 s asset. */
  function videoOf(seconds: number): Project {
    return {
      ...base(),
      assets: [{ id: 'a1', kind: 'video', name: 'a.mp4', relPath: 'media/a.mp4', size: 1, duration: s(120), width: 1920, height: 1080, fps: 30 }],
      clips: [
        {
          id: 'clip-1',
          track: 'video',
          assetId: 'a1',
          srcIn: 0,
          srcOut: s(seconds),
          start: 0,
          speed: 1,
          transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
          volume: 1,
          muted: false,
          filter: null,
          transitionIn: null
        }
      ]
    }
  }

  it('a new item at the playhead near the end ends at the end', () => {
    const item = addSticker(videoOf(30), 'overlay-1', s(29.8), '⭐').overlays[0]!
    expect(item).toMatchObject({ start: s(29.5), duration: s(0.5) })
  })

  it('a new item at the end keeps its default length and ends at the end', () => {
    const item = addSticker(videoOf(30), 'overlay-1', s(40), '⭐').overlays[0]!
    expect(item).toMatchObject({ start: s(27), duration: DEFAULT_OVERLAY_DURATION })
  })

  it('without clips a new item keeps the playhead and the default length', () => {
    const item = addSticker(base(), 'overlay-1', s(29.8), '⭐').overlays[0]!
    expect(item).toMatchObject({ start: s(29.8), duration: DEFAULT_OVERLAY_DURATION })
  })

  it('moving past the end stops flush and keeps the length', () => {
    const p = moveOverlay(addSticker(videoOf(30), 'overlay-1', s(1), '⭐'), 'overlay-1', s(40))
    expect(p.overlays[0]).toMatchObject({ start: s(27), duration: DEFAULT_OVERLAY_DURATION })
  })

  it('trimming the end past the end stops at the end', () => {
    const p = trimOverlayEnd(addSticker(videoOf(30), 'overlay-1', s(1), '⭐'), 'overlay-1', s(45))
    expect(p.overlays[0]).toMatchObject({ start: s(1), duration: s(29) })
  })

  it('a duration edit past the end stops at the end', () => {
    const p = updateOverlay(addSticker(videoOf(30), 'overlay-1', s(1), '⭐'), 'overlay-1', { duration: s(40) })
    expect(p.overlays[0]).toMatchObject({ start: s(1), duration: s(29) })
  })

  it('a copy at the end is placed flush with the end', () => {
    const p = duplicateOverlay(addSticker(videoOf(30), 'overlay-1', s(28), '⭐'), 'overlay-1', 'overlay-2')
    expect(p.overlays[1]).toMatchObject({ id: 'overlay-2', start: s(28), duration: s(2) })
  })
})

describe('moveOverlayToLane', () => {
  /** Stickers back to front with the given [id, start s, end s]. */
  function lanes(...specs: [string, number, number][]): Project {
    const template = withSticker().overlays[0]!
    return { ...base(), overlays: specs.map(([id, a, b]) => ({ ...template, id, start: s(a), duration: s(b - a) })) }
  }
  const order = (p: Project) => p.overlays.map((o) => o.id)
  const rows = (p: Project) => p.overlays.map((o) => overlayRowOf(p, o.id))

  it('reads the lane row of an item (front item on top)', () => {
    const p = lanes(['a', 0, 4], ['b', 0, 4], ['c', 0, 4])
    expect(rows(p)).toEqual([2, 1, 0])
    expect(overlayRowOf(p, 'nope')).toBe(-1)
  })

  it('dropped into a higher lane it goes in front of the items there', () => {
    const p = lanes(['a', 0, 4], ['b', 0, 4], ['c', 0, 4])
    expect(order(moveOverlayToLane(p, 'a', 0))).toEqual(['b', 'c', 'a'])
    const middle = moveOverlayToLane(p, 'a', 1)
    expect(order(middle)).toEqual(['b', 'a', 'c'])
    expect(overlayRowOf(middle, 'a')).toBe(1)
  })

  it('dropped into a lower lane it goes behind the items there', () => {
    const p = lanes(['a', 0, 4], ['b', 0, 4], ['c', 0, 4])
    expect(order(moveOverlayToLane(p, 'c', 2))).toEqual(['c', 'a', 'b'])
    const middle = moveOverlayToLane(p, 'c', 1)
    expect(order(middle)).toEqual(['a', 'c', 'b'])
    expect(overlayRowOf(middle, 'c')).toBe(1)
  })

  it('the same lane changes nothing and returns the same project', () => {
    const p = lanes(['a', 0, 4], ['b', 0, 4])
    expect(moveOverlayToLane(p, 'a', 1)).toBe(p)
    expect(moveOverlayToLane(p, 'b', 0)).toBe(p)
  })

  it('only items that overlap it in time matter', () => {
    // 'late' does not overlap 'a'; x and y are the stack in the first seconds.
    const p = lanes(['x', 0, 2], ['late', 5, 8], ['y', 0, 2])
    expect(rows(p)).toEqual([1, 0, 0])
    expect(order(moveOverlayToLane(p, 'x', 0))).toEqual(['late', 'y', 'x'])
    // 'late' is alone in its time: there is no other lane to go to
    expect(moveOverlayToLane(p, 'late', 1)).toBe(p)
    expect(moveOverlayToLane(p, 'late', 0)).toBe(p)
  })

  it('with several overlapping items it passes all of them in the target lane and below', () => {
    // a (back) is overlapped by b, c, d; c and d do not overlap each other and share a lane above b.
    const p = lanes(['a', 0, 10], ['b', 0, 10], ['c', 0, 4], ['d', 5, 9])
    expect(rows(p)).toEqual([2, 1, 0, 0])
    const up = moveOverlayToLane(p, 'a', 0)
    expect(order(up)).toEqual(['b', 'c', 'd', 'a'])
    expect(overlayRowOf(up, 'a')).toBe(0)
    // Down onto b's lane: behind b (and a), so it ends one lane below b.
    const down = moveOverlayToLane(p, 'd', 1)
    expect(order(down)).toEqual(['a', 'd', 'b', 'c'])
    expect(overlayRowOf(down, 'd')).toBe(2)
  })

  it('a lane past the last one opens a new lane at the bottom', () => {
    const p = lanes(['a', 0, 4], ['b', 0, 4])
    expect(order(moveOverlayToLane(p, 'b', 2))).toEqual(['b', 'a'])
  })

  it('respects the row limit and the shared stack row', () => {
    const specs: [string, number, number][] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, 0, 4])
    const p = lanes(...specs)
    expect(Math.max(...rows(p))).toBe(OVERLAY_ROW_LIMIT - 1)
    // Rows beyond the limit are clamped: the front item sent to "row 9" goes behind everything it overlaps.
    expect(order(moveOverlayToLane(p, 'f', 9))).toEqual(['f', 'a', 'b', 'c', 'd', 'e'])
    // From the stack row to the top.
    expect(order(moveOverlayToLane(p, 'a', 0))).toEqual(['b', 'c', 'd', 'e', 'f', 'a'])
  })

  it('leaves times, other fields and unknown ids alone, and stays valid', () => {
    const p = lanes(['a', 0, 4], ['b', 1, 3])
    const next = moveOverlayToLane(p, 'a', 0)
    expect(next.overlays.find((o) => o.id === 'a')).toBe(p.overlays[0])
    expect(moveOverlayToLane(p, 'zzz', 0)).toBe(p)
    expect(moveOverlayToLane(p, 'a', Number.NaN)).toBe(p)
    expect(validateProject(next).ok).toBe(true)
  })
})
