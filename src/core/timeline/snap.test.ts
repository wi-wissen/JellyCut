import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import type { Project } from '../project/types'
import { secondsToMicros } from '../time'
import { collectSnapPoints, snapTime } from './snap'

describe('snapTime', () => {
  it('returns the nearest candidate within the threshold', () => {
    expect(snapTime(1_050, [1_000, 2_000], 100)).toBe(1_000)
    expect(snapTime(1_950, [1_000, 2_000], 100)).toBe(2_000)
  })

  it('returns t when every candidate is out of range', () => {
    expect(snapTime(1_500, [1_000, 2_000], 100)).toBe(1_500)
  })

  it('treats the threshold as inclusive', () => {
    expect(snapTime(1_100, [1_000], 100)).toBe(1_000)
    expect(snapTime(1_101, [1_000], 100)).toBe(1_101)
  })

  it('breaks ties towards the earlier candidate', () => {
    expect(snapTime(1_500, [2_000, 1_000], 1_000)).toBe(1_000)
    expect(snapTime(1_500, [1_000, 2_000], 1_000)).toBe(1_000)
  })

  it('does not depend on the order of the candidates', () => {
    expect(snapTime(10, [50, 0, 12, 30], 5)).toBe(12)
  })

  it('returns t for an empty candidate list', () => {
    expect(snapTime(42, [], 1_000)).toBe(42)
  })

  it('snaps exactly onto a candidate', () => {
    expect(snapTime(7, [7], 0)).toBe(7)
  })

  it('returns t when the threshold is zero and nothing matches exactly', () => {
    expect(snapTime(7, [8], 0)).toBe(7)
  })
})

function sampleProject(): Project {
  const project = createProject('snap')
  project.assets = [
    { id: 'a1', kind: 'video', name: 'a.mp4', relPath: 'a', size: 1, duration: secondsToMicros(30) },
    { id: 'm1', kind: 'audio', name: 'm.mp3', relPath: 'm', size: 1, duration: secondsToMicros(30) }
  ]
  project.clips = [
    {
      id: 'c1',
      track: 'video',
      assetId: 'a1',
      srcIn: 0,
      srcOut: secondsToMicros(4),
      start: 0,
      speed: 1,
      transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
      volume: 1,
      muted: false,
      filter: null,
      transitionIn: null
    },
    {
      id: 'c2',
      track: 'video',
      assetId: 'a1',
      srcIn: 0,
      srcOut: secondsToMicros(6),
      start: secondsToMicros(4),
      speed: 2,
      transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
      volume: 1,
      muted: false,
      filter: null,
      transitionIn: null
    }
  ]
  project.texts = [
    {
      id: 't1',
      start: secondsToMicros(1),
      duration: secondsToMicros(2),
      text: 'hi',
      style: { font: 'Sora', size: 20, color: '#fff', outline: null },
      pos: { x: 0.5, y: 0.5 },
      animIn: null,
      animOut: null
    }
  ]
  project.music = [
    {
      id: 'mu1',
      assetId: 'm1',
      start: secondsToMicros(2),
      srcIn: 0,
      srcOut: secondsToMicros(4),
      volume: 1,
      fadeIn: 0,
      fadeOut: 0
    }
  ]
  return project
}

describe('collectSnapPoints', () => {
  it('collects 0, all clip, text and music edges sorted and without duplicates', () => {
    const points = collectSnapPoints(sampleProject())
    // 0, t1 1-3 s, mu1 2-6 s, c1 0-4 s, c2 4-7 s
    expect(points).toEqual([0, 1, 2, 3, 4, 6, 7].map((s) => secondsToMicros(s)))
  })

  it('uses the clip duration after speed, not the source length', () => {
    // c2 has 6 s of source at 2x speed, so it ends at 4 + 3 = 7 s.
    expect(collectSnapPoints(sampleProject())).toContain(secondsToMicros(7))
  })

  it('leaves out the item named by excludeId', () => {
    const points = collectSnapPoints(sampleProject(), 'c2')
    expect(points).not.toContain(secondsToMicros(7))
    expect(points).toContain(secondsToMicros(4))
    expect(points).toContain(secondsToMicros(6))
  })

  it('adds the playhead when given', () => {
    expect(collectSnapPoints(sampleProject(), undefined, 123_456)).toContain(123_456)
  })

  it('returns only 0 for an empty project', () => {
    expect(collectSnapPoints(createProject('empty'))).toEqual([0])
  })
})
