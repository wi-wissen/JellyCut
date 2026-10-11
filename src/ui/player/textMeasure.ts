import { canvasFont } from '../../core/text/fonts'
import type { LineMetrics } from '../../core/render/layout'

/** Glyph metrics from the browser, with the same font and alignment the rasteriser uses. */
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const CACHE_LIMIT = 512
let ctx: Ctx2D | null | undefined
const cache = new Map<string, LineMetrics>()

function context(): Ctx2D | null {
  if (ctx !== undefined) return ctx
  try {
    ctx = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1).getContext('2d')
      : document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  return ctx ?? null
}

const EMPTY: LineMetrics = { width: 0, left: 0, right: 0, ascent: 0, descent: 0 }

export function measureLine(line: string, px: number, family: string): LineMetrics {
  const name = family.replace(/["\\]/g, '').trim()
  const key = `${name}\u0000${px}\u0000${line}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = context()
  let metrics = EMPTY
  if (c) {
    c.font = canvasFont(name, px)
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const m = c.measureText(line)
    metrics = {
      width: m.width,
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, metrics)
  return metrics
}

/** Call when a font finished loading: cached metrics of the fallback font are no longer right. */
export function clearTextMeasureCache(): void {
  cache.clear()
}
