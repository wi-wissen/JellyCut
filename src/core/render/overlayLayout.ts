import type { OverlayItem } from '../project/types'
import type { Box } from './layout'
import { STICKER_BOX_RATIO } from '../timeline/overlayCatalog'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Drawing box of an overlay relative to its anchor (pos), in output-height units, before the item's
 * scale and rotation. Includes half the line width on every side, so strokes are never clipped.
 * The engine rasterises each item into exactly this box.
 */
export function overlayBounds(item: OverlayItem): Bounds {
  if (item.kind === 'sticker') {
    const half = (item.size * STICKER_BOX_RATIO) / 2
    return { minX: -half, minY: -half, maxX: half, maxY: half }
  }
  if (item.kind === 'shape') {
    const hw = item.width / 2 + item.lineWidth / 2
    const hh = item.height / 2 + item.lineWidth / 2
    return { minX: -hw, minY: -hh, maxX: hw, maxY: hh }
  }
  const pad = item.lineWidth / 2
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of item.points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

/**
 * The overlay's box in output pixels: centred on its anchor (pos), scaled by item.scale and
 * rotated clockwise around the anchor. Used for the compositor quad and the player's handles alike.
 */
export function overlayBox(item: OverlayItem, outW: number, outH: number): Box {
  const b = overlayBounds(item)
  const scale = item.scale
  const offX = ((b.minX + b.maxX) / 2) * outH * scale
  const offY = ((b.minY + b.maxY) / 2) * outH * scale
  const rad = (item.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    cx: item.pos.x * outW + offX * cos - offY * sin,
    cy: item.pos.y * outH + offX * sin + offY * cos,
    w: (b.maxX - b.minX) * outH * scale,
    h: (b.maxY - b.minY) * outH * scale,
    rotationDeg: item.rotation
  }
}
