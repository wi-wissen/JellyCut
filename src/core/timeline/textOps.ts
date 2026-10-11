import { CURATED_FONTS } from '../text/fonts'
import type { Project, TextItem, TextStyle } from '../project/types'
import { canonicalAnimation, type InAnimation, type OutAnimation } from '../render/animations'
import type { Micros } from '../time'
import { projectIds } from './ops'
import { editedSpan, placeSpan, videoEnd } from './fit'

export type TextPresetId = 'title' | 'subtitle' | 'neon' | 'poster' | 'script' | 'note'

export interface TextPreset {
  id: TextPresetId
  style: TextStyle
  pos: { x: number; y: number }
}

const DARK_OUTLINE = '#14121f'

/** Starting looks for new texts. Each preset supplies the style and the default position. */
export const TEXT_PRESETS: readonly TextPreset[] = [
  { id: 'title', style: { font: 'Sora', size: 96, color: '#ffffff', outline: DARK_OUTLINE }, pos: { x: 0.5, y: 0.5 } },
  { id: 'subtitle', style: { font: 'Inter', size: 56, color: '#ffffff', outline: DARK_OUTLINE }, pos: { x: 0.5, y: 0.85 } },
  { id: 'neon', style: { font: 'Fredoka', size: 80, color: '#c6f432', outline: DARK_OUTLINE }, pos: { x: 0.5, y: 0.5 } },
  { id: 'poster', style: { font: 'Bebas Neue', size: 120, color: '#ffffff', outline: null }, pos: { x: 0.5, y: 0.5 } },
  { id: 'script', style: { font: 'Pacifico', size: 80, color: '#ffffff', outline: DARK_OUTLINE }, pos: { x: 0.5, y: 0.5 } },
  { id: 'note', style: { font: 'Caveat', size: 72, color: '#ffe066', outline: DARK_OUTLINE }, pos: { x: 0.5, y: 0.5 } }
]

export const DEFAULT_TEXT_DURATION: Micros = 3_000_000
const MIN_TEXT_DURATION: Micros = 100_000
const MIN_SIZE = 8
const MAX_SIZE = 400
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const FONT_FAMILIES = CURATED_FONTS.map((f) => f.family)

export interface TextInit {
  text?: string
  preset?: TextPresetId
  pos?: { x: number; y: number }
  duration?: Micros
}

export interface TextPatch {
  text?: string
  style?: Partial<TextStyle>
  pos?: Partial<{ x: number; y: number }>
  animIn?: InAnimation | null
  animOut?: OutAnimation | null
  start?: Micros
  duration?: Micros
}

export function textPreset(id: TextPresetId): TextPreset {
  return TEXT_PRESETS.find((p) => p.id === id) ?? TEXT_PRESETS[0]!
}

/**
 * Adds a text item at `start` (clamped to 0) and returns the project with it. The style and
 * default position come from the preset (Title unless given). Ids that already exist are refused.
 */
export function addText(project: Project, newId: string, start: Micros, init: TextInit = {}): Project {
  if (!Number.isFinite(start) || newId.length === 0) return project
  if (projectIds(project).has(newId)) return project
  const preset = textPreset(init.preset ?? 'title')
  const span = placeSpan(start, clampDuration(init.duration ?? DEFAULT_TEXT_DURATION), videoEnd(project))
  const item: TextItem = {
    id: newId,
    ...span,
    text: init.text ?? 'Text',
    style: { ...preset.style },
    pos: { ...(init.pos ?? preset.pos) },
    animIn: null,
    animOut: null
  }
  return { ...project, texts: [...project.texts, item] }
}

/**
 * Patches one text item. Values are clamped (duration >= 0.1 s, start >= 0, size 8..400, position
 * 0..1). Invalid values (non-finite numbers, unknown fonts, colours that are not #RRGGBB, unknown
 * animations) reject the whole patch and return the project unchanged.
 */
export function updateText(project: Project, id: string, patch: TextPatch): Project {
  const target = project.texts.find((t) => t.id === id)
  if (!target) return project
  const next = applyTextPatch(target, patch)
  if (!next) return project
  const fitted = { ...next, ...editedSpan(next, patch, videoEnd(project)) }
  const texts = project.texts.map((t) => (t.id === id ? fitted : t))
  return JSON.stringify(texts) === JSON.stringify(project.texts) ? project : { ...project, texts }
}

function applyTextPatch(item: TextItem, patch: TextPatch): TextItem | null {
  const next: TextItem = { ...item, style: { ...item.style }, pos: { ...item.pos } }
  if (patch.text !== undefined) {
    if (typeof patch.text !== 'string') return null
    next.text = patch.text
  }
  if (patch.style !== undefined) {
    const style = patch.style
    if (style.font !== undefined) {
      if (!FONT_FAMILIES.includes(style.font)) return null
      next.style.font = style.font
    }
    if (style.size !== undefined) {
      if (!Number.isFinite(style.size)) return null
      next.style.size = clamp(style.size, MIN_SIZE, MAX_SIZE)
    }
    if (style.color !== undefined) {
      if (!HEX_COLOR.test(style.color)) return null
      next.style.color = style.color.toLowerCase()
    }
    if (style.outline !== undefined) {
      if (style.outline !== null && !HEX_COLOR.test(style.outline)) return null
      next.style.outline = style.outline === null ? null : style.outline.toLowerCase()
    }
  }
  if (patch.pos !== undefined) {
    const { x, y } = patch.pos
    if ((x !== undefined && !Number.isFinite(x)) || (y !== undefined && !Number.isFinite(y))) return null
    if (x !== undefined) next.pos.x = clamp(x, 0, 1)
    if (y !== undefined) next.pos.y = clamp(y, 0, 1)
  }
  if (patch.animIn !== undefined) {
    if (patch.animIn !== null && canonicalAnimation(patch.animIn, 'in') !== patch.animIn) return null
    next.animIn = patch.animIn
  }
  if (patch.animOut !== undefined) {
    if (patch.animOut !== null && canonicalAnimation(patch.animOut, 'out') !== patch.animOut) return null
    next.animOut = patch.animOut
  }
  if (patch.start !== undefined) {
    if (!Number.isFinite(patch.start)) return null
    next.start = Math.max(0, Math.round(patch.start))
  }
  if (patch.duration !== undefined) {
    if (!Number.isFinite(patch.duration)) return null
    next.duration = clampDuration(patch.duration)
  }
  return next
}

function clampDuration(d: Micros): Micros {
  return Math.max(MIN_TEXT_DURATION, Math.round(Number.isFinite(d) ? d : MIN_TEXT_DURATION))
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
