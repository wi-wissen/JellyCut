import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import { validateProject } from '../project/schema'
import type { Clip, Project } from '../project/types'
import { frameDuration, secondsToMicros } from '../time'
import { clipEnd } from './edit'
import {
  deleteItem,
  duplicateItem,
  moveText,
  projectIds,
  reorderVideoClip,
  setClipProps,
  splitAt,
  trimTextEnd,
  trimTextStart,
  trimVideoEnd,
  trimVideoStart
} from './ops'

const s = (seconds: number) => secondsToMicros(seconds)

/**
 * Three clips back to back: c1 0-8 s (a1 0-8), c2 8-20 s (a2 2-14), c3 20-30 s (a1 0-10),
 * one text 2-6 s and one music bed 0-30 s. Total duration 30 s.
 */
function fixture(): Project {
  const project = createProject('Fixture')
  project.assets = [
    { id: 'a1', kind: 'video', name: 'one.mp4', relPath: 'media/one.mp4', size: 1, duration: s(10), width: 1920, height: 1080, fps: 30 },
    { id: 'a2', kind: 'video', name: 'two.mp4', relPath: 'media/two.mp4', size: 1, duration: s(20), width: 1920, height: 1080, fps: 30 },
    { id: 'm1', kind: 'audio', name: 'bed.mp3', relPath: 'media/bed.mp3', size: 1, duration: s(30) }
  ]
  project.clips = [
    clip('c1', 'a1', 0, 8, 0),
    clip('c2', 'a2', 2, 14, 8),
    clip('c3', 'a1', 0, 10, 20)
  ]
  project.texts = [
    {
      id: 't1',
      start: s(2),
      duration: s(4),
      text: 'Hello',
      style: { font: 'Sora', size: 26, color: '#ffffff', outline: null },
      pos: { x: 0.5, y: 0.85 },
      animIn: null,
      animOut: null
    }
  ]
  project.music = [
    { id: 'mu1', assetId: 'm1', start: 0, srcIn: 0, srcOut: s(30), volume: 0.6, fadeIn: 0, fadeOut: s(1) }
  ]
  return project
}

function clip(id: string, assetId: string, srcInSec: number, srcOutSec: number, startSec: number): Clip {
  return {
    id,
    track: 'video',
    assetId,
    srcIn: s(srcInSec),
    srcOut: s(srcOutSec),
    start: s(startSec),
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null
  }
}

/** Every result must still be a valid project. */
function expectValid(project: Project): void {
  const result = validateProject(project)
  expect(result.ok, result.ok ? '' : result.errors.join('; ')).toBe(true)
}

function trackEnd(project: Project): number {
  return Math.max(...project.clips.map(clipEnd))
}

function starts(project: Project): number[] {
  return project.clips.map((c) => c.start)
}

/** Deep snapshot to prove an operation did not mutate its input. */
function snapshot(project: Project): string {
  return JSON.stringify(project)
}

describe('projectIds', () => {
  it('collects asset, clip, text and music ids', () => {
    expect([...projectIds(fixture())].sort()).toEqual(['a1', 'a2', 'c1', 'c2', 'c3', 'm1', 'mu1', 't1'])
  })
})

describe('splitAt', () => {
  it('splits the clip under the time, keeping the total length', () => {
    const project = fixture()
    const next = splitAt(project, s(4), 'c4')
    expect(next).not.toBe(project)
    expect(next.clips.map((c) => c.id)).toEqual(['c1', 'c4', 'c2', 'c3'])
    const [left, right] = next.clips
    expect(left?.srcOut).toBe(s(4))
    expect(right?.start).toBe(s(4))
    expect(right?.srcIn).toBe(s(4))
    expect(right?.srcOut).toBe(s(8))
    expect(trackEnd(next)).toBe(trackEnd(project))
    expectValid(next)
  })

  it('splits at the right source point for a clip that is not at the start of its source', () => {
    const project = fixture()
    const next = splitAt(project, s(10), 'c4')
    const right = next.clips.find((c) => c.id === 'c4')
    expect(right?.srcIn).toBe(s(4))
    expect(right?.srcOut).toBe(s(14))
    expectValid(next)
  })

  it('uses source time at speed 2', () => {
    const project = fixture()
    project.clips[0] = { ...project.clips[0]!, speed: 2, srcOut: s(10) }
    const next = splitAt(project, s(2), 'c4')
    const [left, right] = next.clips
    expect(left?.srcOut).toBe(s(4))
    expect(right?.srcIn).toBe(s(4))
    expect(right?.start).toBe(s(2))
    expect(trackEnd(next)).toBe(trackEnd(project))
    expectValid(next)
  })

  it('returns the same project when the time is at a clip start', () => {
    const project = fixture()
    expect(splitAt(project, s(8), 'c4')).toBe(project)
    expect(splitAt(project, 0, 'c4')).toBe(project)
  })

  it('returns the same project when the time is past the end of the track', () => {
    const project = fixture()
    expect(splitAt(project, s(31), 'c4')).toBe(project)
  })

  it('returns the same project when only a text or music item is under the time', () => {
    const project = fixture()
    project.clips = []
    expect(splitAt(project, s(3), 'c4')).toBe(project)
  })

  it('returns the same project when the new id is already used', () => {
    const project = fixture()
    expect(splitAt(project, s(4), 'c2')).toBe(project)
  })

  it('does not mutate the input', () => {
    const project = fixture()
    const before = snapshot(project)
    splitAt(project, s(4), 'c4')
    expect(snapshot(project)).toBe(before)
  })
})

