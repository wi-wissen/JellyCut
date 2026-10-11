import type { Project } from '../project/types'
import { planTimeline } from '../render/scene'
import { MICROS_PER_SECOND, type Micros } from '../time'

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

/**
 * Length of the export: the video clips, transitions included. Music, texts and overlays never extend it,
 * they are cut at the video end (core/timeline/fit).
 */
export function exportDuration(project: Project): Micros {
  return planTimeline(project).duration
}

/** Timecode-style length: "m:ss", or "h:mm:ss" from one hour on. Fractions are cut off. */
export function formatClock(micros: Micros): string {
  const total = Math.max(0, Math.floor(micros / MICROS_PER_SECOND))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours === 0) return `${minutes}:${ss}`
  return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
}

/** Size in KB, MB or GB (binary steps). One decimal only for GB. */
export function formatBytes(bytes: number, locale: string): string {
  const safe = Math.max(0, bytes)
  if (safe >= GB) {
    return `${number(safe / GB, 1, locale)} GB`
  }
  if (safe >= MB) {
    return `${number(safe / MB, 0, locale)} MB`
  }
  return `${number(safe / KB, 0, locale)} KB`
}

function number(value: number, fractionDigits: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value)
}

export type EtaText = { unit: 'none' } | { unit: 'seconds'; value: number } | { unit: 'minutes'; value: number }

/** Remaining time as a unit and a rounded value, for the caller to phrase in its language. */
export function formatEta(ms: number | null): EtaText {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return { unit: 'none' }
  if (ms < 60_000) return { unit: 'seconds', value: Math.max(1, Math.ceil(ms / 1000)) }
  return { unit: 'minutes', value: Math.max(1, Math.round(ms / 60_000)) }
}

export type AssetStatusMap = Record<string, 'ready' | 'missing' | 'unsupported'>

/** Names of the assets that clips or music items use while they are not ready, in project order. */
export function missingAssetsInUse(project: Project, statusById: AssetStatusMap): string[] {
  const used = new Set<string>([...project.clips.map((c) => c.assetId), ...project.music.map((m) => m.assetId)])
  return project.assets
    .filter((asset) => used.has(asset.id) && statusById[asset.id] !== 'ready')
    .map((asset) => asset.name)
}
