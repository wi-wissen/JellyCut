import { describe, expect, it } from 'vitest'
import { musicGain } from './gain'
import type { MusicItem } from '../project/types'

const item = (extra: Partial<MusicItem> = {}): MusicItem => ({
  id: 'm', assetId: 'a', start: 1_000_000, srcIn: 0, srcOut: 10_000_000, volume: 0.8, fadeIn: 0, fadeOut: 0, ...extra
})

describe('musicGain', () => {
  it('is the plain volume while playing without fades', () => {
    expect(musicGain(item(), 5_000_000)).toBe(0.8)
  })
  it('is silent before the start and from the end on', () => {
    expect(musicGain(item(), 999_999)).toBe(0)
    expect(musicGain(item(), 11_000_000)).toBe(0)
    expect(musicGain(item(), 20_000_000)).toBe(0)
  })
  it('fades in linearly', () => {
    const m = item({ fadeIn: 2_000_000 })
    expect(musicGain(m, 1_000_000)).toBe(0)
    expect(musicGain(m, 2_000_000)).toBeCloseTo(0.4, 6)
    expect(musicGain(m, 3_000_000)).toBeCloseTo(0.8, 6)
    expect(musicGain(m, 6_000_000)).toBe(0.8)
  })
  it('fades out linearly towards the end', () => {
    const m = item({ fadeOut: 2_000_000 })
    expect(musicGain(m, 8_999_999)).toBe(0.8)
    expect(musicGain(m, 10_000_000)).toBeCloseTo(0.4, 6)
    expect(musicGain(m, 10_999_999)).toBeLessThan(0.001)
  })
  it('combines both fades on a short item without exceeding the volume', () => {
    const m = item({ srcOut: 2_000_000, fadeIn: 2_000_000, fadeOut: 2_000_000 })
    for (let t = 1_000_000; t < 3_000_000; t += 100_000) {
      const g = musicGain(m, t)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(0.8)
    }
  })
  it('respects srcIn: the item length is srcOut - srcIn', () => {
    const m = item({ srcIn: 4_000_000, srcOut: 6_000_000 })
    expect(musicGain(m, 2_999_999)).toBe(0.8)
    expect(musicGain(m, 3_000_000)).toBe(0)
  })
})
