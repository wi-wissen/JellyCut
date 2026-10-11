/**
 * Geometry that mirrors what the compositor draws (src/engine/render/compositor.ts and text.ts).
 * Overlays and gestures use these functions so that the boxes line up with the pixels.
 * All values are output pixels unless a name says otherwise; y grows downwards.
 */

/** Model font sizes are pixels for a 1080 px high output (same constant as engine/render/text.ts). */
const TEXT_REFERENCE_HEIGHT = 1080
const MAX_TEXT_SIDE = 4096
const MAX_TRANSFORM_SCALE = 1000
/** Preview canvas longest side; the engine's PREVIEW_MAX_SIDE. */
const PREVIEW_MAX_SIDE = 1280

export interface Size {
  width: number
  height: number
}

export interface PictureTransformInput {
  fit?: 'fit' | 'fill'
  scale?: number
  x?: number
  y?: number
  rotation?: number
  flipX?: boolean
}

export interface Box {
  cx: number
  cy: number
  w: number
  h: number
  /** Clockwise in screen space (y down), like the compositor. */
  rotationDeg: number
}

export interface FrameRect extends Box {
  flipX: boolean
}

export interface Point {
  x: number
  y: number
}

export interface TextLayerInput {
  text: string
  style: { size: number; outline: string | null }
  pos: { x: number; y: number }
  scale?: number
  offsetY?: number
}

/** Ink box of a text without outline padding, in px at the given font size. */
export type TextMeasure = (text: string, px: number) => Size

/** Text boxes are never rotated. */
export interface TextBox extends Box {
  rotationDeg: 0
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Same rounding as the compositor's text size: round(size * outH / 1080), at least 1 px. */
export function textFontPx(size: number, outH: number): number {
  const base = Number.isFinite(size) && size > 0 ? size : 48
  return Math.max(1, Math.round((base * outH) / TEXT_REFERENCE_HEIGHT))
}

/** Line box height used by the text rasterizer. */
export function textLineHeightPx(px: number): number {
  return Math.ceil(px * 1.2)
}

/** Padding the rasterizer adds around the ink (outline stroke plus 2 px). */
export function textPadPx(px: number, outline: string | null): number {
  const stroke = outline ? px / 8 : 0
  return Math.ceil(stroke) + 2
}

/** Size of the preview canvas for a format: the export size, capped on the longest side. */
export function previewSize(format: Size, maxSide: number = PREVIEW_MAX_SIDE): Size {
  const scale = Math.min(1, maxSide / Math.max(format.width, format.height))
  return {
    width: Math.max(2, Math.round(format.width * scale)),
    height: Math.max(2, Math.round(format.height * scale))
  }
}

/**
 * Where the compositor draws a video clip of the given source size in an output of outW x outH.
 * Fit (contain) or fill (cover) sets the base size; scale is around the centre; x and y are
 * fractions of the output width and height.
 */
export function fittedFrameRect(outW: number, outH: number, srcW: number, srcH: number, transform: PictureTransformInput): FrameRect {
  const fill = transform.fit === 'fill'
  const scale = finiteOr(transform.scale, 1) > 0 ? Math.min(finiteOr(transform.scale, 1), MAX_TRANSFORM_SCALE) : 1
  const base = fill ? Math.max(outW / srcW, outH / srcH) : Math.min(outW / srcW, outH / srcH)
  return {
    cx: outW / 2 + finiteOr(transform.x, 0) * outW,
    cy: outH / 2 + finiteOr(transform.y, 0) * outH,
    w: srcW * base * scale,
    h: srcH * base * scale,
    rotationDeg: finiteOr(transform.rotation, 0),
    flipX: transform.flipX === true
  }
}

/** Corners of a box, clockwise from the top left: TL, TR, BR, BL. */
export function rectCorners(box: Box): [Point, Point, Point, Point] {
  const rad = toRadians(box.rotationDeg)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = box.w / 2
  const hh = box.h / 2
  const at = (dx: number, dy: number): Point => ({
    x: box.cx + dx * cos - dy * sin,
    y: box.cy + dx * sin + dy * cos
  })
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)]
}

