import { describe, expect, it } from 'vitest'
import { RemovedMediaCache, planReconcile, REMOVED_MEDIA_LIMIT } from './removedMedia'

describe('RemovedMediaCache', () => {
  it('keeps at most the limit and drops the oldest entry first', () => {
    const cache = new RemovedMediaCache<number>(3)
    cache.put('a', 1)
    cache.put('b', 2)
    cache.put('c', 3)
    cache.put('d', 4)
    expect(cache.size).toBe(3)
    expect(cache.ids()).toEqual(['b', 'c', 'd'])
    expect(cache.has('a')).toBe(false)
  })

  it('reports the entries that fell out so their stored copies can be freed', () => {
    const cache = new RemovedMediaCache<string>(2)
    expect(cache.put('a', 'A')).toEqual([])
    cache.put('b', 'B')
    expect(cache.put('c', 'C')).toEqual([['a', 'A']])
    expect(cache.clear()).toEqual([['b', 'B'], ['c', 'C']])
    expect(cache.size).toBe(0)
  })

  it('moves a re-put id to the newest position instead of duplicating it', () => {
    const cache = new RemovedMediaCache<number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    cache.put('a', 3)
    expect(cache.ids()).toEqual(['b', 'a'])
    expect(cache.take('a')).toBe(3)
  })

  it('take returns the entry once and removes it', () => {
    const cache = new RemovedMediaCache<string>(5)
    cache.put('x', 'file')
    expect(cache.take('x')).toBe('file')
    expect(cache.take('x')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('clear empties the cache', () => {
    const cache = new RemovedMediaCache<number>(REMOVED_MEDIA_LIMIT)
    for (let i = 0; i < 5; i++) cache.put(`asset-${i}`, i)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('the default limit is 20 entries', () => {
    const cache = new RemovedMediaCache<number>(REMOVED_MEDIA_LIMIT)
    for (let i = 0; i < 25; i++) cache.put(`asset-${i}`, i)
    expect(cache.size).toBe(20)
    expect(cache.has('asset-4')).toBe(false)
    expect(cache.has('asset-5')).toBe(true)
  })
})

describe('planReconcile', () => {
  it('restores a cached file whose asset is back in the project and not live', () => {
    expect(planReconcile(['a', 'b'], ['b'], ['a'])).toEqual({ restore: ['a'], evict: [] })
  })

  it('evicts a live file whose asset left the project', () => {
    expect(planReconcile(['a'], ['a', 'b'], [])).toEqual({ restore: [], evict: ['b'] })
  })

  it('does nothing for an asset that is live already or that was never cached', () => {
    expect(planReconcile(['a', 'c'], ['a'], ['a'])).toEqual({ restore: [], evict: [] })
  })
})
