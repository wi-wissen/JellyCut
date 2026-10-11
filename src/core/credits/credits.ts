import type { Asset, AssetCredit, Project } from '../project/types'

export interface License {
  id: string
  name: string
  /** Whether a medium under this licence must be credited. */
  needsAttribution: boolean
  /** Official licence text. Null when there is none to link to. */
  url: string | null
}

export const LICENSES: readonly License[] = [
  { id: 'cc0-1.0', name: 'CC0 1.0', needsAttribution: false, url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { id: 'cc-by-4.0', name: 'CC BY 4.0', needsAttribution: true, url: 'https://creativecommons.org/licenses/by/4.0/' },
  { id: 'cc-by-sa-4.0', name: 'CC BY-SA 4.0', needsAttribution: true, url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  { id: 'public-domain', name: 'Public domain', needsAttribution: false, url: null },
  { id: 'pixabay', name: 'Pixabay Content License', needsAttribution: true, url: 'https://pixabay.com/service/license-summary/' },
  { id: 'pexels', name: 'Pexels License', needsAttribution: true, url: 'https://www.pexels.com/license/' },
  { id: 'unsplash', name: 'Unsplash License', needsAttribution: true, url: 'https://unsplash.com/license' },
  { id: 'own-work', name: 'Own work', needsAttribution: false, url: null },
  { id: 'other', name: 'Other', needsAttribution: true, url: null }
]

export type CreditStatus = 'complete' | 'missing' | 'not-needed'
export type CreditField = keyof AssetCredit
export type CreditLocale = 'de' | 'en'
/** A field set to a string is stored; '' or null removes it; undefined leaves it unchanged. */
export type CreditPatch = Partial<Record<CreditField, string | null>>

export const CREDIT_FIELDS: readonly CreditField[] = ['title', 'author', 'source', 'url', 'license']
export const CREDIT_MAX_LENGTH = 300

const LABELS: Record<CreditLocale, { by: string; source: string; licence: string; other: string; images: string; music: string; edited: string }> = {
  en: { by: 'by', source: 'source', licence: 'licence', other: 'Other', images: 'Images and videos', music: 'Music', edited: 'Edited with Jelly Cut' },
  de: { by: 'von', source: 'Quelle', licence: 'Lizenz', other: 'Sonstige', images: 'Bilder und Videos', music: 'Musik', edited: 'Bearbeitet mit Jelly Cut' }
}

// C0 and C1 control characters plus the Unicode line and paragraph separators.
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g

export function licenseById(id: string | undefined): License | undefined {
  return id === undefined ? undefined : LICENSES.find((l) => l.id === id)
}

/** True for an absolute http or https address. The address is only checked, never opened or fetched. */
export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}

/** Replaces control characters by spaces, collapses whitespace and trims. */
export function cleanText(value: string | undefined | null): string {
  return (value ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/** Assets referenced by a video clip or a music item, in project order, each once. */
export function assetsInUse(project: Project): Asset[] {
  const used = new Set<string>([...project.clips.map((c) => c.assetId), ...project.music.map((m) => m.assetId)])
  return project.assets.filter((a) => used.has(a.id))
}

/** Used media whose licence requires a credit line. Unlicensed media are not counted: their licence is unknown. */
export function assetsNeedingCredit(project: Project): Asset[] {
  return assetsInUse(project).filter((a) => licenseById(a.credit?.license)?.needsAttribution === true)
}

/**
 * 'not-needed' for licences that need no credit (own work, CC0, public domain). 'complete' when a
 * licence that needs credit comes with title, author, a source or link. Everything else, including
 * a missing licence, is 'missing'.
 */
export function creditStatus(asset: Asset): CreditStatus {
  const license = licenseById(asset.credit?.license)
  if (!license) return 'missing'
  if (!license.needsAttribution) return 'not-needed'
  const credit = asset.credit ?? {}
  const hasDetails =
    cleanText(credit.title) !== '' && cleanText(credit.author) !== '' && (cleanText(credit.source) !== '' || cleanText(credit.url) !== '')
  return hasDetails ? 'complete' : 'missing'
}

/**
 * Sets, changes or removes credit fields of one asset. Text is stored as typed (only cleaned for
 * output), so typing spaces works in a controlled input. An invalid url is ignored, and the UI
 * shows why. Returns the same project when nothing changes.
 */
export function patchAssetCredit(project: Project, assetId: string, patch: CreditPatch): Project {
  const index = project.assets.findIndex((a) => a.id === assetId)
  const asset = project.assets[index]
  if (!asset) return project

  const credit: Record<string, string> = { ...(asset.credit ?? {}) }
  for (const field of CREDIT_FIELDS) {
    if (!(field in patch)) continue
    const raw = patch[field] ?? ''
    if (raw === '') {
      delete credit[field]
      continue
    }
    if (field === 'url' && !isHttpUrl(raw)) continue
    credit[field] = raw.slice(0, CREDIT_MAX_LENGTH)
  }

  const next: AssetCredit | undefined = Object.keys(credit).length > 0 ? (credit as AssetCredit) : undefined
  if (sameCredit(asset.credit, next)) return project

  const assets = project.assets.map((a, i) => {
    if (i !== index) return a
    const updated: Asset = { ...a }
    if (next) updated.credit = next
    else delete updated.credit
    return updated
  })
  return { ...project, assets }
}

function sameCredit(a: AssetCredit | undefined, b: AssetCredit | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keysA = Object.keys(a) as CreditField[]
  if (keysA.length !== Object.keys(b).length) return false
  return keysA.every((key) => a[key] === b[key])
}

/** One TASL line: "Title by Author, source: Source (URL), licence: CC BY 4.0 (licence URL)". Missing parts are left out. */
export function creditLine(asset: Asset, locale: CreditLocale): string {
  const labels = LABELS[locale]
  const credit = asset.credit ?? {}
  const title = cleanText(credit.title) || cleanText(asset.name)
  const author = cleanText(credit.author)
  const source = cleanText(credit.source)
  const url = (credit.url ?? '').replace(/\s+/g, '')
  const license = licenseById(credit.license)

  const parts: string[] = []
  if (title) parts.push(author ? `${title} ${labels.by} ${author}` : title)
  else if (author) parts.push(author)

  const link = isHttpUrl(url) ? url : ''
  if (source || link) {
    const sourcePart = source && link ? `${source} (${link})` : source || link
    parts.push(`${labels.source}: ${sourcePart}`)
  }

  if (license) {
    const name = license.id === 'other' ? labels.other : license.name
    parts.push(`${labels.licence}: ${name}${license.url ? ` (${license.url})` : ''}`)
  }

  return parts.join(', ')
}

/**
 * The text for the video description or closing slide: one line per used medium that needs credit,
 * grouped by kind, then a closing line. Empty when nothing needs credit.
 */
export function generateCreditsText(project: Project, locale: CreditLocale): string {
  const labels = LABELS[locale]
  const images: string[] = []
  const music: string[] = []
  for (const asset of assetsInUse(project)) {
    if (creditStatus(asset) === 'not-needed') continue
    const line = creditLine(asset, locale)
    if (line === '') continue
    if (asset.kind === 'audio') music.push(line)
    else images.push(line)
  }

  const blocks: string[] = []
  if (images.length > 0) blocks.push([labels.images, ...images].join('\n'))
  if (music.length > 0) blocks.push([labels.music, ...music].join('\n'))
  if (blocks.length === 0) return ''
  return [...blocks, labels.edited].join('\n\n')
}
