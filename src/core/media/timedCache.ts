import type { Micros } from '../time'

export interface TimedEntry<V> {
  start: Micros
  end: Micros
  value: V
  bytes: number
}

interface Stored<V> extends TimedEntry<V> {
  group: string
}

/**
 * Byte-bounded LRU of values that cover a time span (decoded frames). Entries are grouped (one group per asset);
 * lookups by time are a binary search in the group's sorted starts, so a hit costs microseconds even with thousands
 * of entries. The least recently used entry goes first when the byte budget is exceeded; the newest one always stays.
 */
export class TimedCache<V> {
  private lru = new Map<string, Stored<V>>()
  private starts = new Map<string, Micros[]>()
  private used = 0

  constructor(readonly capBytes: number) {}

  get bytes(): number {
    return this.used
  }

  get size(): number {
    return this.lru.size
  }

  private static key(group: string, start: Micros): string {
    return `${group}|${start}`
  }

  put(group: string, start: Micros, end: Micros, value: V, bytes: number): void {
    const key = TimedCache.key(group, start)
    const old = this.lru.get(key)
    if (old) this.remove(key, old)
    this.lru.set(key, { group, start, end, value, bytes })
    this.used += bytes
    const list = this.starts.get(group) ?? []
    list.splice(this.lowerBound(list, start), 0, start)
    this.starts.set(group, list)
    while (this.used > this.capBytes && this.lru.size > 1) {
      const [oldestKey, oldest] = this.lru.entries().next().value as [string, Stored<V>]
      this.remove(oldestKey, oldest)
    }
  }

  /** The entry covering `t` (start <= t < end), marked as recently used; null when there is none. */
  at(group: string, t: Micros): TimedEntry<V> | null {
    const entry = this.find(group, t)
    if (!entry) return null
    const key = TimedCache.key(group, entry.start)
    this.lru.delete(key)
    this.lru.set(key, entry)
    return entry
  }

  /** Like `at` but leaves the usage order alone. */
  has(group: string, t: Micros): boolean {
    return this.find(group, t) !== null
  }

  dropGroup(group: string): void {
    for (const start of this.starts.get(group) ?? []) {
      const key = TimedCache.key(group, start)
      const entry = this.lru.get(key)
      if (entry) {
        this.used -= entry.bytes
        this.lru.delete(key)
      }
    }
    this.starts.delete(group)
  }

  clear(): void {
    this.lru.clear()
    this.starts.clear()
    this.used = 0
  }

  private find(group: string, t: Micros): Stored<V> | null {
    const list = this.starts.get(group)
    if (!list || list.length === 0) return null
    const index = this.lowerBound(list, t + 1) - 1
    if (index < 0) return null
    const entry = this.lru.get(TimedCache.key(group, list[index]!))
    return entry && t < entry.end ? entry : null
  }

  private remove(key: string, entry: Stored<V>): void {
    this.lru.delete(key)
    this.used -= entry.bytes
    const list = this.starts.get(entry.group)
    if (!list) return
    const i = this.lowerBound(list, entry.start)
    if (list[i] === entry.start) list.splice(i, 1)
    if (list.length === 0) this.starts.delete(entry.group)
  }

  /** Index of the first element >= value. */
  private lowerBound(list: readonly Micros[], value: Micros): number {
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (list[mid]! < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
