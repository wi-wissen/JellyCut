import type { OverlayItem, ShapeOverlay, StickerOverlay, StrokeOverlay } from '../project/types'
import type { Box } from './layout'
import type { OverlayPose } from './types'
import { STICKER_BOX_RATIO } from '../timeline/overlayCatalog'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The item's own placement, before any animation. */
export function overlayPose(item: OverlayItem): OverlayPose {
  return { x: item.pos.x, y: item.pos.y, scale: item.scale, rotation: item.rotation }
}

/** Items the engine rasterises to a 2D canvas. Regions and pictures are drawn by the compositor itself. */
export function isDrawnOverlay(item: OverlayItem): item is StickerOverlay | ShapeOverlay | StrokeOverlay {
  return item.kind === 'sticker' || item.kind === 'shape' || item.kind === 'stroke'
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
  if (item.kind === 'region' || item.kind === 'media') {
    return { minX: -item.width / 2, minY: -item.height / 2, maxX: item.width / 2, maxY: item.height / 2 }
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
 * The overlay's box in output pixels: centred on its anchor, scaled and rotated clockwise around it.
 * `pose` is the animated placement; it defaults to the item's own. Used for the compositor quad and
 * the player's handles alike.
 */
export function overlayBox(item: OverlayItem, outW: number, outH: number, pose: OverlayPose = overlayPose(item)): Box {
  const b = overlayBounds(item)
  const scale = pose.scale
  const offX = ((b.minX + b.maxX) / 2) * outH * scale
  const offY = ((b.minY + b.maxY) / 2) * outH * scale
  const rad = (pose.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    cx: pose.x * outW + offX * cos - offY * sin,
    cy: pose.y * outH + offX * sin + offY * cos,
    w: (b.maxX - b.minX) * outH * scale,
    h: (b.maxY - b.minY) * outH * scale,
    rotationDeg: pose.rotation
  }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** Gaussian sigma of a blur region, in output pixels for an output of height outH (strength 0..1). */
export function regionBlurSigma(strength: number, outH: number): number {
  return (0.004 + 0.06 * clamp01(strength)) * outH
}

/** Mosaic cell size of a pixelate region, in output pixels for an output of height outH (strength 0..1). */
export function regionCellSize(strength: number, outH: number): number {
  return (0.008 + 0.08 * clamp01(strength)) * outH
}
