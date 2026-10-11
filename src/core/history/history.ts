/**
 * Generic immutable undo/redo history.
 *
 * Callers must pass new immutable objects to `commit` (never mutate a state that
 * was already committed), because past/present/future share structure.
 *
 * `past` and `future` are stacks: the last element is the nearest state
 * (`past[past.length - 1]` is what undo returns to, `future[future.length - 1]`
 * is what redo returns to).
 */
export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
  /** Key of the last keyed commit; a commit with the same key is merged into the current step. */
  lastKey: string | null
}

export interface CommitOptions {
  key?: string
}

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [], lastKey: null }
}

export function commit<T>(h: HistoryState<T>, next: T, options?: CommitOptions): HistoryState<T> {
  if (next === h.present) {
    return h
  }
  const key = options?.key ?? null
  const coalesce = key !== null && key === h.lastKey
  return {
    past: coalesce ? h.past : [...h.past, h.present],
    present: next,
    future: [],
    lastKey: key,
  }
}

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) {
    return h
  }
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1] as T,
    future: [...h.future, h.present],
    lastKey: null,
  }
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) {
    return h
  }
  return {
    past: [...h.past, h.present],
    present: h.future[h.future.length - 1] as T,
    future: h.future.slice(0, -1),
    lastKey: null,
  }
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0
}

/** Ends the current coalescing run, e.g. on pointer-up, so the next keyed commit starts a new step. */
export function breakCoalescing<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.lastKey === null) {
    return h
  }
  return { ...h, lastKey: null }
}
