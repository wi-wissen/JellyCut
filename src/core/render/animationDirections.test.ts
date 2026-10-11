import { describe, expect, it } from 'vitest'
import { canonicalAnimation, IN_ANIMATIONS, OUT_ANIMATIONS, parseAnimation } from './animations'
import { buildScene, planTimeline } from './scene'
import { createProject } from '../project/schema'
import type { MediaOverlay, OverlayItem, Project, TextItem } from '../project/types'

const S = 1_000_000
const ENTER = 400_000
const SLIDE = 0.06

const base = { id: 'o', start: 0, duration: 4 * S, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 }
const sticker = (extra: Partial<OverlayItem> = {}): OverlayItem =>
  ({ ...base, kind: 'sticker', shape: 'star', color: '#ffcc00', outline: null, size: 0.1, ...extra }) as OverlayItem

function overlayScene(item: OverlayItem, t: number) {
  // 16:9 format, so horizontal offsets are the height offset divided by 16/9.
  const p: Project = { ...createProject('d'), overlays: [item] }
  return buildScene(p, planTimeline(p), t).overlays[0]!
}

function textScene(item: Partial<TextItem>, t: number) {
  const text: TextItem = {
    id: 't', start: 0, duration: 4 * S, text: 'Hi', style: { font: 'Sora', size: 64, color: '#fff', outline: null },
    pos: { x: 0.5, y: 0.5 }, animIn: null, animOut: null, ...item
  }
  const p: Project = { ...createProject('d'), texts: [text] }
  return buildScene(p, planTimeline(p), t).texts[0]!
}

const ASPECT = 16 / 9

describe('animation names', () => {
  it('every in and out name parses to its kind and side', () => {
    expect(parseAnimation('fade')).toEqual({ kind: 'fade' })
    expect(parseAnimation('pop')).toEqual({ kind: 'pop' })
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      expect(parseAnimation(`slideFrom${side}`)).toEqual({ kind: 'slide', side: side.toLowerCase() })
      expect(parseAnimation(`slideTo${side}`)).toEqual({ kind: 'slide', side: side.toLowerCase() })
    }
    expect(parseAnimation('slideUp')).toBeNull()
    expect(parseAnimation('spin')).toBeNull()
  })

  it('lists 6 entrances and 6 exits, each with fade and pop plus one slide per side', () => {
    expect(IN_ANIMATIONS).toHaveLength(6)
    expect(OUT_ANIMATIONS).toHaveLength(6)
    expect(IN_ANIMATIONS).toContain('slideFromLeft')
    expect(OUT_ANIMATIONS).toContain('slideToRight')
  })

  it('maps the legacy slideUp to the bottom side: in from bottom, out to bottom', () => {
    expect(canonicalAnimation('slideUp', 'in')).toBe('slideFromBottom')
    expect(canonicalAnimation('slideUp', 'out')).toBe('slideToBottom')
    expect(canonicalAnimation('fade', 'in')).toBe('fade')
    expect(canonicalAnimation('slideToTop', 'in')).toBeNull()
    expect(canonicalAnimation('spin', 'out')).toBeNull()
    expect(canonicalAnimation(null, 'in')).toBeNull()
  })
})

describe('overlay slide directions (entrance)', () => {
  // Start of the item: the slide is a full distance away on its side; at the end of the entrance it is in place.
  const cases: [string, number, number][] = [
    ['slideFromTop', 0, -SLIDE],
    ['slideFromBottom', 0, SLIDE],
    ['slideFromLeft', -SLIDE / ASPECT, 0],
    ['slideFromRight', SLIDE / ASPECT, 0]
  ]
  for (const [name, dx, dy] of cases) {
    it(`${name} starts ${dx === 0 ? (dy < 0 ? 'above' : 'below') : dx < 0 ? 'left of' : 'right of'} its place and arrives exactly`, () => {
      const start = overlayScene(sticker({ animIn: name as never }), 0)
      expect(start.x).toBeCloseTo(0.5 + dx, 10)
      expect(start.y).toBeCloseTo(0.5 + dy, 10)
      expect(start.alpha).toBe(0)
      const done = overlayScene(sticker({ animIn: name as never }), ENTER)
      expect(done.x).toBe(0.5)
      expect(done.y).toBe(0.5)
      expect(done.alpha).toBe(1)
    })
  }

  it('moves monotonically towards the place during the entrance', () => {
    const ys = [0, 100_000, 200_000, 300_000].map((t) => overlayScene(sticker({ animIn: 'slideFromTop' }), t).y)
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!)
  })
})