/** True when the point is inside the (possibly rotated) box, edges included. */
export function pointInRotatedRect(p: Point, box: Box): boolean {
  const rad = toRadians(box.rotationDeg)
  const dx = p.x - box.cx
  const dy = p.y - box.cy
  const lx = dx * Math.cos(rad) + dy * Math.sin(rad)
  const ly = -dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2
}

/**
 * Where the compositor draws a text layer: the texture is the rasterised text plus padding,
 * scaled by the layer scale and centred on pos (plus offsetY). Returns null for empty text.
 */
export function textRect(outW: number, outH: number, layer: TextLayerInput, measure: TextMeasure): TextBox | null {
  if (layer.text.length === 0) return null
  const px = textFontPx(layer.style.size, outH)
  const ink = measure(layer.text, px)
  if (!(ink.width > 0)) return null
  const pad = textPadPx(px, layer.style.outline)
  const texW = Math.min(MAX_TEXT_SIDE, Math.ceil(ink.width + 2 * pad))
  const texH = Math.min(MAX_TEXT_SIDE, Math.ceil(ink.height + 2 * pad))
  const scale = finiteOr(layer.scale, 1) > 0 ? finiteOr(layer.scale, 1) : 1
  return {
    cx: finiteOr(layer.pos.x, 0.5) * outW,
    cy: (finiteOr(layer.pos.y, 0.5) + finiteOr(layer.offsetY, 0)) * outH,
    w: texW * scale,
    h: texH * scale,
    rotationDeg: 0
  }
}

/** Pixel delta in the output -> change of transform.x / transform.y (fractions of the output size). */
export function dragToTransformDelta(dxPx: number, dyPx: number, outW: number, outH: number): Point {
  return { x: dxPx / outW, y: dyPx / outH }
}

/**
 * New scale (or font size) for a corner drag: the dragged corner follows the pointer while the
 * opposite logic keeps the centre fixed. startValue is the value when the drag began.
 * handle is the corner direction, e.g. {sx: 1, sy: -1} for the top right corner.
 */
export function scaleFromHandle(
  box: Box,
  handle: { sx: -1 | 1; sy: -1 | 1 },
  pointer: Point,
  startValue: number,
  min: number,
  max: number
): number {
  const v = { x: (handle.sx * box.w) / 2, y: (handle.sy * box.h) / 2 }
  const norm = v.x * v.x + v.y * v.y
  if (!(norm > 0)) return clamp(startValue, min, max)
  const rad = toRadians(box.rotationDeg)
  // Corner vector in the screen frame, dotted with the pointer offset from the centre.
  const rx = v.x * Math.cos(rad) - v.y * Math.sin(rad)
  const ry = v.x * Math.sin(rad) + v.y * Math.cos(rad)
  const k = ((pointer.x - box.cx) * rx + (pointer.y - box.cy) * ry) / norm
  return clamp(startValue * k, min, max)
}

export interface Snap {
  value: number
  /** The guide line that was hit, or null. */
  guide: number | null
}

/** Snaps a fraction to the nearest guide within thresholdFraction. */
export function snapToGuides(value: number, guides: readonly number[], thresholdFraction: number): Snap {
  let best: number | null = null
  let bestDistance = thresholdFraction
  for (const guide of guides) {
    const distance = Math.abs(value - guide)
    if (distance <= bestDistance) {
      best = guide
      bestDistance = distance
    }
  }
  return best === null ? { value, guide: null } : { value: best, guide: best }
}

/** Keeps only the axis with the larger movement (Shift-drag). */
export function axisLock(dx: number, dy: number): Point {
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Centre line and the two rule-of-thirds lines, as fractions of the output (the centre is included). */
export const THIRDS_GUIDES: readonly number[] = [1 / 3, 0.5, 2 / 3]
