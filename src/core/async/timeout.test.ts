import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { orFallback, TimeoutError, withTimeout } from './timeout'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('passes the value through when the promise settles in time', async () => {
    const result = withTimeout(Promise.resolve(7), 1000, 'step')
    await expect(result).resolves.toBe(7)
  })

  it('passes the original error through', async () => {
    await expect(withTimeout(Promise.reject(new RangeError('x')), 1000, 'step')).rejects.toBeInstanceOf(RangeError)
  })

  it('rejects with a named TimeoutError when the promise never settles', async () => {
    const result = withTimeout(new Promise<number>(() => undefined), 500, 'probe')
    const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError', label: 'probe', ms: 500 })
    await vi.advanceTimersByTimeAsync(500)
    await assertion
    expect(new TimeoutError('a', 1).message).toContain('a did not finish')
  })

  it('ignores a result that arrives after the limit', async () => {
    let resolveLate: (v: number) => void = () => undefined
    const late = new Promise<number>((r) => (resolveLate = r))
    const result = withTimeout(late, 100, 'late')
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    resolveLate(1)
  })
})

describe('orFallback', () => {
  it('returns the fallback on timeout and on error', async () => {
    const slow = orFallback(new Promise<string>(() => undefined), 100, 'thumb', 'none')
    await vi.advanceTimersByTimeAsync(100)
    await expect(slow).resolves.toBe('none')
    await expect(orFallback(Promise.reject(new Error('x')), 100, 'thumb', 'none')).resolves.toBe('none')
  })
})
