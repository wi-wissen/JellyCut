import type { OverlayItem, Project, ShapeOverlay, StickerOverlay, StrokeOverlay } from '../project/types'
import type { Micros } from '../time'
import { DEFAULT_OVERLAY_DURATION, DEFAULT_SHAPE_SIZE, DEFAULT_STICKER_SIZE, LINE_WIDTHS, type LineWidthId } from './overlayCatalog'

export const MIN_OVERLAY_DURATION: Micros = 100_000
const MIN_SCALE = 0.1
const MAX_SCALE = 10
const MIN_STICKER_SIZE = 0.02
const MAX_STICKER_SIZE = 0.6
const MIN_SHAPE_SIDE = 0.01
const MAX_SHAPE_SIDE = 2
const MIN_LINE_WIDTH = 0.001
const MAX_LINE_WIDTH = 0.05
/** Points closer than this (output-height units) to the last kept point are dropped; keeps stroke data small. */
const MIN_POINT_GAP = 0.002
const MAX_EMOJI_LENGTH = 16
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Only the fields that apply to the item's kind may be set; any other field rejects the patch. */
export interface OverlayPatch {
  start?: Micros
  duration?: Micros
  pos?: Partial<{ x: number; y: number }>
  scale?: number
  rotation?: number
  size?: number
  width?: number
  height?: number
  lineWidth?: number
  color?: string
}

/** Pointer position as a fraction of the output (x of the width, y of the height). */
export interface StrokePoint {
  x: number
  y: number
}

/** Adds a sticker centred on `pos` (default: centre of the picture). Refused for existing ids or an empty emoji. */
export function addSticker(project: Project, newId: string, start: Micros, emoji: string, pos = { x: 0.5, y: 0.5 }): Project {
  if (!validId(project, newId) || !Number.isFinite(start)) return project
  if (emoji.length === 0 || emoji.length > MAX_EMOJI_LENGTH || emoji.trim() !== emoji) return project
  const item: StickerOverlay = {
    id: newId,
    kind: 'sticker',
    start: Math.max(0, Math.round(start)),
    duration: DEFAULT_OVERLAY_DURATION,
    pos: clampPos(pos),
    scale: 1,
    rotation: 0,
    emoji,
    size: DEFAULT_STICKER_SIZE
  }
  return { ...project, overlays: [...project.overlays, item] }
}

export function addShape(
  project: Project,
  newId: string,
  start: Micros,
  shape: ShapeOverlay['shape'],
  color: string,
  pos = { x: 0.5, y: 0.5 }
): Project {
  if (!validId(project, newId) || !Number.isFinite(start) || !HEX_COLOR.test(color)) return project
  const item: ShapeOverlay = {
    id: newId,
    kind: 'shape',
    start: Math.max(0, Math.round(start)),
    duration: DEFAULT_OVERLAY_DURATION,
    pos: clampPos(pos),
    scale: 1,
    rotation: 0,
    shape,
    width: DEFAULT_SHAPE_SIZE.width,
    height: DEFAULT_SHAPE_SIZE.height,
    lineWidth: LINE_WIDTHS.medium,
    color: color.toLowerCase()
  }
  return { ...project, overlays: [...project.overlays, item] }
}

/**
 * Adds a freehand stroke made of pointer positions (fractions of the output). The anchor becomes the
 * centre of the stroke's bounding box and the points are stored relative to it, in output-height units,
 * so the stroke keeps its shape when the format changes.
 * Returns the project unchanged when fewer than two usable points remain.
 */
export function addStroke(
  project: Project,
  newId: string,
  start: Micros,
  points: readonly StrokePoint[],
  color: string,
  lineWidth: LineWidthId | number = 'medium'
): Project {
  if (!validId(project, newId) || !Number.isFinite(start) || !HEX_COLOR.test(color)) return project
  const aspect = project.format.width / project.format.height
  // Work in output-height units: x scales by the aspect ratio, y is already a fraction of the height.
  const units = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x * aspect, y: p.y }))
  const kept: { x: number; y: number }[] = []
  for (const p of units) {
    const last = kept[kept.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_POINT_GAP) kept.push(p)
  }
  if (kept.length < 2) return project

  const minX = Math.min(...kept.map((p) => p.x))
  const maxX = Math.max(...kept.map((p) => p.x))
  const minY = Math.min(...kept.map((p) => p.y))
  const maxY = Math.max(...kept.map((p) => p.y))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const item: StrokeOverlay = {
    id: newId,
    kind: 'stroke',
    start: Math.max(0, Math.round(start)),
    duration: DEFAULT_OVERLAY_DURATION,
    pos: clampPos({ x: cx / aspect, y: cy }),
    scale: 1,
    rotation: 0,
    points: kept.map((p): [number, number] => [round5(p.x - cx), round5(p.y - cy)]),
    lineWidth: clamp(typeof lineWidth === 'number' ? lineWidth : LINE_WIDTHS[lineWidth], MIN_LINE_WIDTH, MAX_LINE_WIDTH),
    color: color.toLowerCase()
  }
  return { ...project, overlays: [...project.overlays, item] }
}

/**
 * Patches one overlay item. Values are clamped to sensible ranges. A non-finite value, a colour that is
 * not #RRGGBB, or a field that does not apply to the item's kind rejects the whole patch.
 */
