import type { Micros } from '../time'
import type { FormatRatio, Project } from './types'
import { CREDIT_FIELDS, CREDIT_MAX_LENGTH, isHttpUrl } from '../credits/credits'
import { canonicalAnimation } from '../render/animations'
import { isStickerImageId } from '../render/stickerImages'
import { animatedSticker } from '../render/stickerAnimations'
import { stickerShape } from '../render/stickerShapes'

export const CURRENT_VERSION = 1

export type ProjectResult = { ok: true; project: Project } | { ok: false; errors: string[] }

type Rec = Record<string, unknown>
type Errors = string[]

const RATIOS: readonly FormatRatio[] = ['16:9', '9:16', '1:1', '4:5']
const ASSET_KINDS = ['video', 'audio', 'image'] as const
const FIT_MODES = ['fit', 'fill'] as const
const MAX_VOLUME = 2
const OPTIONAL_LISTS = ['texts', 'overlays', 'stickers', 'drawings', 'music'] as const

const MICROS_MSG = 'must be a non-negative integer (microseconds)'
const POSITIVE_MSG = 'must be a positive number'
const FINITE_MSG = 'must be a finite number'
const STRING_MSG = 'must be a string'
const NON_EMPTY_MSG = 'must be a non-empty string'
const BOOL_MSG = 'must be a boolean'
const OBJECT_MSG = 'must be an object'
const ARRAY_MSG = 'must be an array'

export function createProject(name: string): Project {
  return {
    version: CURRENT_VERSION,
    name,
    format: { ratio: '16:9', width: 1920, height: 1080, fps: 30, background: { type: 'blur' } },
    assets: [],
    clips: [],
    texts: [],
    overlays: [],
    stickers: [],
    drawings: [],
    music: []
  }
}

/** Checks the structure of an already-current project. Does not modify the input. */
export function validateProject(value: unknown): ProjectResult {
  const errors: Errors = []
  const root = record(value, 'project', errors)
  if (!root) return { ok: false, errors }

  need(errors, root.version === CURRENT_VERSION, 'version', `must be ${CURRENT_VERSION}, got ${String(root.version)}`)
  need(errors, typeof root.name === 'string', 'name', STRING_MSG)
  validateFormat(root.format, 'format', errors)
  const assetIds = validateAssets(root.assets, 'assets', errors)
  validateClips(root.clips, 'clips', assetIds, errors)
  validateTexts(root.texts, 'texts', errors)
  validateOverlays(root.overlays, 'overlays', errors)
  arrayOf(root.stickers, 'stickers', errors)
  arrayOf(root.drawings, 'drawings', errors)
  validateMusic(root.music, 'music', assetIds, errors)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, project: value as Project }
}

/** Upgrades a project of any supported version to CURRENT_VERSION, then validates it. */
export function migrateProject(value: unknown): ProjectResult {
  if (!isRecord(value)) return { ok: false, errors: [`project ${OBJECT_MSG}`] }

  let raw: Rec
  try {
    raw = structuredClone(value)
  } catch {
    return { ok: false, errors: ['project contains values that cannot be copied'] }
  }

  const version = raw.version === undefined ? 0 : raw.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    return { ok: false, errors: [`version must be a non-negative integer, got ${String(raw.version)}`] }
  }
  if (version > CURRENT_VERSION) {
    return {
      ok: false,
      errors: [`project version ${version} is newer than supported version ${CURRENT_VERSION}; update Jelly Cut to open it`]
    }
  }

  for (let v = version; v < CURRENT_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) return { ok: false, errors: [`no migration from version ${v}`] }
    step(raw)
    raw.version = v + 1
  }
  canonicalizeAnimations(raw)
  return validateProject(raw)
}

