import type { Micros } from '../time'
import type { OverlayItem, ProjectFormat, TextStyle, Transform } from '../project/types'
import type { Grade } from '../filters/filters'

/** Transitions the renderer implements. Anything else falls back to 'fade'. */
export const TRANSITION_TYPES = [
  'fade',
  'wipeLeft',
  'wipeRight',
  'wipeUp',
  'wipeDown',
  'slideLeft',
  'slideRight',
  'zoomIn',
  'zoomOut',
  'blur'
] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]

/** Default length of a text in/out animation, shortened to half the text duration when needed. */
export const TEXT_ANIM_DURATION: Micros = 400_000

export interface LayerTransition {
  type: string
  /** 0..1 progress of the transition at this time. */
  progress: number
  /** 'from' is the outgoing clip, 'to' the incoming one. */
  role: 'from' | 'to'
}

export interface VideoLayer {
  clipId: string
  assetId: string
  /** Time inside the source file (microseconds) that must be shown. */
  srcTime: Micros
  transform: Transform
  transition: LayerTransition | null
  /** Colour grade of this clip; null when the picture is drawn unchanged. Each side of a transition has its own. */
  grade?: Grade | null
}

export interface TextLayer {
  id: string
  text: string
  style: TextStyle
  /** Center position as a fraction of the output (0..1). */
  pos: { x: number; y: number }
  /** 0..1 */
  alpha: number
  /** Multiplier, 1 = normal. */
  scale: number
  /** Extra offsets as fractions of the output height (slide animations). */
  offsetX: number
  offsetY: number
}

/** Placement of an overlay on screen: its own pose, changed by the animation at this time. */
export interface OverlayPose {
  /** Anchor as a fraction of the output (x of the width, y of the height). */
  x: number
  y: number
  /** Multiplier on the item's scale. */
  scale: number
  /** Clockwise degrees, added to the item's own rotation. */
  rotation: number
}

export interface OverlayLayer extends OverlayPose {
  item: OverlayItem
  /** 0..1: the item's opacity times its entrance / exit animation. */
  alpha: number
  /** Source time of a picture-in-picture video frame (microseconds); 0 for everything else. */
  srcTime: Micros
  /** Cell of the sprite sheet to draw for an animated sticker (core/render/stickerAnimations); absent for everything else. */
  frame?: number
}

/** Everything needed to draw one output frame. Pure data, identical for preview and export. */
export interface Scene {
  time: Micros
  format: ProjectFormat
  /** Back to front. At most two layers (the two sides of a transition). */
  videos: VideoLayer[]
  /**
   * Overlays on screen at this time, back to front, all kinds in one list (project order). A region blurs or
   * pixelates everything below it in this list; what comes later is drawn on top, unaffected.
   */
  overlays: OverlayLayer[]
  texts: TextLayer[]
}
