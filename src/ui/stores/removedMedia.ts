/** Most removed assets kept for undo; the oldest is dropped first. */
export const REMOVED_MEDIA_LIMIT = 20

/** Insertion-ordered map with a size limit: putting a new entry past the limit drops the oldest one. */
export class RemovedMediaCache<T> {
  private readonly entries = new Map<string, T>()

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.entries.size
  }

  ids(): string[] {
    return [...this.entries.keys()]
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  /** Returns the entries that fell out because of the limit, oldest first, so the caller can free what they hold. */
  put(id: string, entry: T): [string, T][] {
    this.entries.delete(id)
    this.entries.set(id, entry)
    const dropped: [string, T][] = []
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      dropped.push([oldest, this.entries.get(oldest) as T])
      this.entries.delete(oldest)
    }
    return dropped
  }

  take(id: string): T | undefined {
    const entry = this.entries.get(id)
    this.entries.delete(id)
    return entry
  }

  /** Empties the cache and returns what it held. */
  clear(): [string, T][] {
    const all = [...this.entries]
    this.entries.clear()
    return all
  }
}

/**
 * Which removed media comes back and which live media leaves, given the assets of the project now.
 * `restore`: assets in the project whose file is cached and not live. `evict`: live ids no longer in the project.
 */
export function planReconcile(
  projectAssetIds: readonly string[],
  liveIds: Iterable<string>,
  cachedIds: Iterable<string>
): { restore: string[]; evict: string[] } {
  const inProject = new Set(projectAssetIds)
  const live = new Set(liveIds)
  const cached = new Set(cachedIds)
  return {
    restore: projectAssetIds.filter((id) => cached.has(id) && !live.has(id)),
    evict: [...live].filter((id) => !inProject.has(id))
  }
}