export function parseProjectJson(text: string): ProjectResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${e instanceof Error ? e.message : String(e)}`] }
  }
  return migrateProject(data)
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2) + '\n'
}

/** Each step turns a version N document into version N+1, mutating its own (cloned) input. */
type Migration = (raw: Rec) => void

const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: legacy projects predate version tags and the optional lists.
  0: (raw) => {
    for (const key of OPTIONAL_LISTS) {
      if (raw[key] === undefined) raw[key] = []
    }
  }
}

/**
 * Renames legacy animation values in place ('slideUp' became a direction-aware name, see core/render/animations).
 * Runs for every saved file, whatever its version. Unknown names are left for validation to reject.
 */
function canonicalizeAnimations(raw: Rec): void {
  for (const key of ['texts', 'overlays'] as const) {
    const list = raw[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!isRecord(item)) continue
      for (const [field, role] of [['animIn', 'in'], ['animOut', 'out']] as const) {
        if (typeof item[field] !== 'string') continue
        const name = canonicalAnimation(item[field], role)
        if (name !== null) item[field] = name
      }
    }
  }
}

function validateFormat(value: unknown, path: string, errors: Errors): void {
  const format = record(value, path, errors)
  if (!format) return
  need(errors, RATIOS.includes(format.ratio as FormatRatio), `${path}.ratio`, `must be one of ${RATIOS.join(', ')}`)
  need(errors, isPositiveInt(format.width), `${path}.width`, 'must be a positive integer')
  need(errors, isPositiveInt(format.height), `${path}.height`, 'must be a positive integer')
  need(errors, isPositiveNumber(format.fps), `${path}.fps`, POSITIVE_MSG)
  if (format.fit !== undefined) {
    need(errors, FIT_MODES.includes(format.fit as (typeof FIT_MODES)[number]), `${path}.fit`, `must be one of ${FIT_MODES.join(', ')}`)
  }

  const bg = record(format.background, `${path}.background`, errors)
  if (!bg) return
  if (bg.type === 'color') {
    need(errors, isNonEmptyString(bg.color), `${path}.background.color`, NON_EMPTY_MSG)
  } else {
    need(errors, bg.type === 'blur', `${path}.background.type`, "must be 'blur' or 'color'")
  }
}

function validateAssets(value: unknown, path: string, errors: Errors): Set<string> {
  const ids = new Set<string>()
  arrayOf(value, path, errors).forEach((item, i) => {
    const p = `${path}[${i}]`
    const a = record(item, p, errors)
    if (!a) return
    checkId(a.id, `${p}.id`, ids, errors)
    need(errors, ASSET_KINDS.includes(a.kind as (typeof ASSET_KINDS)[number]), `${p}.kind`, `must be one of ${ASSET_KINDS.join(', ')}`)
    need(errors, typeof a.name === 'string', `${p}.name`, STRING_MSG)
    need(errors, typeof a.relPath === 'string', `${p}.relPath`, STRING_MSG)
    need(errors, isMicros(a.size), `${p}.size`, 'must be a non-negative integer (bytes)')
    need(errors, isMicros(a.duration), `${p}.duration`, MICROS_MSG)
    if (a.width !== undefined) need(errors, isPositiveInt(a.width), `${p}.width`, 'must be a positive integer')
    if (a.height !== undefined) need(errors, isPositiveInt(a.height), `${p}.height`, 'must be a positive integer')
    if (a.fps !== undefined) need(errors, isPositiveNumber(a.fps), `${p}.fps`, POSITIVE_MSG)
    if (a.credit !== undefined) validateCredit(a.credit, `${p}.credit`, errors)
  })
  return ids
}

function validateCredit(value: unknown, path: string, errors: Errors): void {
  const credit = record(value, path, errors)
  if (!credit) return
  for (const field of CREDIT_FIELDS) {
    const v = credit[field]
    if (v === undefined) continue
    need(errors, typeof v === 'string', `${path}.${field}`, STRING_MSG)
    if (typeof v !== 'string') continue
    need(errors, v.length <= CREDIT_MAX_LENGTH, `${path}.${field}`, `must be at most ${CREDIT_MAX_LENGTH} characters`)
    if (field === 'url') need(errors, isHttpUrl(v), `${path}.url`, 'must start with http:// or https://')
  }
}

function validateClips(value: unknown, path: string, assetIds: Set<string>, errors: Errors): void {
  const ids = new Set<string>()
  arrayOf(value, path, errors).forEach((item, i) => {
    const p = `${path}[${i}]`
    const c = record(item, p, errors)
    if (!c) return
    checkId(c.id, `${p}.id`, ids, errors)
    need(errors, c.track === 'video', `${p}.track`, "must be 'video'")
    need(errors, typeof c.assetId === 'string' && assetIds.has(c.assetId), `${p}.assetId`, 'must reference an existing asset')
    need(errors, isMicros(c.srcIn), `${p}.srcIn`, MICROS_MSG)
    need(errors, isMicros(c.srcOut), `${p}.srcOut`, MICROS_MSG)
    if (isMicros(c.srcIn) && isMicros(c.srcOut)) {
      need(errors, c.srcOut > c.srcIn, `${p}.srcOut`, 'must be greater than srcIn')
    }
    need(errors, isMicros(c.start), `${p}.start`, MICROS_MSG)
    need(errors, isPositiveNumber(c.speed), `${p}.speed`, POSITIVE_MSG)
    validateTransform(c.transform, `${p}.transform`, errors)
    need(errors, isVolume(c.volume), `${p}.volume`, `must be a number from 0 to ${MAX_VOLUME}`)
    need(errors, typeof c.muted === 'boolean', `${p}.muted`, BOOL_MSG)
    need(errors, c.filter === null || typeof c.filter === 'string', `${p}.filter`, 'must be a string or null')
    if (c.filterAmount !== undefined) need(errors, isUnit(c.filterAmount), `${p}.filterAmount`, 'must be a number from 0 to 1')
    if (c.adjust !== undefined) validateAdjust(c.adjust, `${p}.adjust`, errors)
    if (c.still !== undefined) need(errors, isMicros(c.still), `${p}.still`, MICROS_MSG)
    validateTransition(c.transitionIn, `${p}.transitionIn`, errors)
  })
}

function validateAdjust(value: unknown, path: string, errors: Errors): void {
  const adjust = record(value, path, errors)
  if (!adjust) return
  for (const key of ['brightness', 'contrast', 'saturation'] as const) {
    need(errors, isSigned(adjust[key]), `${path}.${key}`, 'must be a number from -1 to 1')
  }
}

function validateTransform(value: unknown, path: string, errors: Errors): void {
  const t = record(value, path, errors)
  if (!t) return
  need(errors, FIT_MODES.includes(t.fit as (typeof FIT_MODES)[number]), `${path}.fit`, `must be one of ${FIT_MODES.join(', ')}`)
  need(errors, isPositiveNumber(t.scale), `${path}.scale`, POSITIVE_MSG)
  need(errors, isFiniteNumber(t.x), `${path}.x`, FINITE_MSG)
  need(errors, isFiniteNumber(t.y), `${path}.y`, FINITE_MSG)
  need(errors, isFiniteNumber(t.rotation), `${path}.rotation`, FINITE_MSG)
  need(errors, typeof t.flipX === 'boolean', `${path}.flipX`, BOOL_MSG)
}

function validateTransition(value: unknown, path: string, errors: Errors): void {
  if (value === null) return
  const t = record(value, path, errors)
  if (!t) return
  need(errors, isNonEmptyString(t.type), `${path}.type`, NON_EMPTY_MSG)
  need(errors, isMicros(t.duration), `${path}.duration`, MICROS_MSG)
}

function validateTexts(value: unknown, path: string, errors: Errors): void {
  const ids = new Set<string>()
  arrayOf(value, path, errors).forEach((item, i) => {
    const p = `${path}[${i}]`
    const t = record(item, p, errors)
    if (!t) return
    checkId(t.id, `${p}.id`, ids, errors)
    need(errors, isMicros(t.start), `${p}.start`, MICROS_MSG)
    need(errors, isMicros(t.duration), `${p}.duration`, MICROS_MSG)
    need(errors, typeof t.text === 'string', `${p}.text`, STRING_MSG)

    const style = record(t.style, `${p}.style`, errors)
    if (style) {
      need(errors, isNonEmptyString(style.font), `${p}.style.font`, NON_EMPTY_MSG)
      need(errors, isPositiveNumber(style.size), `${p}.style.size`, POSITIVE_MSG)
      need(errors, isNonEmptyString(style.color), `${p}.style.color`, NON_EMPTY_MSG)
      need(errors, style.outline === null || typeof style.outline === 'string', `${p}.style.outline`, 'must be a string or null')
    }

    const pos = record(t.pos, `${p}.pos`, errors)
    if (pos) {
      need(errors, isFiniteNumber(pos.x), `${p}.pos.x`, FINITE_MSG)
      need(errors, isFiniteNumber(pos.y), `${p}.pos.y`, FINITE_MSG)
    }

    validateAnimation(t.animIn, 'in', `${p}.animIn`, errors)
    validateAnimation(t.animOut, 'out', `${p}.animOut`, errors)
  })
}

function validateMusic(value: unknown, path: string, assetIds: Set<string>, errors: Errors): void {
  const ids = new Set<string>()
  arrayOf(value, path, errors).forEach((item, i) => {
    const p = `${path}[${i}]`
    const m = record(item, p, errors)
    if (!m) return
    checkId(m.id, `${p}.id`, ids, errors)
    need(errors, typeof m.assetId === 'string' && assetIds.has(m.assetId), `${p}.assetId`, 'must reference an existing asset')
    need(errors, isMicros(m.start), `${p}.start`, MICROS_MSG)
    need(errors, isMicros(m.srcIn), `${p}.srcIn`, MICROS_MSG)
    need(errors, isMicros(m.srcOut), `${p}.srcOut`, MICROS_MSG)
    if (isMicros(m.srcIn) && isMicros(m.srcOut)) {
      need(errors, m.srcOut > m.srcIn, `${p}.srcOut`, 'must be greater than srcIn')
    }
    need(errors, isVolume(m.volume), `${p}.volume`, `must be a number from 0 to ${MAX_VOLUME}`)
    need(errors, isMicros(m.fadeIn), `${p}.fadeIn`, MICROS_MSG)
    need(errors, isMicros(m.fadeOut), `${p}.fadeOut`, MICROS_MSG)
    need(errors, m.muted === undefined || typeof m.muted === 'boolean', `${p}.muted`, BOOL_MSG)
  })
}

const OVERLAY_SHAPES = ['rect', 'ellipse', 'arrow'] as const
const REGION_SHAPES = ['rect', 'ellipse', 'roundRect'] as const
const REGION_EFFECTS = ['blur', 'pixelate'] as const
const OVERLAY_LOOPS = ['wiggle'] as const
const STROKE_CAPS = ['round', 'flat'] as const
const OVERLAY_KINDS = ['sticker', 'shape', 'stroke', 'region', 'media'] as const
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const MAX_EMOJI_LENGTH = 16

function validateOverlays(value: unknown, path: string, errors: Errors): void {
  const ids = new Set<string>()
  arrayOf(value, path, errors).forEach((item, i) => {
    const p = `${path}[${i}]`
    const o = record(item, p, errors)
    if (!o) return
    checkId(o.id, `${p}.id`, ids, errors)
    need(errors, isMicros(o.start), `${p}.start`, MICROS_MSG)
    need(errors, isMicros(o.duration) && o.duration > 0, `${p}.duration`, 'must be a positive integer (microseconds)')
    const pos = record(o.pos, `${p}.pos`, errors)
    if (pos) {
      need(errors, isFiniteNumber(pos.x), `${p}.pos.x`, FINITE_MSG)
      need(errors, isFiniteNumber(pos.y), `${p}.pos.y`, FINITE_MSG)
    }
    need(errors, isPositiveNumber(o.scale), `${p}.scale`, POSITIVE_MSG)
    need(errors, isFiniteNumber(o.rotation), `${p}.rotation`, FINITE_MSG)
    if (o.opacity !== undefined) need(errors, isFiniteNumber(o.opacity) && o.opacity >= 0 && o.opacity <= 1, `${p}.opacity`, 'must be a number from 0 to 1')
    validateAnimation(o.animIn, 'in', `${p}.animIn`, errors)
    validateAnimation(o.animOut, 'out', `${p}.animOut`, errors)
    if (o.loop !== undefined && o.loop !== null) need(errors, OVERLAY_LOOPS.includes(o.loop as (typeof OVERLAY_LOOPS)[number]), `${p}.loop`, `must be one of ${OVERLAY_LOOPS.join(', ')}`)

    if (o.kind === 'sticker') {
      if (o.imageId !== undefined) {
        need(errors, isStickerImageId(o.imageId), `${p}.imageId`, 'must be an id of the sticker catalog')
        need(errors, o.emoji === undefined && o.shape === undefined, `${p}.imageId`, 'cannot be combined with emoji or shape')
      } else if (o.emoji !== undefined) {
        need(errors, typeof o.emoji === 'string' && o.emoji.length > 0 && o.emoji.length <= MAX_EMOJI_LENGTH, `${p}.emoji`, `must be a string of 1 to ${MAX_EMOJI_LENGTH} characters`)
      } else {
        need(errors, typeof o.shape === 'string' && stickerShape(o.shape) !== null, `${p}.shape`, 'must be a known sticker shape (or give an emoji or imageId)')
        need(errors, typeof o.color === 'string' && HEX_COLOR.test(o.color), `${p}.color`, 'must be #RRGGBB')
        need(errors, o.outline === undefined || o.outline === null || (typeof o.outline === 'string' && HEX_COLOR.test(o.outline)), `${p}.outline`, 'must be #RRGGBB or null')
      }
      if (o.animated !== undefined) {
        need(errors, typeof o.animated === 'boolean' && animatedSticker(typeof o.imageId === 'string' ? o.imageId : undefined) !== null, `${p}.animated`, 'is only valid for a picture sticker whose id has an animation')
      }
      need(errors, isPositiveNumber(o.size), `${p}.size`, POSITIVE_MSG)
    } else if (o.kind === 'shape') {
      need(errors, OVERLAY_SHAPES.includes(o.shape as (typeof OVERLAY_SHAPES)[number]), `${p}.shape`, `must be one of ${OVERLAY_SHAPES.join(', ')}`)
      need(errors, isPositiveNumber(o.width), `${p}.width`, POSITIVE_MSG)
      need(errors, isPositiveNumber(o.height), `${p}.height`, POSITIVE_MSG)
      need(errors, isPositiveNumber(o.lineWidth), `${p}.lineWidth`, POSITIVE_MSG)
      need(errors, typeof o.color === 'string' && HEX_COLOR.test(o.color), `${p}.color`, 'must be #RRGGBB')
    } else if (o.kind === 'stroke') {
      const points = Array.isArray(o.points) ? o.points : null
      need(errors, points !== null && points.length >= 2, `${p}.points`, 'must be a list of at least two [x, y] pairs')
      points?.forEach((pt, j) => {
        need(errors, Array.isArray(pt) && pt.length === 2 && isFiniteNumber(pt[0]) && isFiniteNumber(pt[1]), `${p}.points[${j}]`, 'must be a [x, y] pair of finite numbers')
      })
      need(errors, isPositiveNumber(o.lineWidth), `${p}.lineWidth`, POSITIVE_MSG)
      need(errors, typeof o.color === 'string' && HEX_COLOR.test(o.color), `${p}.color`, 'must be #RRGGBB')
      if (o.cap !== undefined) need(errors, STROKE_CAPS.includes(o.cap as (typeof STROKE_CAPS)[number]), `${p}.cap`, `must be one of ${STROKE_CAPS.join(', ')}`)
    } else if (o.kind === 'region') {
      need(errors, REGION_SHAPES.includes(o.shape as (typeof REGION_SHAPES)[number]), `${p}.shape`, `must be one of ${REGION_SHAPES.join(', ')}`)
      need(errors, REGION_EFFECTS.includes(o.effect as (typeof REGION_EFFECTS)[number]), `${p}.effect`, `must be one of ${REGION_EFFECTS.join(', ')}`)
      need(errors, isFiniteNumber(o.strength) && o.strength >= 0 && o.strength <= 1, `${p}.strength`, 'must be a number from 0 to 1')
      need(errors, isPositiveNumber(o.width), `${p}.width`, POSITIVE_MSG)
      need(errors, isPositiveNumber(o.height), `${p}.height`, POSITIVE_MSG)
      if (o.radius !== undefined) need(errors, isFiniteNumber(o.radius) && o.radius >= 0, `${p}.radius`, 'must be a number of 0 or more')
    } else if (o.kind === 'media') {
      need(errors, typeof o.assetId === 'string' && o.assetId.length > 0, `${p}.assetId`, 'must be the id of an asset')
      need(errors, isPositiveNumber(o.width), `${p}.width`, POSITIVE_MSG)
      need(errors, isPositiveNumber(o.height), `${p}.height`, POSITIVE_MSG)
      need(errors, isFiniteNumber(o.radius) && o.radius >= 0, `${p}.radius`, 'must be a number of 0 or more')
      need(errors, isFiniteNumber(o.border) && o.border >= 0, `${p}.border`, 'must be a number of 0 or more')
      need(errors, typeof o.borderColor === 'string' && HEX_COLOR.test(o.borderColor), `${p}.borderColor`, 'must be #RRGGBB')
      if (o.srcIn !== undefined) need(errors, isMicros(o.srcIn), `${p}.srcIn`, MICROS_MSG)
      if (o.speed !== undefined) need(errors, isPositiveNumber(o.speed), `${p}.speed`, POSITIVE_MSG)
    } else {
      errors.push(`${p}.kind must be one of ${OVERLAY_KINDS.join(', ')}`)
    }
  })
}

/** Optional animation name: null or absent, or a canonical name of the role ('in' or 'out'). */
function validateAnimation(value: unknown, role: 'in' | 'out', path: string, errors: Errors): void {
  if (value === undefined || value === null) return
  const ok = typeof value === 'string' && canonicalAnimation(value, role) === value
  need(errors, ok, path, `must be null or ${role === 'in' ? 'an entrance' : 'an exit'} animation name`)
}

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Returns the value as a record, or records an error and returns null. */
function record(value: unknown, path: string, errors: Errors): Rec | null {
  if (isRecord(value)) return value
  errors.push(`${path} ${OBJECT_MSG}`)
  return null
}

function arrayOf(value: unknown, path: string, errors: Errors): unknown[] {
  if (Array.isArray(value)) return value
  errors.push(`${path} ${ARRAY_MSG}`)
  return []
}

function need(errors: Errors, ok: boolean, path: string, message: string): void {
  if (!ok) errors.push(`${path} ${message}`)
}

/** Requires a non-empty string id that has not been seen in this collection before. */
function checkId(value: unknown, path: string, seen: Set<string>, errors: Errors): void {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} ${NON_EMPTY_MSG}`)
  } else if (seen.has(value)) {
    errors.push(`${path} duplicates id "${value}"`)
  }
  if (typeof value === 'string') seen.add(value)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isPositiveNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0
}

function isMicros(v: unknown): v is Micros {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

function isUnit(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1
}

function isSigned(v: unknown): v is number {
  return isFiniteNumber(v) && v >= -1 && v <= 1
}

function isVolume(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= MAX_VOLUME
}
