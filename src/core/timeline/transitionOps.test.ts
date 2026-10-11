import { describe, expect, it } from 'vitest'
import { validateProject } from '../project/schema'
import type { Clip, Project } from '../project/types'
import { TRANSITION_TYPES } from '../render/types'
import { secondsToMicros } from '../time'
import { canHaveTransition, setTransition, transitionTargetClipId } from './transitionOps'

const s = (seconds: number) => secondsToMicros(seconds)

/** c1 0-8 s (8 s long), c2 8-10 s (2 s), c3 10-30 s (20 s). Clip order in the array is shuffled on purpose. */
function fixture(): Project {
  const clip = (id: string, assetId: string, start: number, length: number): Clip => ({
    id,
    track: 'video',
    assetId,
    srcIn: 0,
    srcOut: s(length),
    start: s(start),
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null
  })
  return {
    version: 1,
    name: 'T',
    format: { ratio: '16:9', width: 1920, height: 1080, fps: 30, background: { type: 'blur' } },
    assets: [
      { id: 'a1', kind: 'video', name: 'one.mp4', relPath: 'media/one.mp4', size: 1, duration: s(30), width: 1920, height: 1080, fps: 30 }
    ],
    clips: [clip('c3', 'a1', 10, 20), clip('c1', 'a1', 0, 8), clip('c2', 'a1', 8, 2)],
    texts: [],
    overlays: [],
    stickers: [],
    drawings: [],
    music: []
  }
}

const clipOf = (p: Project, id: string) => p.clips.find((c) => c.id === id)!

describe('setTransition', () => {
  it('sets the transition on a clip after the first one and keeps the project valid', () => {
    const p = fixture()
    const next = setTransition(p, 'c2', { type: 'wipeLeft', duration: s(0.5) })
    expect(clipOf(next, 'c2').transitionIn).toEqual({ type: 'wipeLeft', duration: s(0.5) })
    expect(validateProject(next).ok).toBe(true)
  })

  it('does not change the input project', () => {
    const p = fixture()
    const before = JSON.stringify(p)
    setTransition(p, 'c2', { type: 'fade', duration: s(0.5) })
    expect(JSON.stringify(p)).toBe(before)
  })

  it('leaves the first clip (by start order) unchanged', () => {
    const p = fixture()
    expect(setTransition(p, 'c1', { type: 'fade', duration: s(0.5) })).toBe(p)
  })

  it('refuses an unknown clip id or an unknown transition type', () => {
    const p = fixture()
    expect(setTransition(p, 'nope', { type: 'fade', duration: s(0.5) })).toBe(p)
    expect(setTransition(p, 'c2', { type: 'spin' as never, duration: s(0.5) })).toBe(p)
  })

  it('clamps the duration to 0.1..2 s', () => {
    const p = fixture()
    expect(clipOf(setTransition(p, 'c3', { type: 'fade', duration: 5_000 }), 'c3').transitionIn?.duration).toBe(100_000)
    expect(clipOf(setTransition(p, 'c3', { type: 'fade', duration: s(9) }), 'c3').transitionIn?.duration).toBe(s(2))
  })

  it('clamps to the shorter neighbour clip (the 2 s clip c2 limits the cut before c3 and the cut before c2 to the 8 s clip)', () => {
    const p = fixture()
    expect(clipOf(setTransition(p, 'c2', { type: 'fade', duration: s(2) }), 'c2').transitionIn?.duration).toBe(s(2))
    // c3 (20 s) follows c2 (2 s): the cap is 2 s even though the request is 1.9 s, which is allowed.
    expect(clipOf(setTransition(p, 'c3', { type: 'fade', duration: s(1.9) }), 'c3').transitionIn?.duration).toBe(s(1.9))
    // A 1.5 s request on c2 is capped by min(8 s, 2 s) = 2 s, so it is kept.
    expect(clipOf(setTransition(p, 'c2', { type: 'fade', duration: s(1.5) }), 'c2').transitionIn?.duration).toBe(s(1.5))
  })

  it('caps the duration at the previous clip length when that is shorter than 2 s', () => {
    const p = fixture()
    // Make the previous clip (c2) only 0.3 s long by trimming its source.
    const short: Project = {
      ...p,
      clips: p.clips.map((c) => (c.id === 'c2' ? { ...c, srcOut: s(0.3) } : c))
    }
    expect(clipOf(setTransition(short, 'c3', { type: 'fade', duration: s(1) }), 'c3').transitionIn?.duration).toBe(s(0.3))
  })

  it('removes a transition with null and returns the same project when nothing changes', () => {
    const p = setTransition(fixture(), 'c2', { type: 'blur', duration: s(0.5) })
    const removed = setTransition(p, 'c2', null)
    expect(clipOf(removed, 'c2').transitionIn).toBeNull()
    expect(setTransition(removed, 'c2', null)).toBe(removed)
    expect(setTransition(p, 'c2', { type: 'blur', duration: s(0.5) })).toBe(p)
  })

  it('accepts every transition type the renderer knows', () => {
    for (const type of TRANSITION_TYPES) {
      const next = setTransition(fixture(), 'c2', { type, duration: s(0.5) })
      expect(clipOf(next, 'c2').transitionIn?.type).toBe(type)
      expect(validateProject(next).ok).toBe(true)
    }
  })

  it('rejects a non-finite duration', () => {
    const p = fixture()
    expect(setTransition(p, 'c2', { type: 'fade', duration: Number.NaN })).toBe(p)
  })
})

describe('canHaveTransition', () => {
  it('is false for the first clip only', () => {
    const p = fixture()
    expect(canHaveTransition(p, 'c1')).toBe(false)
    expect(canHaveTransition(p, 'c2')).toBe(true)
    expect(canHaveTransition(p, 'c3')).toBe(true)
    expect(canHaveTransition(p, 'missing')).toBe(false)
  })
})

describe('transitionTargetClipId', () => {
  it('uses the selected clip when it is after the first one', () => {
    expect(transitionTargetClipId(fixture(), { kind: 'clip', id: 'c3' }, 0)).toBe('c3')
  })

  it('falls back to the nearest non-first clip to the playhead when the selection is the first clip', () => {
    const p = fixture()
    expect(transitionTargetClipId(p, { kind: 'clip', id: 'c1' }, s(1))).toBe('c2')
    expect(transitionTargetClipId(p, { kind: 'clip', id: 'c1' }, s(25))).toBe('c3')
  })

  it('falls back when the selection is a text or music item', () => {
    const p = fixture()
    expect(transitionTargetClipId(p, { kind: 'text', id: 't' }, s(8.4))).toBe('c2')
    expect(transitionTargetClipId(p, { kind: 'text', id: 't' }, s(9.4))).toBe('c3')
    expect(transitionTargetClipId(p, null, s(29))).toBe('c3')
  })

  it('picks the earlier clip on a tie', () => {
    // At 9 s both c2 (starts 8 s) and c3 (starts 10 s) are 1 s away; the earlier one wins.
    const p = fixture()
    expect(transitionTargetClipId(p, null, s(9))).toBe('c2')
  })

  it('returns null when there is no clip after the first one', () => {
    const p = fixture()
    const single: Project = { ...p, clips: [p.clips[1]!] }
    expect(transitionTargetClipId(single, null, 0)).toBeNull()
    expect(transitionTargetClipId({ ...p, clips: [] }, { kind: 'clip', id: 'c1' }, 0)).toBeNull()
  })
})
