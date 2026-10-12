import { describe, expect, it } from 'vitest'
import { droppedKeys, missingKind, planSweep, STORE_KEY_PATTERN, storeKeysOf, type StoredMediaInfo } from './storedMedia'
import type { Asset } from '../project/types'

const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({ id, kind: 'video', name: `${id}.webm`, relPath: `${id}.webm`, size: 10, duration: 1000, ...extra })
const info = (key: string, savedAt: number): StoredMediaInfo => ({ key, name: 'x', size: 1, type: 'video/webm', savedAt })

describe('stored media helpers', () => {
  it('collects the keys of the assets that have one', () => {
    const keys = storeKeysOf({ assets: [asset('a', { storeKey: 'rec-aaaaaaaa' }), asset('b')] })
    expect([...keys]).toEqual(['rec-aaaaaaaa'])
    expect(storeKeysOf(null).size).toBe(0)
  })

  it('accepts only safe keys', () => {
    expect(STORE_KEY_PATTERN.test('rec-abcdefgh12')).toBe(true)
    expect(STORE_KEY_PATTERN.test('short')).toBe(false)
    expect(STORE_KEY_PATTERN.test('../../etc/passwd')).toBe(false)
  })

  it('sweeps only unreferenced copies older than the grace period', () => {
    const stored = [info('keep', 0), info('old', 0), info('fresh', 9_000)]
    expect(planSweep(stored, new Set(['keep']), 10_000, 5_000)).toEqual(['old'])
  })

  it('lists the keys a replaced document drops', () => {
    expect(droppedKeys(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual(['a'])
  })

  it('names the kind of a missing medium', () => {
    expect(missingKind(asset('a'))).toBe('file')
    expect(missingKind(asset('a', { origin: 'recording' }))).toBe('recording')
    expect(missingKind(asset('a', { origin: 'example' }))).toBe('example')
  })
})