describe('overlay slide directions (exit)', () => {
  const end = 4 * S
  // Just before the end of the item the slide is a full distance away (the exit runs backwards).
  const cases: [string, number, number][] = [
    ['slideToTop', 0, -SLIDE],
    ['slideToBottom', 0, SLIDE],
    ['slideToLeft', -SLIDE / ASPECT, 0],
    ['slideToRight', SLIDE / ASPECT, 0]
  ]
  for (const [name, dx, dy] of cases) {
    it(`${name} leaves towards its side`, () => {
      const gone = overlayScene(sticker({ animOut: name as never }), end - 1)
      expect(gone.x).toBeCloseTo(0.5 + dx, 4)
      expect(gone.y).toBeCloseTo(0.5 + dy, 4)
      expect(gone.alpha).toBeLessThan(0.01)
      const still = overlayScene(sticker({ animOut: name as never }), end - 2 * ENTER)
      expect(still.x).toBe(0.5)
      expect(still.y).toBe(0.5)
    })
  }

  it('a slide in from top and a slide out to top move on the same side', () => {
    const inside = overlayScene(sticker({ animIn: 'slideFromTop' }), 0)
    const outside = overlayScene(sticker({ animOut: 'slideToTop' }), end - 1)
    expect(Math.sign(inside.y - 0.5)).toBe(Math.sign(outside.y - 0.5))
  })
})

describe('legacy slideUp in overlays and texts', () => {
  it('plays as in from bottom and out to bottom', () => {
    const legacyIn = overlayScene(sticker({ animIn: 'slideUp' as never }), 0)
    const newIn = overlayScene(sticker({ animIn: 'slideFromBottom' }), 0)
    expect({ x: legacyIn.x, y: legacyIn.y, alpha: legacyIn.alpha }).toEqual({ x: newIn.x, y: newIn.y, alpha: newIn.alpha })
    expect(legacyIn.y).toBeGreaterThan(0.5)
    const legacyOut = overlayScene(sticker({ animOut: 'slideUp' as never }), 4 * S - 1)
    const newOut = overlayScene(sticker({ animOut: 'slideToBottom' }), 4 * S - 1)
    expect({ x: legacyOut.x, y: legacyOut.y, alpha: legacyOut.alpha }).toEqual({ x: newOut.x, y: newOut.y, alpha: newOut.alpha })
    expect(legacyOut.y).toBeGreaterThan(0.5)
  })

  it('texts use the same directions', () => {
    expect(textScene({ animIn: 'slideFromLeft' }, 0).offsetX).toBeCloseTo(-SLIDE, 10)
    expect(textScene({ animIn: 'slideFromRight' }, 0).offsetX).toBeCloseTo(SLIDE, 10)
    expect(textScene({ animIn: 'slideFromTop' }, 0).offsetY).toBeCloseTo(-SLIDE, 10)
    expect(textScene({ animOut: 'slideToLeft' }, 4 * S - 1).offsetX).toBeCloseTo(-SLIDE, 4)
    expect(textScene({ animOut: 'slideToBottom' }, 4 * S - 1).offsetY).toBeCloseTo(SLIDE, 4)
    expect(textScene({ animIn: 'slideFromTop' }, ENTER).offsetY).toBe(0)
    expect(textScene({ animIn: 'slideUp' as never }, 0).offsetY).toBeCloseTo(SLIDE, 10)
  })
})

describe('picture timing (srcIn and speed)', () => {
  const media = (extra: Partial<MediaOverlay> = {}): MediaOverlay =>
    ({ ...base, id: 'm', kind: 'media', start: S, duration: 3 * S, assetId: 'v', width: 0.3, height: 0.2, radius: 0, border: 0, borderColor: '#ffffff', ...extra }) as MediaOverlay
  const project = (item: MediaOverlay): Project => {
    const p = createProject('m')
    p.assets.push({ id: 'v', kind: 'video', name: 'v.webm', relPath: 'v.webm', size: 1, duration: 10 * S, width: 1920, height: 1080 })
    p.overlays = [item]
    return p
  }
  const srcAt = (item: MediaOverlay, t: number) => {
    const p = project(item)
    return buildScene(p, planTimeline(p), t).overlays[0]!.srcTime
  }

  it('without srcIn and speed it plays from the first frame at speed 1 (as before)', () => {
    expect(srcAt(media(), S)).toBe(0)
    expect(srcAt(media(), 2 * S)).toBe(S)
  })

  it('srcIn starts the picture at that point of the asset', () => {
    expect(srcAt(media({ srcIn: 4 * S }), S)).toBe(4 * S)
    expect(srcAt(media({ srcIn: 4 * S }), 2 * S + 500_000)).toBe(5_500_000)
  })

  it('speed scales the elapsed time, in whole microseconds', () => {
    expect(srcAt(media({ speed: 2 }), 2 * S)).toBe(2 * S)
    expect(srcAt(media({ srcIn: S, speed: 0.5 }), 3 * S)).toBe(S + S)
    expect(Number.isInteger(srcAt(media({ speed: 1.3 }), 2 * S + 1))).toBe(true)
  })

  it('holds the last frame of the asset when the picture runs past its end', () => {
    expect(srcAt(media({ srcIn: 9 * S, speed: 4 }), 2 * S)).toBe(10 * S - 1)
  })

  it('ignores a non-positive speed', () => {
    expect(srcAt(media({ speed: 0 }), 2 * S)).toBe(S)
  })
})
