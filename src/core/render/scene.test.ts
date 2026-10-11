import { describe, expect, it } from 'vitest'
import { buildScene, planTimeline } from './scene'
import { createProject } from '../project/schema'
import type { Clip, OverlayItem, Project, TextItem } from '../project/types'
import { resolveGrade } from '../filters/filters'

const S = 1_000_000

function clip(id: string, assetId: string, srcIn: number, srcOut: number, start: number, extra: Partial<Clip> = {}): Clip {
  return {
    id, track: 'video', assetId, srcIn, srcOut, start, speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1, muted: false, filter: null, transitionIn: null, ...extra
  }
}
function text(id: string, start: number, duration: number, extra: Partial<TextItem> = {}): TextItem {
  return {
    id, start, duration, text: 'Hi', style: { font: 'Sora', size: 64, color: '#fff', outline: null },
    pos: { x: 0.5, y: 0.8 }, animIn: null, animOut: null, ...extra
  }
}
function project(clips: Clip[], texts: TextItem[] = []): Project {
  const p = createProject('t')
  p.assets.push({ id: 'a', kind: 'video', name: 'a.webm', relPath: 'a.webm', size: 1, duration: 20 * S })
  p.clips = clips
  p.texts = texts
  return p
}

describe('planTimeline', () => {
  it('equals the plain timeline when there are no transitions', () => {
    const p = project([clip('c1', 'a', 0, 4 * S, 0), clip('c2', 'a', 4 * S, 8 * S, 4 * S)])
    const t = planTimeline(p)
    expect(t.duration).toBe(8 * S)
    expect(t.clips.map((c) => [c.id, c.start])).toEqual([['c1', 0], ['c2', 4 * S]])
    expect(t.shortenedBy).toBe(0)
  })
  it('is empty for an empty project', () => {
    const t = planTimeline(project([]))
    expect(t.duration).toBe(0)
    expect(t.clips).toEqual([])
  })
  it('uses the transition planner (overlap, same total length when handles exist)', () => {
    const p = project([
      clip('c1', 'a', 2 * S, 6 * S, 0),
      clip('c2', 'a', 8 * S, 12 * S, 4 * S, { transitionIn: { type: 'fade', duration: S } })
    ])
    const t = planTimeline(p)
    expect(t.duration).toBe(8 * S)
    expect(t.transitions).toHaveLength(1)
    expect(t.transitions[0]!.duration).toBe(S)
  })
  it('does not mutate the project', () => {
    const p = project([clip('c1', 'a', 2 * S, 6 * S, 0), clip('c2', 'a', 8 * S, 12 * S, 4 * S, { transitionIn: { type: 'fade', duration: S } })])
    const copy = structuredClone(p)
    planTimeline(p)
    expect(p).toEqual(copy)
  })
})

describe('buildScene: video layers', () => {
  const p = project([clip('c1', 'a', 1 * S, 5 * S, 0), clip('c2', 'a', 10 * S, 14 * S, 4 * S)])
  const planned = planTimeline(p)
  it('shows the clip under the playhead with the matching source time', () => {
    const s = buildScene(p, planned, 2 * S)
    expect(s.videos).toHaveLength(1)
    expect(s.videos[0]).toMatchObject({ clipId: 'c1', assetId: 'a', srcTime: 3 * S, transition: null })
  })
  it('switches at the exact cut', () => {
    expect(buildScene(p, planned, 4 * S - 1).videos[0]!.clipId).toBe('c1')
    expect(buildScene(p, planned, 4 * S).videos[0]!.clipId).toBe('c2')
    expect(buildScene(p, planned, 4 * S).videos[0]!.srcTime).toBe(10 * S)
  })
  it('shows nothing before 0 and at or after the end', () => {
    expect(buildScene(p, planned, -1).videos).toEqual([])
    expect(buildScene(p, planned, 8 * S).videos).toEqual([])
  })
  it('applies speed to the source time', () => {
    const q = project([clip('c1', 'a', 0, 8 * S, 0, { speed: 2 })])
    expect(buildScene(q, planTimeline(q), 3 * S).videos[0]!.srcTime).toBe(6 * S)
  })
  it('carries the clip transform and the project format', () => {
    const q = project([clip('c1', 'a', 0, 4 * S, 0, { transform: { fit: 'fill', scale: 1.5, x: 0.1, y: -0.2, rotation: 90, flipX: true } })])
    const s = buildScene(q, planTimeline(q), S)
    expect(s.videos[0]!.transform).toEqual({ fit: 'fill', scale: 1.5, x: 0.1, y: -0.2, rotation: 90, flipX: true })
    expect(s.format).toEqual(q.format)
    expect(s.time).toBe(S)
  })
})

