import type { ShapeOverlay, StickerOverlay, StrokeOverlay } from '../../core/project/types'
import { overlayBounds } from '../../core/render/overlayLayout'
import { STICKER_GRID, stickerShape } from '../../core/render/stickerShapes'
import { createCanvas, type Canvas2D, type Ctx2D } from './text'

/** System emoji fonts only; nothing is loaded from the network. */
export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif'
/** Longest side of one overlay texture; larger items are drawn at a lower resolution, uniformly. */
const MAX_SIDE = 4096

export interface OverlayRaster {
  canvas: Canvas2D
  width: number
  height: number
}

/** Items are immutable project data, so their keys are computed once per item and height (long strokes are big). */
const keyCache = new WeakMap<DrawnOverlay, { outH: number; key: string }>()

/** Overlays rasterised to a 2D canvas: stickers, shapes and strokes. */
export type DrawnOverlay = StickerOverlay | ShapeOverlay | StrokeOverlay

/** Cache key of an overlay's pixels: everything that changes the raster, nothing that only moves or rotates it. */
export function overlayRasterKey(item: DrawnOverlay, outH: number): string {
  const known = keyCache.get(item)
  if (known && known.outH === outH) return known.key
  let key: string
  if (item.kind === 'sticker') {
    key = item.emoji !== undefined
      ? JSON.stringify([item.kind, item.emoji, item.size, outH])
      : JSON.stringify([item.kind, item.shape, item.size, item.color, item.outline ?? null, outH])
  } else if (item.kind === 'shape') key = JSON.stringify([item.kind, item.shape, item.width, item.height, item.lineWidth, item.color, outH])
  else key = JSON.stringify([item.kind, item.points, item.lineWidth, item.color, item.cap ?? 'round', outH])
  keyCache.set(item, { outH, key })
  return key
}

/**
 * Rasterises one overlay at its base size (scale and rotation are applied when it is drawn), into the
 * box from core/render/overlayLayout. Pixels are premultiplied on upload, like text.
 */
export function rasterizeOverlay(item: DrawnOverlay, outH: number): OverlayRaster | null {
  const b = overlayBounds(item)
  const unitW = b.maxX - b.minX
  const unitH = b.maxY - b.minY
  if (!(unitW > 0 && unitH > 0) || !(outH > 0)) return null
  // One scale for both axes, so the picture keeps its shape when a huge item is capped.
  const k = Math.min(outH, MAX_SIDE / Math.max(unitW, unitH))
  const width = Math.max(1, Math.ceil(unitW * k))
  const height = Math.max(1, Math.ceil(unitH * k))
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Shapes are described relative to the anchor; this maps them into the top-left based raster.
  const X = (x: number) => (x - b.minX) * k
  const Y = (y: number) => (y - b.minY) * k

  if (item.kind === 'sticker') {
    if (item.emoji !== undefined) {
      ctx.font = `${item.size * k}px ${EMOJI_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(item.emoji, X(0), Y(0))
    } else if (!drawVectorSticker(ctx, item, X(0), Y(0), k)) {
      return null
    }
  } else if (item.kind === 'shape') {
    const w = item.width * k
    const h = item.height * k
    ctx.strokeStyle = item.color
    ctx.lineWidth = item.lineWidth * k
    ctx.beginPath()
    if (item.shape === 'rect') {
      ctx.rect(X(-item.width / 2), Y(-item.height / 2), w, h)
    } else if (item.shape === 'ellipse') {
      ctx.ellipse(X(0), Y(0), w / 2, h / 2, 0, 0, Math.PI * 2)
    } else {
      // Shaft from left to right with a two-wing head at the right end; height sets the head's spread.
      const tipX = X(item.width / 2)
      const headLength = Math.min(item.width * 0.5, item.height) * k
      ctx.moveTo(X(-item.width / 2), Y(0))
      ctx.lineTo(tipX, Y(0))
      ctx.moveTo(tipX - headLength, Y(-item.height / 2))
      ctx.lineTo(tipX, Y(0))
      ctx.lineTo(tipX - headLength, Y(item.height / 2))
    }
    ctx.stroke()
  } else {
    const [first, ...rest] = item.points
    if (!first) return null
    ctx.strokeStyle = item.color
    ctx.lineWidth = item.lineWidth * k
    // A flat cap ends the stroke exactly at its points (the marker preset).
    ctx.lineCap = item.cap === 'flat' ? 'butt' : 'round'
    ctx.beginPath()
    ctx.moveTo(X(first[0]), Y(first[1]))
    for (const [x, y] of rest) ctx.lineTo(X(x), Y(y))
    ctx.stroke()
  }
  return { canvas, width, height }
}

/** Outline width of a vector sticker, in grid units (half of it lies outside the fill). */
const OUTLINE_UNITS = 1.6
const FILL_LINE_UNITS = 2.4
const CUT_UNITS = 1.9

/**
 * Draws a vector sticker centred on (cx, cy) in canvas pixels, `k` pixels per output-height unit (the same
 * scale as the rest of the raster). Fill shapes use the even-odd rule, so inner subpaths are holes. Returns
 * false for an unknown shape.
 */
function drawVectorSticker(ctx: Ctx2D, item: StickerOverlay, cx: number, cy: number, k: number): boolean {
  const def = item.shape ? stickerShape(item.shape) : null
  if (!def || !item.color) return false
  const unit = (item.size * k) / STICKER_GRID
  const path = new Path2D(def.d)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(unit, unit)
  ctx.translate(-STICKER_GRID / 2, -STICKER_GRID / 2)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (item.outline) {
    // Drawn first: the fill covers the inner half of the outline stroke.
    ctx.strokeStyle = item.outline
    ctx.lineWidth = def.kind === 'line' ? FILL_LINE_UNITS + 2 * OUTLINE_UNITS : 2 * OUTLINE_UNITS
    ctx.stroke(path)
  }
  ctx.fillStyle = item.color
  ctx.strokeStyle = item.color
  if (def.kind === 'fill') {
    ctx.fill(path, 'evenodd')
  } else {
    ctx.lineWidth = FILL_LINE_UNITS
    ctx.stroke(path)
  }
  if (def.cut) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineWidth = CUT_UNITS
    ctx.stroke(new Path2D(def.cut))
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.restore()
  return true
}

function context2d(canvas: Canvas2D): Ctx2D {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d')
  if (!ctx) throw new Error('2D canvas context not available')
  return ctx
}
