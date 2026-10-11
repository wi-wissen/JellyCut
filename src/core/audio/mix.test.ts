import { describe, expect, it } from 'vitest'
import { CUT_FADE, gainAt, planAudioSegments } from './mix'
import { planTimeline } from '../render/scene'
import { createProject } from '../project/schema'
import type { Asset, Clip, MusicItem, Project } from '../project/types'

const S = 1_000_000
const asset = (id: string, kind: Asset['kind'], extra: Partial<Asset> = {}): Asset => ({
  id, kind, name: id, relPath: id, size: 1, duration: 30 * S, ...extra
})
const clip = (id: string, assetId: string, srcIn: number, srcOut: number, start: number, extra: Partial<Clip> = {}): Clip => ({
  id, track: 'video', assetId, srcIn, srcOut, start, speed: 1,
  transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
  volume: 1, muted: false, filter: null, transitionIn: null, ...extra
})
const music = (id: string, assetId: string, start: number, srcIn: number, srcOut: number, extra: Partial<MusicItem> = {}): MusicItem => ({
  id, assetId, start, srcIn, srcOut, volume: 0.5, fadeIn: 0, fadeOut: 0, ...extra
})
function project(assets: Asset[], clips: Clip[], musics: MusicItem[] = []): Project {
  const p = createProject('t')
  p.assets = assets
  p.clips = clips
  p.music = musics
  return p
}
const plan = (p: Project) => planAudioSegments(p, planTimeline(p))

describe('planAudioSegments: clips', () => {
  const p = project([asset('v', 'video')], [clip('c1', 'v', 2 * S, 6 * S, 0), clip('c2', 'v', 10 * S, 12 * S, 4 * S)])
  it('creates one segment per clip with the right source range and timeline position', () => {
    const segs = plan(p)
    expect(segs.map((s) => [s.sourceId, s.assetId, s.srcStart, s.srcEnd, s.timelineStart, s.timelineEnd, s.speed])).toEqual([
      ['c1', 'v', 2 * S, 6 * S, 0, 4 * S, 1],
      ['c2', 'v', 10 * S, 12 * S, 4 * S, 6 * S, 1]
    ])
    expect(segs.every((s) => s.kind === 'clip')).toBe(true)
  })
  it('applies a short fade at both ends of every clip (no clicks at cuts)', () => {
    const [a] = plan(p)
    expect(CUT_FADE).toBe(15_000)
    expect(gainAt(a!.envelope, 0)).toBe(0)
    expect(gainAt(a!.envelope, CUT_FADE)).toBe(1)
    expect(gainAt(a!.envelope, 2 * S)).toBe(1)
    expect(gainAt(a!.envelope, 4 * S - CUT_FADE)).toBe(1)
    expect(gainAt(a!.envelope, 4 * S)).toBe(0)
  })
  it('uses the clip volume', () => {
    const q = project([asset('v', 'video')], [clip('c1', 'v', 0, 4 * S, 0, { volume: 0.5 })])
    expect(gainAt(plan(q)[0]!.envelope, 2 * S)).toBe(0.5)
  })
  it('skips muted clips, silent clips, images, assets without audio and unknown assets', () => {
    const q = project(
      [asset('v', 'video'), asset('img', 'image'), asset('noaudio', 'video', { hasAudio: false })],
      [
        clip('m', 'v', 0, S, 0, { muted: true }),
        clip('z', 'v', S, 2 * S, S, { volume: 0 }),
        clip('i', 'img', 0, 5 * S, 2 * S),
        clip('n', 'noaudio', 0, S, 7 * S),
        clip('u', 'ghost', 0, S, 8 * S),
        clip('ok', 'v', 0, S, 9 * S)
      ]
    )
    expect(plan(q).map((s) => s.sourceId)).toEqual(['ok'])
  })
  it('gives a freeze frame no sound, even when the clip is not muted', () => {
    const frozen = project([asset('v', 'video')], [clip('c1', 'v', 0, 2 * S, 0, { still: 5 * S })])
    expect(plan(frozen)).toEqual([])
  })

  it('keeps the clip speed (audio is resampled by the mixer)', () => {
    const q = project([asset('v', 'video')], [clip('c1', 'v', 0, 8 * S, 0, { speed: 2 })])
    const [s] = plan(q)
    expect(s).toMatchObject({ srcStart: 0, srcEnd: 8 * S, timelineStart: 0, timelineEnd: 4 * S, speed: 2 })
  })
  it('shortens the end fades on clips shorter than two fades', () => {
    const q = project([asset('v', 'video')], [clip('c1', 'v', 0, 20_000, 0)])
    const env = plan(q)[0]!.envelope
    for (let t = 0; t <= 20_000; t += 1_000) {
      const g = gainAt(env, t)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
    }
    expect(gainAt(env, 10_000)).toBeGreaterThan(0.9)
  })
})

