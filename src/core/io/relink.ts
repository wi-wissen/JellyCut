import type { Asset } from '../project/types'
import type { Micros } from '../time'

/** A file the user picked while relinking missing media. */
export interface FileCandidate {
  key: string
  name: string
  size: number
  /** Only known for media that has been probed. */
  duration?: Micros
}

export type RelinkReason = 'name-size' | 'size-duration'

export interface RelinkMatch {
  assetId: string
  candidateKey: string
  reason: RelinkReason
}

export interface RelinkResult {
  matches: RelinkMatch[]
  unmatched: string[]
  ambiguous: { assetId: string; candidateKeys: string[] }[]
}

const DURATION_TOLERANCE: Micros = 1000

function baseName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name
}

function nameKey(name: string): string {
  return baseName(name).toLowerCase()
}

function candidatesFor(asset: Asset, candidates: FileCandidate[]): { reason: RelinkReason; keys: string[] } | null {
  const sameNameSize = candidates.filter(
    (c) => c.size === asset.size && nameKey(c.name) === nameKey(asset.name)
  )
  if (sameNameSize.length > 0) {
    return { reason: 'name-size', keys: sameNameSize.map((c) => c.key) }
  }
  if (asset.kind === 'image' || asset.duration <= 0) return null
  const sameSizeDuration = candidates.filter(
    (c) =>
      c.size === asset.size &&
      c.duration !== undefined &&
      Math.abs(c.duration - asset.duration) <= DURATION_TOLERANCE
  )
  if (sameSizeDuration.length > 0) {
    return { reason: 'size-duration', keys: sameSizeDuration.map((c) => c.key) }
  }
  return null
}

export function matchCandidates(assets: Asset[], candidates: FileCandidate[]): RelinkResult {
  type Pick = { assetId: string; reason: RelinkReason; keys: string[] }
  const picks: (Pick | null)[] = assets.map((asset) => {
    const found = candidatesFor(asset, candidates)
    return found ? { assetId: asset.id, ...found } : null
  })

  // Count how many assets want each candidate, so one file never goes to two assets.
  const claims = new Map<string, number>()
  for (const pick of picks) {
    if (pick && pick.keys.length === 1) {
      const key = pick.keys[0]!
      claims.set(key, (claims.get(key) ?? 0) + 1)
    }
  }

  const result: RelinkResult = { matches: [], unmatched: [], ambiguous: [] }
  assets.forEach((asset, i) => {
    const pick = picks[i]
    if (!pick) {
      result.unmatched.push(asset.id)
      return
    }
    if (pick.keys.length > 1) {
      result.ambiguous.push({ assetId: asset.id, candidateKeys: pick.keys })
      return
    }
    const key = pick.keys[0]!
    if ((claims.get(key) ?? 0) > 1) {
      result.ambiguous.push({ assetId: asset.id, candidateKeys: [key] })
      return
    }
    result.matches.push({ assetId: asset.id, candidateKey: key, reason: pick.reason })
  })
  return result
}
