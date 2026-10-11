import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Project } from '../project/types'
import { secondsToMicros } from '../time'
import { updateMusic } from './musicOps'

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