describe('buildScene: colour grade', () => {
  const NEUTRAL = { brightness: 0, contrast: 0, saturation: 0 }
  it('is null for ungraded, amount 0 and neutral clips', () => {
    const q = project([
      clip('plain', 'a', 0, S, 0),
      clip('zero', 'a', 0, S, S, { filter: 'sepia', filterAmount: 0 }),
      clip('neutral', 'a', 0, S, 2 * S, { adjust: NEUTRAL })
    ])
    const planned = planTimeline(q)
    expect(buildScene(q, planned, 0).videos[0]!.grade).toBeNull()
    expect(buildScene(q, planned, S).videos[0]!.grade).toBeNull()
    expect(buildScene(q, planned, 2 * S).videos[0]!.grade).toBeNull()
  })
  it('carries the resolved grade of the clip', () => {
    const q = project([clip('c1', 'a', 0, 4 * S, 0, { filter: 'blackWhite', filterAmount: 0.5, adjust: { brightness: 0.4, contrast: 0, saturation: 0 } })])
    const grade = buildScene(q, planTimeline(q), S).videos[0]!.grade!
    expect(grade).toEqual(resolveGrade('blackWhite', 0.5, { brightness: 0.4, contrast: 0, saturation: 0 }))
  })
  it('each side of a transition uses its own clip grade', () => {
    const q = project([
      clip('c1', 'a', 2 * S, 6 * S, 0, { filter: 'sepia' }),
      clip('c2', 'a', 8 * S, 12 * S, 4 * S, { transitionIn: { type: 'fade', duration: S }, filter: 'noir' })
    ])
    const planned = planTimeline(q)
    const win = planned.transitions[0]!
    const s = buildScene(q, planned, win.start + win.duration / 2)
    expect(s.videos.map((v) => v.clipId)).toEqual(['c1', 'c2'])
    expect(s.videos[0]!.grade).toEqual(resolveGrade('sepia', 1, undefined))
    expect(s.videos[1]!.grade).toEqual(resolveGrade('noir', 1, undefined))
  })
})

describe('buildScene: transitions', () => {
  const p = project([
    clip('c1', 'a', 2 * S, 6 * S, 0),
    clip('c2', 'a', 8 * S, 12 * S, 4 * S, { transitionIn: { type: 'wipeLeft', duration: S } })
  ])
  const planned = planTimeline(p)
  const win = planned.transitions[0]!
  it('is a single layer outside the overlap window', () => {
    expect(buildScene(p, planned, win.start - 1).videos).toHaveLength(1)
    expect(buildScene(p, planned, win.start + win.duration).videos).toHaveLength(1)
  })
  it('has both layers back to front with progress and roles inside the window', () => {
    const s = buildScene(p, planned, win.start + win.duration / 2)
    expect(s.videos.map((v) => v.clipId)).toEqual(['c1', 'c2'])
    expect(s.videos[0]!.transition).toEqual({ type: 'wipeLeft', progress: 0.5, role: 'from' })
    expect(s.videos[1]!.transition).toEqual({ type: 'wipeLeft', progress: 0.5, role: 'to' })
  })
  it('progress is 0 at the window start and approaches 1 at its end', () => {
    expect(buildScene(p, planned, win.start).videos[1]!.transition!.progress).toBe(0)
    const near = buildScene(p, planned, win.start + win.duration - 1).videos[1]!.transition!.progress
    expect(near).toBeGreaterThan(0.999)
    expect(near).toBeLessThan(1)
  })
  it('maps source time through the extended clips (both clips show their handle material)', () => {
    const s = buildScene(p, planned, win.start)
    const from = planned.clips.find((c) => c.id === 'c1')!
    const to = planned.clips.find((c) => c.id === 'c2')!
    expect(s.videos[0]!.srcTime).toBe(from.srcIn + (win.start - from.start))
    expect(s.videos[1]!.srcTime).toBe(to.srcIn)
  })
})

