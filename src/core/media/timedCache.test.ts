import { describe, expect, it } from 'vitest'
import { TimedCache } from './timedCache'

describe('TimedCache', () => {
  it('finds the entry covering a time and nothing outside its span', () => {
    const cache = new TimedCache<string>(1000)
    cache.put('a', 0, 100, 'f0', 10)
    cache.put('a', 100, 200, 'f1', 10)
    expect(cache.at('a', 0)?.value).toBe('f0')
    expect(cache.at('a', 99)?.value).toBe('f0')
    expect(cache.at('a', 100)?.value).toBe('f1')
    expect(cache.at('a', 200)).toBeNull()
    expect(cache.at('b', 50)).toBeNull()
  })

  it('keeps the byte total under the cap and drops the least recently used first', () => {
    const cache = new TimedCache<number>(30)
    cache.put('a', 0, 10, 0, 10)
    cache.put('a', 10, 20, 1, 10)
    cache.put('a', 20, 30, 2, 10)
    cache.at('a', 0) // touch the oldest
    cache.put('a', 30, 40, 3, 10)
    expect(cache.bytes).toBe(30)
    expect(cache.has('a', 0)).toBe(true)
    expect(cache.has('a', 10)).toBe(false)
    expect(cache.has('a', 30)).toBe(true)
  })

  it('never evicts the entry it just stored, even when it alone is over the cap', () => {
    const cache = new TimedCache<number>(5)
    cache.put('a', 0, 10, 0, 100)
    expect(cache.size).toBe(1)
    cache.put('a', 10, 20, 1, 100)
    expect(cache.size).toBe(1)
    expect(cache.has('a', 15)).toBe(true)
  })

  it('replaces an entry with the same start and counts its bytes once', () => {
    const cache = new TimedCache<number>(100)
    cache.put('a', 0, 10, 1, 40)
    cache.put('a', 0, 12, 2, 20)
    expect(cache.bytes).toBe(20)
    expect(cache.at('a', 11)?.value).toBe(2)
  })

  it('drops a whole group without touching the others', () => {
    const cache = new TimedCache<number>(100)
    cache.put('a', 0, 10, 1, 10)
    cache.put('b', 0, 10, 2, 10)
    cache.dropGroup('a')
    expect(cache.bytes).toBe(10)
    expect(cache.has('a', 5)).toBe(false)
    expect(cache.has('b', 5)).toBe(true)
  })

  it('stays consistent under many inserts in random order', () => {
    const cache = new TimedCache<number>(50 * 4)
    const order = Array.from({ length: 200 }, (_, i) => (i * 37) % 200)
    for (const i of order) cache.put('a', i * 10, i * 10 + 10, i, 4)
    expect(cache.size).toBe(50)
    expect(cache.bytes).toBe(200)
    // The 50 most recently inserted are exactly the ones that answer.
    const alive = order.slice(-50)
    for (const i of alive) expect(cache.at('a', i * 10 + 3)?.value).toBe(i)
    expect(cache.has('a', order[0]! * 10 + 3)).toBe(false)
  })
})
