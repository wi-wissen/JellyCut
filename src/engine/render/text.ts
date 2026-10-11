import type { TextStyle } from '../../core/project/types'

export type Canvas2D = HTMLCanvasElement | OffscreenCanvas
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type Rgb = readonly [number, number, number]

/** Font sizes in the model are pixels for a 1080 px high output. */
export const TEXT_REFERENCE_HEIGHT = 1080
const MAX_TEXT_SIDE = 4096

export interface TextRaster {
  canvas: Canvas2D
  width: number
  height: number
}

export function createCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas: Canvas2D): Ctx2D {
  const ctx = (canvas as HTMLCanvasElement).getContext('2d')
  if (!ctx) throw new Error('2D canvas context not available')
  return ctx
}

export function textPixelSize(size: number, outputHeight: number): number {
  const base = Number.isFinite(size) && size > 0 ? size : 48
  return Math.max(1, Math.round((base * outputHeight) / TEXT_REFERENCE_HEIGHT))
}

/** Rasterizes a (possibly multi-line) text with an optional outline. Returns null for empty text. */
export function rasterizeText(text: string, style: TextStyle, px: number): TextRaster | null {
  const lines = text.split('\n')
  const family = style.font.replace(/["\\]/g, '').trim()
  const font = `700 ${px}px ${family ? `"${family}", ` : ''}system-ui, sans-serif`

  const probe = context2d(createCanvas(1, 1))
  probe.font = font
  const maxInk = Math.max(0, ...lines.map((line) => probe.measureText(line).width))
  if (maxInk <= 0) return null

  const stroke = style.outline ? px / 8 : 0
  const pad = Math.ceil(stroke) + 2
  const lineHeight = Math.ceil(px * 1.2)
  const width = Math.min(MAX_TEXT_SIDE, Math.ceil(maxInk + 2 * pad))
  const height = Math.min(MAX_TEXT_SIDE, Math.ceil(lines.length * lineHeight + 2 * pad))

  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lineY = (i: number) => pad + lineHeight * (i + 0.5)

  // All strokes before all fills, so an outline never covers a neighbouring line's glyphs.
  if (stroke > 0 && style.outline) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = stroke
    ctx.strokeStyle = style.outline
    lines.forEach((line, i) => ctx.strokeText(line, width / 2, lineY(i)))
  }
  ctx.fillStyle = style.color
  lines.forEach((line, i) => ctx.fillText(line, width / 2, lineY(i)))
  return { canvas, width, height }
}

const colorCache = new Map<string, Rgb>()

/** Resolves any CSS colour to 0..1 RGB via the browser's own colour parser. */
export function parseCssColor(css: string): Rgb {
  const cached = colorCache.get(css)
  if (cached) return cached
  const ctx = context2d(createCanvas(1, 1))
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
  const rgb: Rgb = [r / 255, g / 255, b / 255]
  if (colorCache.size > 64) colorCache.clear()
  colorCache.set(css, rgb)
  return rgb
}