describe('buildScene: texts', () => {
  const p = project([clip('c1', 'a', 0, 10 * S, 0)], [text('t1', 2 * S, 4 * S, { animIn: 'fade', animOut: 'fade' }), text('t2', 3 * S, 2 * S)])
  const planned = planTimeline(p)
  it('includes only texts that are active', () => {
    expect(buildScene(p, planned, 1 * S).texts).toEqual([])
    expect(buildScene(p, planned, 2 * S + 1).texts.map((t) => t.id)).toEqual(['t1'])
    expect(buildScene(p, planned, 3.5 * S).texts.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(buildScene(p, planned, 6 * S).texts.map((t) => t.id)).toEqual([])
  })
  it('fades in and out with the default animation length', () => {
    const at = (t: number) => buildScene(p, planned, t).texts.find((x) => x.id === 't1')!.alpha
    expect(at(2 * S)).toBeCloseTo(0, 5)
    expect(at(2 * S + 200_000)).toBeCloseTo(0.5, 2)
    expect(at(2 * S + 400_000)).toBeCloseTo(1, 5)
    expect(at(4 * S)).toBe(1)
    expect(at(6 * S - 200_000)).toBeCloseTo(0.5, 2)
  })
  it('without animation the text is fully visible, unscaled and not offset', () => {
    const t2 = buildScene(p, planned, 3.5 * S).texts.find((x) => x.id === 't2')!
    expect(t2).toMatchObject({ alpha: 1, scale: 1, offsetY: 0, pos: { x: 0.5, y: 0.8 } })
  })
  it('pop starts small and overshoots slightly, slideUp moves up into place', () => {
    const q = project([clip('c1', 'a', 0, 10 * S, 0)], [text('p', 0, 4 * S, { animIn: 'pop' }), text('s', 0, 4 * S, { animIn: 'slideUp' as never })])
    const planQ = planTimeline(q)
    const early = buildScene(q, planQ, 1).texts
    expect(early.find((x) => x.id === 'p')!.scale).toBeLessThan(0.5)
    expect(early.find((x) => x.id === 's')!.offsetY).toBeGreaterThan(0)
    const done = buildScene(q, planQ, 500_000).texts
    expect(done.find((x) => x.id === 'p')!.scale).toBe(1)
    expect(done.find((x) => x.id === 's')!.offsetY).toBe(0)
    const mid = Math.max(...[100_000, 200_000, 300_000].map((t) => buildScene(q, planQ, t).texts.find((x) => x.id === 'p')!.scale))
    expect(mid).toBeGreaterThan(1)
  })
  it('shortens animations on very short texts so in and out never overlap', () => {
    const q = project([clip('c1', 'a', 0, 10 * S, 0)], [text('x', S, 200_000, { animIn: 'fade', animOut: 'fade' })])
    const planQ = planTimeline(q)
    const a = buildScene(q, planQ, S + 100_000).texts[0]!.alpha
    expect(a).toBeGreaterThan(0.9)
    expect(a).toBeLessThanOrEqual(1)
  })
  it('keeps text scenes working when there is no video at that time', () => {
    const q = project([], [text('x', 0, S)])
    expect(buildScene(q, planTimeline(q), S / 2).texts).toHaveLength(1)
  })
})

describe('buildScene: overlay stacking', () => {
  const base = { start: 0, duration: 4 * S, scale: 1, rotation: 0, pos: { x: 0.5, y: 0.5 } }
  const sticker = (id: string, extra: Partial<OverlayItem> = {}): OverlayItem =>
    ({ ...base, id, kind: 'sticker', shape: 'heart', color: '#ff0000', size: 0.2, ...extra }) as OverlayItem
  const region = (id: string, extra: Partial<OverlayItem> = {}): OverlayItem =>
    ({ ...base, id, kind: 'region', shape: 'rect', effect: 'pixelate', strength: 0.5, width: 0.3, height: 0.2, ...extra }) as OverlayItem
  const media = (id: string): OverlayItem =>
    ({ ...base, id, kind: 'media', assetId: 'a', width: 0.3, height: 0.2, radius: 0, border: 0, borderColor: '#ffffff' }) as OverlayItem
  const ids = (overlays: OverlayItem[], t = S) => {
    const p = project([clip('c1', 'a', 0, 10 * S, 0)])
    p.overlays = overlays
    return buildScene(p, planTimeline(p), t).overlays.map((l) => l.item.id)
  }

  it('keeps regions and other kinds in one list in project order', () => {
    expect(ids([sticker('s1'), region('r1'), media('m1'), sticker('s2')])).toEqual(['s1', 'r1', 'm1', 's2'])
    expect(ids([region('r1'), sticker('s1')])).toEqual(['r1', 's1'])
  })
  it('keeps the order when items drop out by time', () => {
    const list = [sticker('s1'), region('r1', { start: 2 * S }), media('m1'), sticker('s2', { start: 2 * S })]
    expect(ids(list, S)).toEqual(['s1', 'm1'])
    expect(ids(list, 3 * S)).toEqual(['s1', 'r1', 'm1', 's2'])
  })
  it('does not reorder by kind: swapping the list swaps the scene', () => {
    expect(ids([sticker('s1'), region('r1')])).toEqual(['s1', 'r1'])
    expect(ids([region('r1'), sticker('s1')])).toEqual(['r1', 's1'])
  })
})
