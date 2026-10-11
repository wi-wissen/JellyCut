import { canvasFont } from '../../core/text/fonts'
import { textLineHeightPx, type Size } from '../../core/render/layout'

/** Ink box of a text as the rasteriser measures it (same font string and line height). */
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const CACHE_LIMIT = 256
let ctx: Ctx2D | null | undefined
const cache = new Map<string, Size>()

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

export function measureTextBox(text: string, px: number, family: string): Size {
  const name = family.replace(/["\\]/g, '').trim()
  const key = `${name}\u0000${px}\u0000${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const c = context()
  const lines = text.split('\n')
  let width = 0
  if (c) {
    c.font = canvasFont(name, px)
    for (const line of lines) width = Math.max(width, c.measureText(line).width)
  }
  const size = { width, height: lines.length * textLineHeightPx(px) }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, size)
  return size
}

/** Call when a font finished loading: cached widths of the fallback font are no longer right. */
export function clearTextMeasureCache(): void {
  cache.clear()
}
