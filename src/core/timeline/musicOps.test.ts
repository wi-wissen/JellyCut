import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Project } from '../project/types'
import { frameDuration, secondsToMicros } from '../time'
import { moveMusic, splitMusicAt, trimMusicEnd, trimMusicStart, updateMusic } from './musicOps'

const s = (seconds: number) => secondsToMicros(seconds)

function fixture(): Project {
  const p = createProject('M')
  return {
    ...p,
    assets: [{ id: 'm1', kind: 'audio', name: 'bed.mp3', relPath: 'media/bed.mp3', size: 1, duration: s(30) }],
    music: [{ id: 'mu1', assetId: 'm1', start: 0, srcIn: 0, srcOut: s(30), volume: 0.6, fadeIn: 0, fadeOut: s(1) }]
  }
}

describe('updateMusic', () => {
  it('sets volume, fadeIn and fadeOut', () => {
    const next = updateMusic(fixture(), 'mu1', { volume: 1.5, fadeIn: s(2), fadeOut: s(3) })
    expect(next.music[0]).toMatchObject({ volume: 1.5, fadeIn: s(2), fadeOut: s(3) })
    expect(validateProject(next).ok).toBe(true)
  })

  it('clamps volume to 0..2 and fades to 0..5 s', () => {
    const p = fixture()
    expect(updateMusic(p, 'mu1', { volume: 9 }).music[0]!.volume).toBe(2)
    expect(updateMusic(p, 'mu1', { volume: -1 }).music[0]!.volume).toBe(0)
    expect(updateMusic(p, 'mu1', { fadeIn: s(12) }).music[0]!.fadeIn).toBe(s(5))
    expect(updateMusic(p, 'mu1', { fadeOut: -5 }).music[0]!.fadeOut).toBe(0)
  })

  it('never lets a fade be longer than the item itself', () => {
    const short: Project = {
      ...fixture(),
      music: [{ id: 'mu1', assetId: 'm1', start: 0, srcIn: 0, srcOut: s(2), volume: 1, fadeIn: 0, fadeOut: 0 }]
    }
    expect(updateMusic(short, 'mu1', { fadeIn: s(4) }).music[0]!.fadeIn).toBe(s(2))
  })

  it('rounds fades to whole microseconds', () => {
    expect(updateMusic(fixture(), 'mu1', { fadeIn: 1234.4 }).music[0]!.fadeIn).toBe(1234)
  })

  it('rejects non-finite values as a whole', () => {
    const p = fixture()
    expect(updateMusic(p, 'mu1', { volume: Number.NaN })).toBe(p)
    expect(updateMusic(p, 'mu1', { fadeIn: Number.POSITIVE_INFINITY, volume: 1 })).toBe(p)
  })

  it('returns the same project for an unknown id or no change', () => {
    const p = fixture()
    expect(updateMusic(p, 'missing', { volume: 1 })).toBe(p)
    expect(updateMusic(p, 'mu1', { volume: 0.6, fadeOut: s(1) })).toBe(p)
    expect(updateMusic(p, 'mu1', {})).toBe(p)
  })

  it('does not change the input project', () => {
    const p = fixture()
    const before = JSON.stringify(p)
    updateMusic(p, 'mu1', { volume: 0 })
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('music moves, trims, splits and mute', () => {
  const FPS = 30
  const withItem = (item: Partial<Project['music'][number]>): Project => {
    const p = fixture()
    return { ...p, music: [{ ...p.music[0]!, ...item }] }
  }

  it('moves an item in time and keeps its length; the start is never negative', () => {
    const moved = moveMusic(fixture(), 'mu1', s(5))
    expect(moved.music[0]).toMatchObject({ start: s(5), srcIn: 0, srcOut: s(30) })
    expect(moveMusic(fixture(), 'mu1', -s(3)).music[0]!.start).toBe(0)
    expect(validateProject(moved).ok).toBe(true)
  })

  it('a non-finite move is rejected', () => {
    const p = fixture()
    expect(moveMusic(p, 'mu1', Number.NaN)).toBe(p)
  })

  it('trims the start: the source moves with it and cannot extend before its beginning', () => {
    const p = withItem({ start: s(4), srcIn: s(2), srcOut: s(10) })
    const trimmedProject = trimMusicStart(p, 'mu1', s(3), FPS)
    expect(trimmedProject.music[0]).toMatchObject({ start: s(3), srcIn: s(1), srcOut: s(10) })
    // Left of the source start is not possible: the start stops at 2 s, where srcIn is 0.
    expect(trimMusicStart(p, 'mu1', s(0), FPS).music[0]).toMatchObject({ start: s(2), srcIn: 0, srcOut: s(10) })
    // Shorter than one frame is not possible.
    const short = trimMusicStart(p, 'mu1', s(20), FPS).music[0]!
    expect(short.srcOut - short.srcIn).toBe(frameDuration(FPS))
    expect(validateProject(trimmedProject).ok).toBe(true)
  })

  it('trims the end and stops at the end of the source file', () => {
    const p = withItem({ start: s(4), srcIn: s(2), srcOut: s(10) })
    expect(trimMusicEnd(p, 'mu1', s(8), FPS).music[0]).toMatchObject({ start: s(4), srcIn: s(2), srcOut: s(6) })
    // The source has 30 s; it cannot grow beyond srcIn + (30 - 2) s, which is end 32 s on the timeline.
    expect(trimMusicEnd(p, 'mu1', s(100), FPS).music[0]!.srcOut).toBe(s(30))
  })

  it('splits at the playhead into two parts of the same source with the fades on the outer edges', () => {
    const p = withItem({ fadeIn: s(1), fadeOut: s(2) })
    const next = splitMusicAt(p, 'mu1', s(10), 'mu2', FPS)
    expect(next.music).toHaveLength(2)
    expect(next.music[0]).toMatchObject({ id: 'mu1', start: 0, srcIn: 0, srcOut: s(10), fadeIn: s(1), fadeOut: 0 })
    expect(next.music[1]).toMatchObject({ id: 'mu2', start: s(10), srcIn: s(10), srcOut: s(30), fadeIn: 0, fadeOut: s(2) })
    expect(validateProject(next).ok).toBe(true)
  })

  it('does not split outside the item or next to its edge', () => {
    const p = fixture()
    expect(splitMusicAt(p, 'mu1', 0, 'mu2', FPS)).toBe(p)
    expect(splitMusicAt(p, 'mu1', s(30), 'mu2', FPS)).toBe(p)
    expect(splitMusicAt(p, 'mu1', s(10), 'mu1', FPS)).toBe(p)
  })

  it('mutes and unmutes; an old project without the flag counts as not muted', () => {
    const muted = updateMusic(fixture(), 'mu1', { muted: true })
    expect(muted.music[0]!.muted).toBe(true)
    expect(validateProject(muted).ok).toBe(true)
    expect(updateMusic(muted, 'mu1', { muted: false }).music[0]!.muted).toBe(false)
    expect(fixture().music[0]!.muted).toBeUndefined()
  })
})
