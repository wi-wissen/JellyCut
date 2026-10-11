import type { MusicItem } from '../project/types'
import type { Micros } from '../time'

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Gain (0..1+) of a music item at timeline time `t`, including linear fade in and fade out. */
export function musicGain(item: MusicItem, t: Micros): number {
  const length = item.srcOut - item.srcIn
  const local = t - item.start
  if (local < 0 || local >= length) return 0
  let gain = item.volume
  if (item.fadeIn > 0 && local < item.fadeIn) gain *= clamp01(local / item.fadeIn)
  const remaining = length - local
  if (item.fadeOut > 0 && remaining < item.fadeOut) gain *= clamp01(remaining / item.fadeOut)
  return gain
}
