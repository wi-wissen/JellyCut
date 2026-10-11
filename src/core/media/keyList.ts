import type { Micros } from '../time'

// Lookups in a sorted list of keyframe times (microseconds).

/** Last keyframe at or before `t`, or null before the first one. */
export function keyAtOrBefore(keys: readonly Micros[], t: Micros): Micros | null {
  let found: Micros | null = null
  for (const k of keys) {
    if (k > t) break
    found = k
  }
  return found
}

/** First keyframe strictly after `t`, or null when there is none. */
export function keyAfter(keys: readonly Micros[], t: Micros): Micros | null {
  for (const k of keys) {
    if (k > t) return k
  }
  return null
}

/** Keyframes in [from, to], in order. */
export function keysBetween(keys: readonly Micros[], from: Micros, to: Micros): Micros[] {
  return keys.filter((k) => k >= from && k <= to)
}
