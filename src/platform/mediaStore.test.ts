import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryMediaStore, newStoreKey, requestPersistentStorage } from './mediaStore'
import { STORE_KEY_PATTERN } from '../core/io/storedMedia'

const file = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type: 'video/webm' })

afterEach(() => vi.unstubAllGlobals())

describe('memory media store (the test fake)', () => {
  it('stores, returns, lists and deletes', async () => {
    const store = createMemoryMediaStore()
    expect(await store.put('k1', file('a.webm', 10))).toEqual({ ok: true })
    expect((await store.get('k1'))?.name).toBe('a.webm')
    expect(await store.get('nope')).toBeNull()
    expect((await store.list()).map((s) => [s.key, s.size])).toEqual([['k1', 10]])
    await store.delete('k1')
    expect(await store.get('k1')).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('reports quota and unavailable storage without throwing', async () => {
    const store = createMemoryMediaStore({ quotaBytes: 15 })
    expect(await store.put('a', file('a', 10))).toEqual({ ok: true })
    expect(await store.put('b', file('b', 10))).toEqual({ ok: false, reason: 'quota' })
    expect(await store.put('a', file('a2', 12))).toEqual({ ok: true })
    store.options.unavailable = true
    expect(await store.put('c', file('c', 1))).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('store keys', () => {
  it('are random and match the project schema pattern', () => {
    const a = newStoreKey()
    expect(STORE_KEY_PATTERN.test(a)).toBe(true)
    expect(newStoreKey()).not.toBe(a)
  })
})

describe('requestPersistentStorage', () => {
  const mem = new Map<string, string>()
  const stubStorage = (storage: unknown) => {
    mem.clear()
    vi.stubGlobal('navigator', { storage })
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) })
  }

  it('says unsupported without the API', async () => {
    stubStorage(undefined)
    expect(await requestPersistentStorage()).toBe('unsupported')
  })

  it('is granted when the browser already persists', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => true, persist })
    expect(await requestPersistentStorage()).toBe('granted')
    expect(persist).not.toHaveBeenCalled()
  })

  it('asks once; a denial is remembered and not asked again', async () => {
    const persist = vi.fn(async () => false)
    stubStorage({ persisted: async () => false, persist })
    expect(await requestPersistentStorage()).toBe('denied')
    expect(await requestPersistentStorage()).toBe('denied')
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('treats an error as a denial', async () => {
    stubStorage({ persisted: async () => false, persist: async () => { throw new Error('x') } })
    expect(await requestPersistentStorage()).toBe('denied')
  })
})