describe('deleteItem', () => {
  it('removes a video clip and ripples the track closed', () => {
    const project = fixture()
    const next = deleteItem(project, { kind: 'clip', id: 'c2' })
    expect(next.clips.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(starts(next)).toEqual([0, s(8)])
    expectValid(next)
  })

  it('removes the first clip and closes the gap at the start', () => {
    const next = deleteItem(fixture(), { kind: 'clip', id: 'c1' })
    expect(starts(next)).toEqual([0, s(12)])
    expectValid(next)
  })

  it('removes a text item without touching the clips', () => {
    const project = fixture()
    const next = deleteItem(project, { kind: 'text', id: 't1' })
    expect(next.texts).toEqual([])
    expect(next.clips).toEqual(project.clips)
    expectValid(next)
  })

  it('removes a music item', () => {
    const next = deleteItem(fixture(), { kind: 'music', id: 'mu1' })
    expect(next.music).toEqual([])
    expectValid(next)
  })

  it('keeps the assets', () => {
    const next = deleteItem(fixture(), { kind: 'clip', id: 'c1' })
    expect(next.assets).toHaveLength(3)
  })

  it('returns the same project for an unknown id', () => {
    const project = fixture()
    expect(deleteItem(project, { kind: 'clip', id: 'nope' })).toBe(project)
    expect(deleteItem(project, { kind: 'text', id: 'nope' })).toBe(project)
    expect(deleteItem(project, { kind: 'music', id: 'nope' })).toBe(project)
  })

  it('does not mutate the input', () => {
    const project = fixture()
    const before = snapshot(project)
    deleteItem(project, { kind: 'clip', id: 'c2' })
    expect(snapshot(project)).toBe(before)
  })
})

describe('duplicateItem', () => {
  it('inserts a copy right after a video clip and ripples the rest', () => {
    const project = fixture()
    const next = duplicateItem(project, { kind: 'clip', id: 'c1' }, 'c4')
    expect(next.clips.map((c) => c.id)).toEqual(['c1', 'c4', 'c2', 'c3'])
    expect(starts(next)).toEqual([0, s(8), s(16), s(28)])
    const copy = next.clips[1]!
    expect(copy.srcIn).toBe(project.clips[0]!.srcIn)
    expect(copy.srcOut).toBe(project.clips[0]!.srcOut)
    expect(copy.transform).not.toBe(next.clips[0]!.transform)
    expectValid(next)
  })

  it('duplicates the last clip at the end of the track', () => {
    const next = duplicateItem(fixture(), { kind: 'clip', id: 'c3' }, 'c4')
    expect(next.clips.at(-1)?.id).toBe('c4')
    expect(next.clips.at(-1)?.start).toBe(s(30))
    expectValid(next)
  })

  it('drops transitions on the copy', () => {
    const project = fixture()
    project.clips[0] = { ...project.clips[0]!, transitionIn: { type: 'fade', duration: s(1) } }
    const next = duplicateItem(project, { kind: 'clip', id: 'c1' }, 'c4')
    expect(next.clips[1]?.transitionIn).toBeNull()
    expect(next.clips[0]?.transitionIn).toEqual({ type: 'fade', duration: s(1) })
  })

  it('places a text copy right after the original and keeps the style separate', () => {
    const project = fixture()
    const next = duplicateItem(project, { kind: 'text', id: 't1' }, 'text-2')
    expect(next.texts.map((t) => t.id)).toEqual(['t1', 'text-2'])
    expect(next.texts[1]?.start).toBe(s(6))
    expect(next.texts[1]?.duration).toBe(s(4))
    expect(next.texts[1]?.style).not.toBe(next.texts[0]?.style)
    expect(next.clips).toEqual(project.clips)
    expectValid(next)
  })

  it('places a music copy right after the original', () => {
    const next = duplicateItem(fixture(), { kind: 'music', id: 'mu1' }, 'music-2')
    expect(next.music.map((m) => m.id)).toEqual(['mu1', 'music-2'])
    expect(next.music[1]?.start).toBe(s(30))
    expectValid(next)
  })

  it('returns the same project when the new id is already used', () => {
    const project = fixture()
    expect(duplicateItem(project, { kind: 'clip', id: 'c1' }, 'c2')).toBe(project)
  })

  it('returns the same project for an unknown item', () => {
    const project = fixture()
    expect(duplicateItem(project, { kind: 'clip', id: 'nope' }, 'x1')).toBe(project)
    expect(duplicateItem(project, { kind: 'text', id: 'nope' }, 'x1')).toBe(project)
    expect(duplicateItem(project, { kind: 'music', id: 'nope' }, 'x1')).toBe(project)
  })
})

describe('trimVideoStart', () => {
  it('shortens the head of a clip and closes the track', () => {
    // c2 starts at 8 s with source 2-14 s. Trimming to 10 s removes 2 s of source.
    const next = trimVideoStart(fixture(), 'c2', s(10))
    const c2 = next.clips.find((c) => c.id === 'c2')
    expect(c2?.srcIn).toBe(s(4))
    expect(c2?.srcOut).toBe(s(14))
    expect(c2?.start).toBe(s(8))
    expect(next.clips.find((c) => c.id === 'c3')?.start).toBe(s(18))
    expectValid(next)
  })

  it('clamps so that at least one microsecond of source is left', () => {
    const next = trimVideoStart(fixture(), 'c2', s(1000))
    const c2 = next.clips.find((c) => c.id === 'c2')!
    expect(c2.srcIn).toBeLessThan(c2.srcOut)
    expect(clipEnd(c2) - c2.start).toBeGreaterThanOrEqual(1)
    expectValid(next)
  })

  it('moves the head back into unused source (ripple then closes the gap)', () => {
    // Starting at 7 s extends c2 back into its source (srcIn 1 s); the track closes at 8 s.
    const next = trimVideoStart(fixture(), 'c2', s(7))
    const c2 = next.clips.find((c) => c.id === 'c2')!
    expect(c2.srcIn).toBe(s(1))
    expect(c2.start).toBe(s(8))
    expect(next.clips.find((c) => c.id === 'c3')?.start).toBe(s(21))
    expectValid(next)
  })

  it('rejects non-finite times and unknown clips', () => {
    const project = fixture()
    expect(trimVideoStart(project, 'c2', Number.NaN)).toBe(project)
    expect(trimVideoStart(project, 'c2', Number.POSITIVE_INFINITY)).toBe(project)
    expect(trimVideoStart(project, 'nope', s(1))).toBe(project)
  })

  it('does not mutate the input', () => {
    const project = fixture()
    const before = snapshot(project)
    trimVideoStart(project, 'c2', s(10))
    expect(snapshot(project)).toBe(before)
  })
})

describe('trimVideoEnd', () => {
  it('shortens the tail and moves the later clips', () => {
    const next = trimVideoEnd(fixture(), 'c1', s(5))
    expect(next.clips.find((c) => c.id === 'c1')?.srcOut).toBe(s(5))
    expect(starts(next)).toEqual([0, s(5), s(17)])
    expectValid(next)
  })

  it('does not extend beyond the asset duration', () => {
    const next = trimVideoEnd(fixture(), 'c1', s(50))
    // a1 has 10 s of source; c1 starts at 0 with srcOut 8 s.
    expect(next.clips.find((c) => c.id === 'c1')?.srcOut).toBe(s(10))
    expectValid(next)
  })

  it('keeps at least one microsecond of source', () => {
    const next = trimVideoEnd(fixture(), 'c2', s(-100))
    const c2 = next.clips.find((c) => c.id === 'c2')!
    expect(c2.srcOut - c2.srcIn).toBe(1)
    expectValid(next)
  })

  it('rejects non-finite times and unknown clips', () => {
    const project = fixture()
    expect(trimVideoEnd(project, 'c1', Number.NaN)).toBe(project)
    expect(trimVideoEnd(project, 'nope', s(1))).toBe(project)
  })
})

describe('reorderVideoClip', () => {
  it('moves a clip to the end and packs the track in the new order', () => {
    const next = reorderVideoClip(fixture(), 'c1', 2)
    expect(next.clips.map((c) => c.id)).toEqual(['c2', 'c3', 'c1'])
    expect(starts(next)).toEqual([0, s(12), s(22)])
    expectValid(next)
  })

  it('moves a clip to the front', () => {
    const next = reorderVideoClip(fixture(), 'c3', 0)
    expect(next.clips.map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
    expect(starts(next)).toEqual([0, s(10), s(18)])
    expectValid(next)
  })

  it('clamps the target index', () => {
    expect(reorderVideoClip(fixture(), 'c1', 99).clips.map((c) => c.id)).toEqual(['c2', 'c3', 'c1'])
    expect(reorderVideoClip(fixture(), 'c3', -4).clips.map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('returns the same project when the clip stays where it is', () => {
    const project = fixture()
    expect(reorderVideoClip(project, 'c2', 1)).toBe(project)
  })

  it('returns the same project for an unknown clip or a non-finite index', () => {
    const project = fixture()
    expect(reorderVideoClip(project, 'nope', 0)).toBe(project)
    expect(reorderVideoClip(project, 'c1', Number.NaN)).toBe(project)
  })

  it('closes gaps while reordering', () => {
    const project = fixture()
    project.clips[1] = { ...project.clips[1]!, start: s(12) }
    const next = reorderVideoClip(project, 'c3', 0)
    expect(starts(next)).toEqual([0, s(10), s(18)])
    expectValid(next)
  })
})

describe('setClipProps', () => {
  it('sets volume, mute and transform fields', () => {
    const next = setClipProps(fixture(), 'c1', {
      volume: 0.5,
      muted: true,
      transform: { rotation: 90, flipX: true }
    })
    const c1 = next.clips[0]!
    expect(c1.volume).toBe(0.5)
    expect(c1.muted).toBe(true)
    expect(c1.transform).toEqual({ fit: 'fit', scale: 1, x: 0, y: 0, rotation: 90, flipX: true })
    expectValid(next)
  })

  it('does not change the other clips for a volume change', () => {
    const project = fixture()
    const next = setClipProps(project, 'c1', { volume: 0 })
    expect(next.clips[1]).toEqual(project.clips[1])
  })

  it('changes the timeline length on speed change, keeps the source range and ripples', () => {
    const next = setClipProps(fixture(), 'c1', { speed: 2 })
    const c1 = next.clips[0]!
    expect(c1.speed).toBe(2)
    expect(c1.srcIn).toBe(s(0))
    expect(c1.srcOut).toBe(s(8))
    expect(clipEnd(c1)).toBe(s(4))
    expect(starts(next)).toEqual([0, s(4), s(16)])
    expectValid(next)
  })

  it('slowing down ripples the later clips further', () => {
    const next = setClipProps(fixture(), 'c2', { speed: 0.5 })
    expect(next.clips.find((c) => c.id === 'c3')?.start).toBe(s(32))
    expectValid(next)
  })

  it('rejects the whole patch when one value is invalid', () => {
    const project = fixture()
    expect(setClipProps(project, 'c1', { volume: 0.2, speed: 0 })).toBe(project)
    expect(setClipProps(project, 'c1', { volume: 3 })).toBe(project)
    expect(setClipProps(project, 'c1', { speed: Number.NaN })).toBe(project)
    expect(setClipProps(project, 'c1', { transform: { scale: 0 } })).toBe(project)
    expect(setClipProps(project, 'c1', { transform: { fit: 'stretch' as never } })).toBe(project)
    expect(setClipProps(project, 'c1', { muted: 'yes' as never })).toBe(project)
  })

  it('rejects a speed that would make the clip shorter than one microsecond', () => {
    const project = fixture()
    expect(setClipProps(project, 'c1', { speed: 1e12 })).toBe(project)
  })

  it('returns the same project when nothing changes', () => {
    const project = fixture()
    expect(setClipProps(project, 'c1', { muted: false, volume: 1 })).toBe(project)
  })

  it('returns the same project for an unknown clip', () => {
    const project = fixture()
    expect(setClipProps(project, 'nope', { muted: true })).toBe(project)
  })

  it('does not mutate the input', () => {
    const project = fixture()
    const before = snapshot(project)
    setClipProps(project, 'c1', { speed: 2, transform: { flipX: true } })
    expect(snapshot(project)).toBe(before)
  })
})

describe('speed range', () => {
  it('accepts the boundaries 0.1x and 100x and 20x', () => {
    const project = fixture()
    expect(setClipProps(project, 'c1', { speed: 0.1 }).clips[0]!.speed).toBe(0.1)
    expect(setClipProps(project, 'c1', { speed: 100 }).clips[0]!.speed).toBe(100)
    expect(setClipProps(project, 'c1', { speed: 20 }).clips[0]!.speed).toBe(20)
  })

  it('rejects speeds just outside the range', () => {
    const project = fixture()
    expect(setClipProps(project, 'c1', { speed: 0.09 })).toBe(project)
    expect(setClipProps(project, 'c1', { speed: 100.01 })).toBe(project)
  })

  it('a 8 s source at 100x is an 80 ms timeline clip; a shorter source at 100x is rejected', () => {
    const project = fixture()
    expect(setClipProps(project, 'c1', { speed: 100 }).clips[0]!.speed).toBe(100)
    const tiny = { ...project, clips: project.clips.map((c) => (c.id === 'c1' ? { ...c, srcOut: c.srcIn + 40 } : c)) }
    expect(setClipProps(tiny, 'c1', { speed: 100 })).toBe(tiny)
  })

  it('20x of a 10 s source is a 0.5 s timeline length, in whole microseconds', () => {
    const next = setClipProps(fixture(), 'c3', { speed: 20 })
    const c3 = next.clips.find((c) => c.id === 'c3')!
    expect(c3.speed).toBe(20)
    expect(clipEnd(c3) - c3.start).toBe(Math.round((c3.srcOut - c3.srcIn) / 20))
    expect(Number.isSafeInteger(clipEnd(c3))).toBe(true)
  })
})

describe('text operations', () => {
  it('trimTextStart keeps the end', () => {
    const next = trimTextStart(fixture(), 't1', s(3))
    expect(next.texts[0]?.start).toBe(s(3))
    expect(next.texts[0]?.duration).toBe(s(3))
    expectValid(next)
  })

  it('trimTextStart stops one frame before the end', () => {
    const next = trimTextStart(fixture(), 't1', s(10))
    const t = next.texts[0]!
    expect(t.start + t.duration).toBe(s(6))
    expect(t.duration).toBe(frameDuration(30))
    expectValid(next)
  })

  it('trimTextStart does not go below 0', () => {
    const next = trimTextStart(fixture(), 't1', s(-5))
    expect(next.texts[0]?.start).toBe(0)
    expect(next.texts[0]?.duration).toBe(s(6))
    expectValid(next)
  })

  it('trimTextEnd keeps the start and has a one frame minimum', () => {
    const shorter = trimTextEnd(fixture(), 't1', s(1))
    expect(shorter.texts[0]?.start).toBe(s(2))
    expect(shorter.texts[0]?.duration).toBe(frameDuration(30))
    expectValid(shorter)

    const longer = trimTextEnd(fixture(), 't1', s(9))
    expect(longer.texts[0]?.duration).toBe(s(7))
    expectValid(longer)
  })

  it('moveText keeps the duration and stays at 0 or after', () => {
    const moved = moveText(fixture(), 't1', s(10))
    expect(moved.texts[0]?.start).toBe(s(10))
    expect(moved.texts[0]?.duration).toBe(s(4))
    expectValid(moved)
    expect(moveText(fixture(), 't1', s(-1)).texts[0]?.start).toBe(0)
  })

  it('returns the same project for unknown or non-finite input', () => {
    const project = fixture()
    expect(trimTextStart(project, 'nope', s(1))).toBe(project)
    expect(trimTextEnd(project, 't1', Number.NaN)).toBe(project)
    expect(moveText(project, 't1', Number.NaN)).toBe(project)
    expect(trimTextStart(project, 't1', Number.NaN)).toBe(project)
  })

  it('returns the same project when the value does not change', () => {
    const project = fixture()
    expect(moveText(project, 't1', s(2))).toBe(project)
  })
})

describe('texts and the video end', () => {
  it('moveText past the end stops flush and keeps the length', () => {
    expect(moveText(fixture(), 't1', s(29)).texts[0]).toMatchObject({ start: s(26), duration: s(4) })
  })

  it('trimTextEnd past the end stops at the end of the video', () => {
    expect(trimTextEnd(fixture(), 't1', s(45)).texts[0]).toMatchObject({ start: s(2), duration: s(28) })
  })

  it('a copy of a text at the end is placed flush with the end', () => {
    const at = moveText(fixture(), 't1', s(26))
    const copy = duplicateItem(at, { kind: 'text', id: 't1' }, 'text-2')
    expect(copy.texts.find((t) => t.id === 'text-2')).toMatchObject({ id: 'text-2', start: s(26), duration: s(4) })
  })
})
