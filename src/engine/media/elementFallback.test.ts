import { describe, expect, it, vi } from 'vitest'
import { ElementFallback, type FallbackOps } from './elementFallback'

const exactFrame = { tag: 'exact' } as unknown as CanvasImageSource
const element = { tag: 'element' } as unknown as HTMLVideoElement

function setup(opts: { black?: Set<unknown>; shown?: boolean } = {}) {
  const warn = vi.fn()
  const showAt = vi.fn(async () => opts.shown ?? true)
  const ops: FallbackOps = { isBlack: (s) => opts.black?.has(s) ?? false, showAt, warn }
  return { fallback: new ElementFallback(ops), warn, showAt }
}

describe('ElementFallback', () => {
  it('keeps a good exact picture and never touches the element', async () => {
    const { fallback, showAt } = setup()
    const element_ = vi.fn(() => element)
    expect(await fallback.pick('a', 1_000_000, exactFrame, false, element_)).toBe(exactFrame)
    expect(element_).not.toHaveBeenCalled()
    expect(showAt).not.toHaveBeenCalled()
    expect(fallback.assets).toEqual([])
  })

  it('uses the element when the exact path found no frame, and warns once per asset', async () => {
    const { fallback, warn, showAt } = setup()
    expect(await fallback.pick('a', 1_500_000, null, false, () => element)).toBe(element)
    expect(showAt).toHaveBeenCalledWith(element, 1.5)
    expect(await fallback.pick('a', 2_000_000, null, false, () => element)).toBe(element)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(fallback.assets).toEqual(['a'])
    expect(fallback.log.reasonOf('a')).toBe('missing')
  })

  it('uses the element when the exact path threw', async () => {
    const { fallback } = setup()
    expect(await fallback.pick('a', 0, null, true, () => element)).toBe(element)
    expect(fallback.log.reasonOf('a')).toBe('error')
  })

  it('replaces a black exact picture when the element has a real one', async () => {
    const { fallback } = setup({ black: new Set([exactFrame]) })
    expect(await fallback.pick('a', 0, exactFrame, false, () => element)).toBe(element)
    expect(fallback.log.reasonOf('a')).toBe('black')
  })

  it('keeps a black exact picture when the element is black too (a real black frame)', async () => {
    const { fallback, warn } = setup({ black: new Set([exactFrame, element]) })
    expect(await fallback.pick('a', 0, exactFrame, false, () => element)).toBe(exactFrame)
    expect(warn).not.toHaveBeenCalled()
    expect(fallback.assets).toEqual([])
  })

  it('stops comparing after a few black checks, and after the first good picture', async () => {
    const black = new Set<unknown>([exactFrame, element])
    const { fallback, showAt } = setup({ black })
    for (let i = 0; i < 6; i++) await fallback.pick('a', i, exactFrame, false, () => element)
    expect(showAt).toHaveBeenCalledTimes(3)

    const good = setup()
    await good.fallback.pick('b', 0, exactFrame, false, () => element)
    await good.fallback.pick('b', 1, exactFrame, false, () => element)
    expect(good.showAt).not.toHaveBeenCalled()
  })

  it('gives back what it has when there is no element or the element cannot show the time', async () => {
    const { fallback } = setup()
    expect(await fallback.pick('a', 0, null, false, () => null)).toBeNull()
    const failing = setup({ shown: false, black: new Set([exactFrame]) })
    expect(await failing.fallback.pick('a', 0, exactFrame, false, () => element)).toBe(exactFrame)
    expect(failing.fallback.assets).toEqual([])
  })
})

describe('ElementFallback with a broken element', () => {
  it('asks for a fresh element once when the first one died on a seek', async () => {
    const dead = { error: { message: 'seek failed' } } as unknown as HTMLVideoElement
    const alive = { error: null } as unknown as HTMLVideoElement
    const warn = vi.fn()
    const showAt = vi.fn(async (el: HTMLVideoElement) => el === alive)
    const fallback = new ElementFallback({ isBlack: () => false, showAt, warn })
    const elements = [dead, alive]
    expect(await fallback.pick('a', 0, null, false, () => elements.shift() ?? alive)).toBe(alive)
    expect(showAt).toHaveBeenCalledTimes(2)
    expect(fallback.assets).toEqual(['a'])
  })
})