describe('planAudioSegments: transitions', () => {
  const p = project(
    [asset('v', 'video')],
    [clip('c1', 'v', 2 * S, 6 * S, 0), clip('c2', 'v', 10 * S, 14 * S, 4 * S, { transitionIn: { type: 'fade', duration: S } })]
  )
  const planned = planTimeline(p)
  const win = planned.transitions[0]!
  const segs = planAudioSegments(p, planned)
  const a = segs.find((s) => s.sourceId === 'c1')!
  const b = segs.find((s) => s.sourceId === 'c2')!
  it('crossfades over the whole overlap: outgoing fades out, incoming fades in', () => {
    expect(gainAt(a.envelope, win.start)).toBe(1)
    expect(gainAt(a.envelope, win.start + win.duration / 2)).toBeCloseTo(0.5, 5)
    expect(gainAt(a.envelope, win.start + win.duration)).toBeCloseTo(0, 5)
    expect(gainAt(b.envelope, win.start)).toBeCloseTo(0, 5)
    expect(gainAt(b.envelope, win.start + win.duration / 2)).toBeCloseTo(0.5, 5)
    expect(gainAt(b.envelope, win.start + win.duration)).toBe(1)
  })
  it('the two segments overlap exactly as long as the transition', () => {
    expect(a.timelineEnd - b.timelineStart).toBe(win.duration)
  })
})

describe('planAudioSegments: music', () => {
  it('creates music segments with volume and fades', () => {
    const q = project([asset('m', 'audio')], [], [music('m1', 'm', 2 * S, S, 9 * S, { fadeIn: 2 * S, fadeOut: 2 * S, volume: 0.6 })])
    const [s] = plan(q)
    expect(s).toMatchObject({ kind: 'music', sourceId: 'm1', assetId: 'm', srcStart: S, srcEnd: 9 * S, timelineStart: 2 * S, timelineEnd: 10 * S, speed: 1 })
    expect(gainAt(s!.envelope, 2 * S)).toBe(0)
    expect(gainAt(s!.envelope, 3 * S)).toBeCloseTo(0.3, 6)
    expect(gainAt(s!.envelope, 4 * S)).toBeCloseTo(0.6, 6)
    expect(gainAt(s!.envelope, 8 * S)).toBeCloseTo(0.6, 6)
    expect(gainAt(s!.envelope, 9 * S)).toBeCloseTo(0.3, 6)
    expect(gainAt(s!.envelope, 10 * S)).toBeCloseTo(0, 6)
  })
  it('uses the short click-protection ramp when no fade is set', () => {
    const q = project([asset('m', 'audio')], [], [music('m1', 'm', 0, 0, 5 * S)])
    const env = plan(q)[0]!.envelope
    expect(gainAt(env, 0)).toBe(0)
    expect(gainAt(env, CUT_FADE)).toBeCloseTo(0.5, 6)
  })
  it('skips unknown assets and zero volume', () => {
    const q = project([asset('m', 'audio')], [], [music('a', 'ghost', 0, 0, S), music('b', 'm', 0, 0, S, { volume: 0 })])
    expect(plan(q)).toEqual([])
  })
  it('orders all segments by timeline start, then id', () => {
    const q = project(
      [asset('v', 'video'), asset('m', 'audio')],
      [clip('c1', 'v', 0, 4 * S, 3 * S)],
      [music('m2', 'm', S, 0, 2 * S), music('m1', 'm', S, 0, 2 * S), music('m0', 'm', 2 * S, 0, S)]
    )
    // The first video clip is always rippled to 0, so it starts first; m1 and m2 tie and are ordered by id.
    expect(plan(q).map((s) => s.sourceId)).toEqual(['c1', 'm1', 'm2', 'm0'])
  })
})

describe('gainAt', () => {
  const env = [{ t: 0, gain: 0 }, { t: 10, gain: 1 }, { t: 20, gain: 0.5 }]
  it('interpolates linearly between points and holds the ends', () => {
    expect(gainAt(env, -5)).toBe(0)
    expect(gainAt(env, 5)).toBe(0.5)
    expect(gainAt(env, 15)).toBeCloseTo(0.75, 9)
    expect(gainAt(env, 99)).toBe(0.5)
  })
  it('handles empty and single-point envelopes', () => {
    expect(gainAt([], 5)).toBe(0)
    expect(gainAt([{ t: 3, gain: 0.7 }], 100)).toBe(0.7)
  })
  it('handles two points at the same time (a step)', () => {
    expect(gainAt([{ t: 5, gain: 0 }, { t: 5, gain: 1 }], 5)).toBe(1)
  })
})
