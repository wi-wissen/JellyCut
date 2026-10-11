import type { OverlayItem, OverlayLoop, RegionOverlay, ShapeOverlay } from '../project/types'
import { IN_ANIMATIONS, OUT_ANIMATIONS } from '../render/animations'
import { STICKER_SHAPE_IDS } from '../render/stickerShapes'

/** Built-in vector stickers offered in the panel. Names are translated in the UI (overlays3.sticker). */
export const STICKER_IDS = STICKER_SHAPE_IDS

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

export const OVERLAY_KINDS: readonly OverlayItem['kind'][] = ['sticker', 'shape', 'stroke', 'region', 'media']

/** Entrance and exit animations, each with its own direction (see core/render/animations). */
export const OVERLAY_IN_ANIMATIONS = IN_ANIMATIONS
export const OVERLAY_OUT_ANIMATIONS = OUT_ANIMATIONS
export const OVERLAY_LOOPS: readonly OverlayLoop[] = ['wiggle']

/** A tool, not a sticker: the blur / pixelate shapes. */
export const REGION_SHAPES: readonly RegionOverlay['shape'][] = ['rect', 'ellipse', 'roundRect']
export const REGION_EFFECTS: readonly RegionOverlay['effect'][] = ['blur', 'pixelate']
export const DEFAULT_REGION_SIZE = { width: 0.3, height: 0.2 } as const
export const DEFAULT_REGION_STRENGTH = 0.5
export const DEFAULT_REGION_RADIUS = 0.03

/** Picture-in-picture boxes start this tall (fraction of the output height); the width follows the asset's shape. */
export const DEFAULT_MEDIA_HEIGHT = 0.3
export const DEFAULT_MEDIA_BORDER_COLOR = '#ffffff'

/** Output height that line widths in pixels refer to (the same reference as text sizes). */
export const REFERENCE_HEIGHT = 1080

/** The marker ('Textmarker') preset: a wide, flat-ended stroke at 40 % opacity. Overlapping parts of one stroke do not darken. */
export const MARKER_PRESET = { color: '#ffe14d', width: 'thick', opacity: 0.4, cap: 'flat' } as const
