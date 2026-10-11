import { describe, expect, it } from 'vitest'
import {
  breakCoalescing,
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  undo,
  type HistoryState,
} from './history'

function deepFreeze<V>(value: V): V {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('history', () => {
  it('creates an empty history with the initial present', () => {
    const h = createHistory('a')
    expect(h).toEqual({ past: [], present: 'a', future: [], lastKey: null })
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('round-trips commit, undo and redo', () => {
    let h = createHistory(0)
    h = commit(h, 1)
    h = commit(h, 2)
    expect(h.present).toBe(2)
    expect(canUndo(h)).toBe(true)

    h = undo(h)
    expect(h.present).toBe(1)
    h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(true)

    h = redo(h)
    expect(h.present).toBe(1)
    h = redo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(false)
  })

  it('clears the redo stack after a new commit', () => {
    let h = createHistory('a')
    h = commit(h, 'b')
    h = commit(h, 'c')
    h = undo(h)
    expect(canRedo(h)).toBe(true)

    h = commit(h, 'd')
    expect(canRedo(h)).toBe(false)
    expect(h.future).toEqual([])
    expect(redo(h)).toBe(h)
    expect(h.present).toBe('d')
  })

  it('treats a commit of the same reference as a no-op', () => {
    const obj = { v: 1 }
    const h = commit(createHistory(obj), obj)
    expect(h.past).toEqual([])
    const h2 = commit(createHistory(obj), { v: 1 })
    expect(h2.past).toHaveLength(1)

    const same = createHistory(obj)
    expect(commit(same, obj, { key: 'k' })).toBe(same)
  })

  it('returns the same object from undo and redo at the boundaries', () => {
    const h = createHistory('a')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)

    const h2 = undo(commit(h, 'b'))
    expect(undo(h2)).toBe(h2)
    const h3 = redo(commit(h, 'b'))
    expect(redo(h3)).toBe(h3)
  })

  it('coalesces commits with the same key into one undo step', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 100; i++) {
      h = commit(h, i, { key: 'slider' })
    }
    expect(h.present).toBe(100)
    expect(h.past).toEqual([0])
    expect(h.lastKey).toBe('slider')

    h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
  })

  it('does not coalesce commits with different keys', () => {
    let h = createHistory(0)
    h = commit(h, 1, { key: 'a' })
    h = commit(h, 2, { key: 'b' })
    h = commit(h, 3, { key: 'b' })
    expect(h.past).toEqual([0, 1])
    expect(h.present).toBe(3)
  })

  it('starts a new step when a keyed commit follows a keyless commit', () => {
    let h = createHistory(0)
    h = commit(h, 1, { key: 'a' })
    h = commit(h, 2)
    expect(h.lastKey).toBeNull()
    h = commit(h, 3, { key: 'a' })
    expect(h.past).toEqual([0, 1, 2])
    expect(h.present).toBe(3)
  })

  it('does not coalesce keyless commits', () => {
    let h = createHistory(0)
    h = commit(h, 1)
    h = commit(h, 2)
    expect(h.past).toEqual([0, 1])
  })

  it('starts a new step when the same key is committed after an undo', () => {
    let h = createHistory(0)
    h = commit(h, 1, { key: 'a' })
    h = commit(h, 2, { key: 'a' })
    h = undo(h)
    expect(h.lastKey).toBeNull()
    h = commit(h, 5, { key: 'a' })
    expect(h.past).toEqual([0])
    expect(h.present).toBe(5)
    expect(canRedo(h)).toBe(false)
    h = undo(h)
    expect(h.present).toBe(0)
  })

  it('starts a new step after redo resets coalescing', () => {
    let h = createHistory(0)
    h = commit(h, 1, { key: 'a' })
    h = undo(h)
    h = redo(h)
    expect(h.lastKey).toBeNull()
    h = commit(h, 2, { key: 'a' })
    expect(h.past).toEqual([0, 1])
  })

  it('breakCoalescing makes the next keyed commit a new step', () => {
    let h = createHistory(0)
    h = commit(h, 1, { key: 'a' })
    h = commit(h, 2, { key: 'a' })
    const broken = breakCoalescing(h)
    expect(broken.lastKey).toBeNull()
    expect(broken.present).toBe(2)
    expect(broken.past).toBe(h.past)

    const next = commit(broken, 3, { key: 'a' })
    expect(next.past).toEqual([0, 2])
    expect(next.present).toBe(3)
  })

  it('breakCoalescing returns the same object when nothing is coalescing', () => {
    const h = createHistory(0)
    expect(breakCoalescing(h)).toBe(h)
  })

  it('never mutates frozen inputs', () => {
    const start = deepFreeze(createHistory({ n: 0 }))
    const snapshot = structuredClone(start)

    const steps: Array<(h: HistoryState<{ n: number }>) => HistoryState<{ n: number }>> = [
      (h) => commit(h, { n: 1 }),
      (h) => commit(h, { n: 2 }, { key: 'k' }),
      (h) => commit(h, { n: 3 }, { key: 'k' }),
      (h) => undo(h),
      (h) => redo(h),
      (h) => breakCoalescing(h),
      (h) => commit(h, { n: 4 }),
    ]

    let h: HistoryState<{ n: number }> = deepFreeze(start)
    for (const step of steps) {
      h = deepFreeze(step(h))
    }
    expect(start).toEqual(snapshot)
    expect(h.present).toEqual({ n: 4 })
    expect(() => undo(deepFreeze(commit(start, { n: 9 })))).not.toThrow()
  })

  it('matches a simple reference model over 500 seeded random operations', () => {
    type Obj = { id: number }
    const random = mulberry32(20260424)
    const pick = <V>(items: readonly V[]): V => items[Math.floor(random() * items.length)] as V
    const keys = [undefined, 'a', 'b'] as const

    // Reference: a linear timeline with a cursor. Coalescing overwrites the current entry.
    let timeline: Obj[] = [{ id: 0 }]
    let index = 0
    let refKey: string | null = null
    let nextId = 1

    let h: HistoryState<Obj> = createHistory(timeline[0] as Obj)

    const expectSame = (step: number): void => {
      const ids = (xs: Obj[]): number[] => xs.map((x) => x.id)
      expect({
        past: ids(h.past),
        present: h.present.id,
        future: ids(h.future),
        lastKey: h.lastKey,
      }, `step ${step}`).toEqual({
        past: ids(timeline.slice(0, index)),
        present: timeline[index]?.id,
        future: ids(timeline.slice(index + 1).reverse()),
        lastKey: refKey,
      })
      expect(canUndo(h), `canUndo at ${step}`).toBe(index > 0)
      expect(canRedo(h), `canRedo at ${step}`).toBe(index < timeline.length - 1)
    }

    for (let step = 0; step < 500; step++) {
      const op = random()

      if (op < 0.1) {
        // Commit the same reference: must be a no-op.
        const before = h
        h = commit(h, h.present)
        expect(h).toBe(before)
      } else if (op < 0.6) {
        const key = pick(keys)
        const next: Obj = { id: nextId++ }
        const options = key === undefined ? undefined : { key }
        h = commit(h, next, options)
        if (key !== undefined && key === refKey) {
          timeline[index] = next
        } else {
          timeline = [...timeline.slice(0, index + 1), next]
          index++
        }
        refKey = key ?? null
        expect(h.present).toBe(next)
      } else if (op < 0.75) {
        // At the boundary undo returns h unchanged, so lastKey survives.
        h = undo(h)
        if (index > 0) {
          index--
          refKey = null
        }
      } else if (op < 0.9) {
        h = redo(h)
        if (index < timeline.length - 1) {
          index++
          refKey = null
        }
      } else {
        h = breakCoalescing(h)
        refKey = null
      }

      expectSame(step)
    }
  })
})
