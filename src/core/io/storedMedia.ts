import type { Asset, Project } from '../project/types'

/** Keys of copies in the browser's private storage: random, URL-safe, never derived from a file name. */
export const STORE_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** What a stored copy is known by, kept next to the bytes. */
export interface StoredMediaInfo {
  key: string
  name: string
  size: number
  type: string
  savedAt: number
}

export function storeKeysOf(project: Pick<Project, 'assets'> | null | undefined): Set<string> {
  const keys = new Set<string>()
  for (const asset of project?.assets ?? []) if (asset.storeKey) keys.add(asset.storeKey)
  return keys
}

/** Stored copies nobody refers to any more and that are old enough not to belong to a session that is still saving. */
export function planSweep(stored: readonly StoredMediaInfo[], referenced: ReadonlySet<string>, now: number, graceMs: number): string[] {
  return stored.filter((s) => !referenced.has(s.key) && now - s.savedAt >= graceMs).map((s) => s.key)
}

/** Keys that were in `before` but are not in `after`: the copies a replaced document no longer needs. */
export function droppedKeys(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return [...before].filter((key) => !after.has(key))
}

export type MissingKind = 'recording' | 'example' | 'file'

/** Which wording a missing medium gets: recordings and example videos have no original on disk. */
export function missingKind(asset: Pick<Asset, 'origin'>): MissingKind {
  return asset.origin ?? 'file'
}
