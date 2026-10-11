import { describe, expect, it, vi } from 'vitest'
import { createAutosaver } from './autosave'

function setup(opts: { delayMs?: number; failWith?: Error; slow?: boolean } = {}) {
  const saved: string[] = []
  const errors: unknown[] = []
  const statuses: string[] = []
  let release: (() => void) | null = null
  const autosaver = createAutosaver<string>({
    delayMs: opts.delayMs ?? 1000,
    save: async (v) => {
      if (opts.failWith) throw opts.failWith
      if (opts.slow) await new Promise<void>((r) => (release = r))
      saved.push(v)
    },
    onError: (e) => errors.push(e),
    onStatus: (s) => statuses.push(s)
  })
  return { autosaver, saved, errors, statuses, release: () => release?.() }
}

describe('createAutosaver', () => {
  it('saves once after the delay, with the latest value', async () => {
    vi.useFakeTimers()
    const { autosaver, saved } = setup()
    autosaver.notify('a')
    autosaver.notify('b')
    autosaver.notify('c')
    await vi.advanceTimersByTimeAsync(999)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toEqual(['c'])
    vi.useRealTimers()
  })
  it('restarts the delay on every notify (debounce)', async () => {
    vi.useFakeTimers()
    const { autosaver, saved } = setup()
    autosaver.notify('a')
    await vi.advanceTimersByTimeAsync(800)
    autosaver.notify('b')
    await vi.advanceTimersByTimeAsync(800)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(200)
    expect(saved).toEqual(['b'])
    vi.useRealTimers()
  })
  it('flush saves the pending value immediately and cancels the timer', async () => {
    vi.useFakeTimers()
    const { autosaver, saved } = setup()
    autosaver.notify('a')
    await autosaver.flush()
    expect(saved).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(5000)
    expect(saved).toEqual(['a'])
    vi.useRealTimers()
  })
  it('flush without pending changes does nothing', async () => {
    const { autosaver, saved } = setup()
    await autosaver.flush()
    expect(saved).toEqual([])
  })
  it('never runs two saves at once; a notify during a save triggers one more afterwards', async () => {
    vi.useFakeTimers()
    const ctl = setup({ slow: true })
    ctl.autosaver.notify('a')
    await vi.advanceTimersByTimeAsync(1000)
    ctl.autosaver.notify('b')
    await vi.advanceTimersByTimeAsync(1000)
    expect(ctl.saved).toEqual([])
    ctl.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctl.saved).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(1000)
    ctl.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctl.saved).toEqual(['a', 'b'])
    vi.useRealTimers()
  })
  it('reports errors, keeps the value pending and does not throw', async () => {
    vi.useFakeTimers()
    const err = new Error('disk full')
    const { autosaver, errors, statuses } = setup({ failWith: err })
    autosaver.notify('a')
    await vi.advanceTimersByTimeAsync(1000)
    expect(errors).toEqual([err])
    expect(statuses.at(-1)).toBe('error')
    expect(autosaver.status()).toBe('error')
    vi.useRealTimers()
  })
  it('walks through the statuses idle -> dirty -> saving -> saved', async () => {
    vi.useFakeTimers()
    const { autosaver, statuses } = setup()
    expect(autosaver.status()).toBe('idle')
    autosaver.notify('a')
    expect(autosaver.status()).toBe('dirty')
    await vi.advanceTimersByTimeAsync(1000)
    expect(statuses).toEqual(['dirty', 'saving', 'saved'])
    expect(autosaver.status()).toBe('saved')
    vi.useRealTimers()
  })
  it('dispose cancels a pending save', async () => {
    vi.useFakeTimers()
    const { autosaver, saved } = setup()
    autosaver.notify('a')
    autosaver.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(saved).toEqual([])
    autosaver.notify('b')
    await vi.advanceTimersByTimeAsync(5000)
    expect(saved).toEqual([])
    vi.useRealTimers()
  })
})
