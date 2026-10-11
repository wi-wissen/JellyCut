import type { OverlayItem } from '../../core/project/types'
import { overlayBounds } from '../../core/render/overlayLayout'
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

/** Cache key of an overlay's pixels: everything that changes the raster, nothing that only moves or rotates it. */
export function overlayRasterKey(item: OverlayItem, outH: number): string {
  if (item.kind === 'sticker') return JSON.stringify([item.kind, item.emoji, item.size, outH])
  if (item.kind === 'shape') return JSON.stringify([item.kind, item.shape, item.width, item.height, item.lineWidth, item.color, outH])
  return JSON.stringify([item.kind, item.points, item.lineWidth, item.color, outH])
}

/**
 * Rasterises one overlay at its base size (scale and rotation are applied when it is drawn), into the
 * box from core/render/overlayLayout. Pixels are premultiplied on upload, like text.
 */
export function rasterizeOverlay(item: OverlayItem, outH: number): OverlayRaster | null {
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
    ctx.font = `${item.size * k}px ${EMOJI_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(item.emoji, X(0), Y(0))
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
    ctx.beginPath()
    ctx.moveTo(X(first[0]), Y(first[1]))
    for (const [x, y] of rest) ctx.lineTo(X(x), Y(y))
    ctx.stroke()
  }
  return { canvas, width, height }
}

function context2d(canvas: Canvas2D): Ctx2D {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d')
  if (!ctx) throw new Error('2D canvas context not available')
  return ctx
}
