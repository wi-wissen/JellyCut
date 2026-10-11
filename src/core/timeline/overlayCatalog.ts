import type { OverlayItem, ShapeOverlay } from '../project/types'

/** Sticker emoji offered in the panel. Names are translated in the UI (overlays.stickerNames). */
export const STICKERS = [
  { id: 'star', emoji: '⭐' },
  { id: 'heart', emoji: '❤️' },
  { id: 'smile', emoji: '😀' },
  { id: 'thumbsUp', emoji: '👍' },
  { id: 'party', emoji: '🎉' },
  { id: 'fire', emoji: '🔥' },
  { id: 'sparkles', emoji: '✨' },
  { id: 'check', emoji: '✅' },
  { id: 'cross', emoji: '❌' },
  { id: 'hundred', emoji: '💯' },
  { id: 'rocket', emoji: '🚀' },
  { id: 'laugh', emoji: '😂' }
] as const

export type StickerId = (typeof STICKERS)[number]['id']

export const SHAPE_KINDS: readonly ShapeOverlay['shape'][] = ['rect', 'ellipse', 'arrow']

/** Pen and outline widths as fractions of the output height. */
export const LINE_WIDTHS = { thin: 0.004, medium: 0.008, thick: 0.016 } as const
export type LineWidthId = keyof typeof LINE_WIDTHS

export const DEFAULT_OVERLAY_COLOR = '#ff5ca8'
export const DEFAULT_STICKER_SIZE = 0.12
export const DEFAULT_SHAPE_SIZE = { width: 0.3, height: 0.2 } as const
export const DEFAULT_OVERLAY_DURATION = 3_000_000

/** Ratio of the sticker's drawing box to its glyph height; leaves room for the emoji's own shape. */
export const STICKER_BOX_RATIO = 1.25

export const OVERLAY_KINDS: readonly OverlayItem['kind'][] = ['sticker', 'shape', 'stroke']

/** Output height that line widths in pixels refer to (the same reference as text sizes). */
export const REFERENCE_HEIGHT = 1080
