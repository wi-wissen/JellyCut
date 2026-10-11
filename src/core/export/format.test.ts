import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import { formatBytes, formatClock, formatEta, missingAssetsInUse } from './format'

describe('formatClock', () => {
  it('shows minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(30_000_000)).toBe('0:30')
    expect(formatClock(65_000_000)).toBe('1:05')
    expect(formatClock(59_999_999)).toBe('0:59')
  })

  it('switches to hours from one hour on', () => {
    expect(formatClock(3_600_000_000)).toBe('1:00:00')
    expect(formatClock(3_725_000_000)).toBe('1:02:05')
    expect(formatClock(36_000_000_000)).toBe('10:00:00')
  })

  it('clamps negative values to zero', () => {
    expect(formatClock(-5_000_000)).toBe('0:00')
  })
})

describe('formatBytes', () => {
  const MB = 1024 * 1024
  const GB = 1024 * MB

  it('uses KB below one megabyte without decimals', () => {
    expect(formatBytes(820 * 1024, 'de')).toBe('820 KB')
    expect(formatBytes(0, 'en')).toBe('0 KB')
  })

  it('uses MB below one gigabyte without decimals', () => {
    expect(formatBytes(24 * MB, 'en')).toBe('24 MB')
    expect(formatBytes(24.4 * MB, 'en')).toBe('24 MB')
  })

  it('uses GB with one decimal', () => {
    expect(formatBytes(1.3 * GB, 'en')).toBe('1.3 GB')
    expect(formatBytes(2 * GB, 'en')).toBe('2.0 GB')
  })

  it('uses locale decimal separators', () => {
    expect(formatBytes(1.3 * GB, 'de')).toBe('1,3 GB')
    expect(formatBytes(1.3 * GB, 'en')).toBe('1.3 GB')
  })
})

describe('formatEta', () => {
  it('returns none without a usable estimate', () => {
    expect(formatEta(null)).toEqual({ unit: 'none' })
    expect(formatEta(Number.NaN)).toEqual({ unit: 'none' })
    expect(formatEta(-1)).toEqual({ unit: 'none' })
  })

  it('returns seconds below one minute, rounded up, at least one', () => {
    expect(formatEta(0)).toEqual({ unit: 'seconds', value: 1 })
    expect(formatEta(1_200)).toEqual({ unit: 'seconds', value: 2 })
    expect(formatEta(45_000)).toEqual({ unit: 'seconds', value: 45 })
  })

  it('returns minutes from one minute on, rounded', () => {
    expect(formatEta(60_000)).toEqual({ unit: 'minutes', value: 1 })
    expect(formatEta(110_000)).toEqual({ unit: 'minutes', value: 2 })
    expect(formatEta(10 * 60_000)).toEqual({ unit: 'minutes', value: 10 })
  })
})

describe('missingAssetsInUse', () => {
  function projectWith() {
    const project = createProject('Test')
    project.assets = [
      { id: 'a1', kind: 'video', name: 'one.mp4', relPath: 'one.mp4', size: 1, duration: 1_000_000 },
      { id: 'a2', kind: 'video', name: 'two.mp4', relPath: 'two.mp4', size: 1, duration: 1_000_000 },
      { id: 'a3', kind: 'audio', name: 'song.mp3', relPath: 'song.mp3', size: 1, duration: 1_000_000 },
      { id: 'a4', kind: 'video', name: 'unused.mp4', relPath: 'unused.mp4', size: 1, duration: 1_000_000 }
    ]
    project.clips = [
      { id: 'c1', track: 'video', assetId: 'a1', srcIn: 0, srcOut: 1_000_000, start: 0, speed: 1, transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false }, volume: 1, muted: false, filter: null, transitionIn: null },
      { id: 'c2', track: 'video', assetId: 'a2', srcIn: 0, srcOut: 1_000_000, start: 1_000_000, speed: 1, transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false }, volume: 1, muted: false, filter: null, transitionIn: null }
    ]
    project.music = [{ id: 'm1', assetId: 'a3', start: 0, srcIn: 0, srcOut: 1_000_000, volume: 1, fadeIn: 0, fadeOut: 0 }]
    return project
  }

  it('lists used assets that are not ready, in project order', () => {
    const project = projectWith()
    expect(missingAssetsInUse(project, { a1: 'ready', a2: 'missing', a3: 'unsupported' })).toEqual(['two.mp4', 'song.mp3'])
  })

  it('treats assets without a status as not ready', () => {
    expect(missingAssetsInUse(projectWith(), { a1: 'ready' })).toEqual(['two.mp4', 'song.mp3'])
  })

  it('ignores unused assets', () => {
    expect(missingAssetsInUse(projectWith(), { a1: 'ready', a2: 'ready', a3: 'ready', a4: 'missing' })).toEqual([])
  })

  it('returns an empty list for a project without media', () => {
    expect(missingAssetsInUse(createProject('Empty'), {})).toEqual([])
  })
})