export function updateOverlay(project: Project, id: string, patch: OverlayPatch): Project {
  const target = project.overlays.find((o) => o.id === id)
  if (!target) return project
  const next = applyPatch(target, patch)
  if (!next) return project
  const overlays = project.overlays.map((o) => (o.id === id ? next : o))
  return JSON.stringify(overlays) === JSON.stringify(project.overlays) ? project : { ...project, overlays }
}

export function moveOverlay(project: Project, id: string, newStart: Micros): Project {
  return updateOverlay(project, id, { start: newStart })
}

/** The end stays where it is; the start is clamped to [0, end - minimum duration]. */
export function trimOverlayStart(project: Project, id: string, newStart: Micros): Project {
  const item = project.overlays.find((o) => o.id === id)
  if (!item || !Number.isFinite(newStart)) return project
  const end = item.start + item.duration
  const start = Math.min(Math.max(Math.round(newStart), 0), Math.max(0, end - MIN_OVERLAY_DURATION))
  return updateOverlay(project, id, { start, duration: end - start })
}

/** The start stays where it is; the end is at least the minimum duration after the start. */
export function trimOverlayEnd(project: Project, id: string, newEnd: Micros): Project {
  const item = project.overlays.find((o) => o.id === id)
  if (!item || !Number.isFinite(newEnd)) return project
  const end = Math.max(Math.round(newEnd), item.start + MIN_OVERLAY_DURATION)
  return updateOverlay(project, id, { duration: end - item.start })
}

/** Copies the item right after the original (in time and in the list). */
export function duplicateOverlay(project: Project, id: string, newId: string): Project {
  if (!validId(project, newId)) return project
  const index = project.overlays.findIndex((o) => o.id === id)
  const original = project.overlays[index]
  if (!original) return project
  // Items are never mutated, so the copy may share the points array.
  const copy: OverlayItem = { ...original, id: newId, start: original.start + original.duration, pos: { ...original.pos } }
  return { ...project, overlays: [...project.overlays.slice(0, index + 1), copy, ...project.overlays.slice(index + 1)] }
}

/** Removes the most recently added stroke (the last one in the list). Returns the project unchanged when there is none. */
export function removeLastStroke(project: Project): Project {
  let index = -1
  project.overlays.forEach((o, i) => {
    if (o.kind === 'stroke') index = i
  })
  if (index < 0) return project
  return { ...project, overlays: project.overlays.filter((_, i) => i !== index) }
}

function applyPatch(item: OverlayItem, patch: OverlayPatch): OverlayItem | null {
  const next = { ...item, pos: { ...item.pos } } as OverlayItem
  if (patch.start !== undefined) {
    if (!Number.isFinite(patch.start)) return null
    next.start = Math.max(0, Math.round(patch.start))
  }
  if (patch.duration !== undefined) {
    if (!Number.isFinite(patch.duration)) return null
    next.duration = Math.max(MIN_OVERLAY_DURATION, Math.round(patch.duration))
  }
  if (patch.pos !== undefined) {
    const { x, y } = patch.pos
    if ((x !== undefined && !Number.isFinite(x)) || (y !== undefined && !Number.isFinite(y))) return null
    if (x !== undefined) next.pos.x = clamp(x, 0, 1)
    if (y !== undefined) next.pos.y = clamp(y, 0, 1)
  }
  if (patch.scale !== undefined) {
    if (!Number.isFinite(patch.scale)) return null
    next.scale = clamp(patch.scale, MIN_SCALE, MAX_SCALE)
  }
  if (patch.rotation !== undefined) {
    if (!Number.isFinite(patch.rotation)) return null
    next.rotation = ((patch.rotation % 360) + 360) % 360
  }
  if (patch.size !== undefined) {
    if (next.kind !== 'sticker' || !Number.isFinite(patch.size)) return null
    next.size = clamp(patch.size, MIN_STICKER_SIZE, MAX_STICKER_SIZE)
  }
  if (patch.width !== undefined || patch.height !== undefined) {
    if (next.kind !== 'shape') return null
    if ((patch.width !== undefined && !Number.isFinite(patch.width)) || (patch.height !== undefined && !Number.isFinite(patch.height))) return null
    if (patch.width !== undefined) next.width = clamp(patch.width, MIN_SHAPE_SIDE, MAX_SHAPE_SIDE)
    if (patch.height !== undefined) next.height = clamp(patch.height, MIN_SHAPE_SIDE, MAX_SHAPE_SIDE)
  }
  if (patch.lineWidth !== undefined) {
    if (next.kind === 'sticker' || !Number.isFinite(patch.lineWidth)) return null
    next.lineWidth = clamp(patch.lineWidth, MIN_LINE_WIDTH, MAX_LINE_WIDTH)
  }
  if (patch.color !== undefined) {
    if (next.kind === 'sticker' || !HEX_COLOR.test(patch.color)) return null
    next.color = patch.color.toLowerCase()
  }
  return next
}

/** Local copy of ops.projectIds: importing it here would make a cycle, since ops.ts uses duplicateOverlay. */
function validId(project: Project, id: string): boolean {
  if (id.length === 0) return false
  const taken = [...project.assets, ...project.clips, ...project.texts, ...project.music, ...project.overlays]
  return !taken.some((item) => item.id === id)
}

function clampPos(pos: { x: number; y: number }): { x: number; y: number } {
  return { x: clamp(pos.x, 0, 1), y: clamp(pos.y, 0, 1) }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

function round5(v: number): number {
  return Math.round(v * 1e5) / 1e5
}
