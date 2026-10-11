import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Clip, Project } from '../project/types'
import { buildScene, planTimeline } from '../render/scene'
import { clipDuration, clipEnd, sourceTimeAt } from './edit'
import { FREEZE_DEFAULT_DURATION, freezeFrameAt } from './freezeOps'
import { setClipProps, splitAt, trimVideoEnd } from './ops'

const S = 1_000_000
const ids = { stillId: 'still-1', splitId: 'split-1' }

function clip(id: string, srcIn: number, srcOut: number, start: number, extra: Partial<Clip> = {}): Clip {
  return {
    id, track: 'video', assetId: 'a', srcIn, srcOut, start, speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1, muted: false, filter: null, transitionIn: null, ...extra
  }
}

/** One video asset of 10 s with audio, and the given clips on the timeline. */
function project(clips: Clip[]): Project {
  const p = createProject('t')
  p.assets.push({ id: 'a', kind: 'video', name: 'frames.webm', relPath: 'media/a', size: 1, duration: 10 * S, hasAudio: true })
  p.clips = clips
  return p
}

describe('freezeFrameAt', () => {
  it('splits the clip at the playhead and puts a 2 s frame between the halves', () => {
    const p = freezeFrameAt(project([clip('c1', 0, 6 * S, 0)]), 2 * S, ids)
    expect(p.clips.map((c) => c.id)).toEqual(['c1', 'still-1', 'split-1'])
    const [left, frame, right] = p.clips as [Clip, Clip, Clip]
    expect([left.start, clipEnd(left)]).toEqual([0, 2 * S])
    expect([frame.start, clipEnd(frame)]).toEqual([2 * S, 4 * S])
    expect([right.start, clipEnd(right)]).toEqual([4 * S, 8 * S])
    expect(clipDuration(frame)).toBe(FREEZE_DEFAULT_DURATION)
  })

  it('holds the frame that plays at the playhead, using the clip speed', () => {
    // Speed 2: timeline 1 s into the clip is source 2 s into the file, starting at source 1 s.
    const p = freezeFrameAt(project([clip('c1', 1 * S, 9 * S, 0, { speed: 2 })]), 1 * S, ids)
    const frame = p.clips.find((c) => c.id === 'still-1')!
    expect(frame.still).toBe(3 * S)
    expect(sourceTimeAt(frame, 5 * S)).toBe(3 * S)
  })

  it('keeps the source of both halves and gives the frame no audio and speed 1', () => {
    const p = freezeFrameAt(project([clip('c1', 0, 6 * S, 0, { speed: 2, volume: 0.5 })]), 1 * S, ids)
    const [left, frame, right] = p.clips as [Clip, Clip, Clip]
    expect(left.srcOut).toBe(2 * S)
    expect(right.srcIn).toBe(2 * S)
    expect(frame).toMatchObject({ speed: 1, volume: 1, muted: true, transitionIn: null, srcIn: 0, srcOut: FREEZE_DEFAULT_DURATION })
  })

  it('copies the look of the clip to the frame and gives it its own transform', () => {
    const base = clip('c1', 0, 6 * S, 0, { filter: 'sepia', filterAmount: 0.4, transform: { fit: 'fit', scale: 1.5, x: 0.1, y: 0, rotation: 0, flipX: true } })
    const p = freezeFrameAt(project([base]), 1 * S, ids)
    const frame = p.clips.find((c) => c.id === 'still-1')!
    expect(frame.filter).toBe('sepia')
    expect(frame.filterAmount).toBe(0.4)
    expect(frame.transform).toEqual(base.transform)
    expect(frame.transform).not.toBe(base.transform)
  })

  it('at the start of a clip the frame goes in front and the clip keeps its transition', () => {
    const first = clip('c1', 0, 4 * S, 0)
    const second = clip('c2', 4 * S, 8 * S, 4 * S, { transitionIn: { type: 'fade', duration: S } })
    const p = freezeFrameAt(project([first, second]), 4 * S, ids)
    expect(p.clips.map((c) => c.id)).toEqual(['c1', 'still-1', 'c2'])
    expect(p.clips[1]!.transitionIn).toBeNull()
    expect(p.clips[2]!.transitionIn).toEqual({ type: 'fade', duration: S })
    expect(p.clips[2]!.start).toBe(6 * S)
  })

  it('ripples the rest of the video track and leaves the project unchanged when no clip is under the playhead', () => {
    const base = project([clip('c1', 0, 2 * S, 0), clip('c2', 0, 2 * S, 2 * S)])
    const p = freezeFrameAt(base, 4 * S, ids)
    expect(p).toBe(base)
    const moved = freezeFrameAt(base, 1 * S, ids)
    expect(moved.clips.at(-1)!.start).toBe(4 * S)
  })

  it('returns the same project for an id clash or a non-positive length', () => {
    const base = project([clip('c1', 0, 6 * S, 0)])
    expect(freezeFrameAt(base, 1 * S, { stillId: 'x', splitId: 'x' })).toBe(base)
    expect(freezeFrameAt(base, 1 * S, ids, 0)).toBe(base)
  })

  it('accepts a custom length', () => {
    const p = freezeFrameAt(project([clip('c1', 0, 6 * S, 0)]), 1 * S, ids, 5 * S)
    expect(clipDuration(p.clips.find((c) => c.id === 'still-1')!)).toBe(5 * S)
  })

  it('is cut at a whole-microsecond playhead and never uses floating seconds', () => {
    const p = freezeFrameAt(project([clip('c1', 0, 6 * S, 0, { speed: 1.5 })]), 1_000_001.4, ids)
    for (const c of p.clips) {
      expect(Number.isInteger(c.start)).toBe(true)
      expect(Number.isInteger(c.srcIn)).toBe(true)
      expect(Number.isInteger(c.srcOut)).toBe(true)
    }
  })

  it('produces projects that pass schema validation', () => {
    const p = freezeFrameAt(project([clip('c1', 0, 6 * S, 0)]), 2 * S, ids)
    expect(validateProject(structuredClone(p)).ok).toBe(true)
  })

  it('renders the held frame for the whole length, also after the file has ended', () => {
    const p = freezeFrameAt(project([clip('c1', 0, 4 * S, 0)]), 2 * S, ids)
    const planned = planTimeline(p)
    expect(planned.duration).toBe(6 * S)
    for (const t of [2 * S, 3 * S, 4 * S - 1]) {
      const layer = buildScene(p, planned, t).videos.find((v) => v.clipId === 'still-1')!
      expect(layer.srcTime).toBe(2 * S)
    }
    expect(buildScene(p, planned, 4 * S).videos.map((v) => v.clipId)).toEqual(['split-1'])
  })

  it('keeps the freeze when the clip is split again, trimmed or moved in the track', () => {
    const frozen = freezeFrameAt(project([clip('c1', 0, 6 * S, 0)]), 1 * S, ids)
    const cut = splitAt(frozen, 3 * S, 'split-2')
    const pieces = cut.clips.filter((c) => c.still !== undefined)
    expect(pieces.map((c) => c.id)).toEqual(['still-1'])
    expect(pieces[0]!.still).toBe(1 * S)

    const trimmed = trimVideoEnd(frozen, 'still-1', 3 * S)
    expect(trimmed.clips.find((c) => c.id === 'still-1')!.still).toBe(1 * S)
  })

  it('may hold a frame longer than the file, like an image', () => {
    const base = freezeFrameAt(project([clip('c1', 8 * S, 10 * S, 0)]), 1 * S, ids)
    const longer = trimVideoEnd(base, 'still-1', 20 * S)
    expect(clipDuration(longer.clips.find((c) => c.id === 'still-1')!)).toBeGreaterThan(10 * S)
  })

  it('cannot change the speed of a freeze frame', () => {
    const frozen = freezeFrameAt(project([clip('c1', 0, 6 * S, 0)]), 1 * S, ids)
    expect(setClipProps(frozen, 'still-1', { speed: 2 })).toBe(frozen)
  })
})
