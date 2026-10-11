import type { Asset, Project } from '../project/types'
import type { Micros } from '../time'
import { matchCandidates, type FileCandidate, type RelinkReason } from './relink'

/** Assets the timeline references. Unused media does not need to come back. */
export function usedAssetIds(project: Project): Set<string> {
  const used = new Set<string>()
  for (const clip of project.clips) used.add(clip.assetId)
  for (const item of project.music) used.add(item.assetId)
  return used
}

export interface RelinkMatch {
  candidateKey: string
  reason: RelinkReason
}

export interface RelinkPlan {
  /** Exactly one candidate per asset, and no candidate used twice. */
  matches: Record<string, RelinkMatch>
  /** Assets with several equally good candidates; the user has to choose. */
  ambiguous: Record<string, string[]>
  unmatched: string[]
  alreadyReady: string[]
}

export interface RelinkSummary {
  missing: number
  matched: number
  ambiguous: number
  unmatched: number
  alreadyReady: number
}

/**
 * Plans which candidate files belong to the used assets that are not ready yet.
 * `statusById` maps asset ids to their media status; anything but 'ready' counts as missing.
 */
export function planRelink(
  project: Project,
  statusById: Record<string, string | undefined>,
  candidates: FileCandidate[]
): RelinkPlan {
  const used = usedAssetIds(project)
  const usedAssets: Asset[] = project.assets.filter((a) => used.has(a.id))
  const alreadyReady = usedAssets.filter((a) => statusById[a.id] === 'ready').map((a) => a.id)
  const missing = usedAssets.filter((a) => statusById[a.id] !== 'ready')

  const result = matchCandidates(missing, candidates)
  const matches: RelinkPlan['matches'] = {}
  for (const m of result.matches) matches[m.assetId] = { candidateKey: m.candidateKey, reason: m.reason }
  const ambiguous: RelinkPlan['ambiguous'] = {}
  for (const a of result.ambiguous) ambiguous[a.assetId] = a.candidateKeys
  return { matches, ambiguous, unmatched: result.unmatched, alreadyReady }
}

export function describeRelinkSummary(plan: RelinkPlan): RelinkSummary {
  const matched = Object.keys(plan.matches).length
  const ambiguous = Object.keys(plan.ambiguous).length
  const unmatched = plan.unmatched.length
  return {
    missing: matched + ambiguous + unmatched,
    matched,
    ambiguous,
    unmatched,
    alreadyReady: plan.alreadyReady.length
  }
}

/** A candidate from a file's metadata. The key identifies it for the caller (file index or path). */
export function candidateFromFile(file: { name: string; size: number }, key: string, duration?: Micros): FileCandidate {
  const candidate: FileCandidate = { key, name: file.name, size: file.size }
  if (duration !== undefined) candidate.duration = duration
  return candidate
}
