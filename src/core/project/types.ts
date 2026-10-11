import type { Micros } from '../time'

export type AssetKind = 'video' | 'audio' | 'image'
export type FormatRatio = '16:9' | '9:16' | '1:1' | '4:5'
export type FitMode = 'fit' | 'fill'

/** Where a medium comes from and under which licence. Entered by the user; all fields optional. See core/credits. */
export interface AssetCredit {
  title?: string
  author?: string
  source?: string
  /** http:// or https:// only. Stored as text, never fetched. */
  url?: string
  /** Id of an entry in LICENSES (core/credits), or free text for unknown licences. */
  license?: string
}

export interface Asset {
  id: string
  kind: AssetKind
  name: string
  relPath: string
  size: number
  /** Duration in microseconds; images have 0. */
  duration: Micros
  width?: number
  height?: number
  fps?: number
  /** Whether the file has a usable audio track. Undefined means "assume yes" for video, audio files always have it. */
  hasAudio?: boolean
  credit?: AssetCredit
}

export interface Transform {
  fit: FitMode
  scale: number
  x: number
  y: number
  rotation: number
  flipX: boolean
}

/** Brightness, contrast and saturation, each -1..1 (0 is neutral). */
export interface ColorAdjust {
  brightness: number
  contrast: number
  saturation: number
}

export interface TransitionIn {
  type: string
  duration: Micros
}

export interface Clip {
  id: string
  track: 'video'
  assetId: string
  /** Source in/out points on real source timestamps. */
  srcIn: Micros
  srcOut: Micros
  /** Start on the timeline. */
  start: Micros
  speed: number
  transform: Transform
  volume: number
  muted: boolean
  /** Id from core/filters FILTERS; null means no filter. */
  filter: string | null
  /** Strength of the filter, 0..1. Absent means 1. */
  filterAmount?: number
  /** Absent means all neutral. */
  adjust?: ColorAdjust
  transitionIn: TransitionIn | null
  /**
   * Freeze frame: the source time of the one frame this clip shows for its whole length. Such a clip has
   * speed 1 and no audio; srcIn/srcOut only give its length. See core/timeline/freezeOps.
   */
  still?: Micros
}

export interface TextStyle {
  font: string
  size: number
  color: string
  outline: string | null
}

export interface TextItem {
  id: string
  start: Micros
  duration: Micros
  text: string
  style: TextStyle
  pos: { x: number; y: number }
  animIn: string | null
  animOut: string | null
}

export interface MusicItem {
  id: string
  assetId: string
  start: Micros
  srcIn: Micros
  srcOut: Micros
  volume: number
  fadeIn: Micros
  fadeOut: Micros
}

/** Entrance and exit animations of overlays (the text set without the text-only names). */
export type OverlayAnimation = 'fade' | 'pop' | 'slideUp'
/** Animation that runs for the whole time the overlay is on screen. */
export type OverlayLoop = 'wiggle'

/** Placement, timing and appearance shared by all overlay items. */
export interface OverlayBase {
  id: string
  start: Micros
  duration: Micros
  /** Centre as a fraction of the output: x of the width, y of the height. */
  pos: { x: number; y: number }
  /** Size multiplier, 1 = as created. */
  scale: number
  /** Clockwise degrees. */
  rotation: number
  /** 0..1. Absent means fully opaque. */
  opacity?: number
  /** Absent or null means no entrance / exit animation. */
  animIn?: OverlayAnimation | null
  animOut?: OverlayAnimation | null
  /** Absent or null means no looping animation. */
  loop?: OverlayLoop | null
}

export interface StickerOverlay extends OverlayBase {
  kind: 'sticker'
  /** One emoji; drawn with the system emoji font. */
  emoji: string
  /** Glyph height as a fraction of the output height. */
  size: number
}

export interface ShapeOverlay extends OverlayBase {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'arrow'
  /** Width and height as fractions of the output height. */
  width: number
  height: number
  /** Line width as a fraction of the output height. */
  lineWidth: number
  color: string
}

export interface StrokeOverlay extends OverlayBase {
  kind: 'stroke'
  /** Points relative to pos; both axes in fractions of the output height. At least two. */
  points: [number, number][]
  lineWidth: number
  color: string
}

/** Blurs or pixelates the picture below it (video and background), inside a rectangle or an ellipse. */
export interface RegionOverlay extends OverlayBase {
  kind: 'region'
  shape: 'rect' | 'ellipse'
  effect: 'blur' | 'pixelate'
  /** 0..1: blur amount or mosaic cell size. */
  strength: number
  /** Width and height as fractions of the output height. */
  width: number
  height: number
}

/**
 * An image or video of the project's library, shown as a picture in the picture. Video overlays play
 * from their first frame and their sound is never mixed in (see docs/decisions.md).
 */
export interface MediaOverlay extends OverlayBase {
  kind: 'media'
  assetId: string
  /** Box size as fractions of the output height. The picture is cropped to fill the box. */
  width: number
  height: number
  /** Corner radius as a fraction of the output height. */
  radius: number
  /** Border width as a fraction of the output height; 0 means no border. */
  border: number
  borderColor: string
}

export type OverlayItem = StickerOverlay | ShapeOverlay | StrokeOverlay | RegionOverlay | MediaOverlay

export interface ProjectFormat {
  ratio: FormatRatio
  width: number
  height: number
  fps: number
  background: { type: 'blur' } | { type: 'color'; color: string }
  /** Project-wide picture fit for all clips; absent means 'fit'. */
  fit?: FitMode
}

export interface Project {
  version: number
  name: string
  format: ProjectFormat
  assets: Asset[]
  clips: Clip[]
  texts: TextItem[]
  overlays: OverlayItem[]
  stickers: unknown[]
  drawings: unknown[]
  music: MusicItem[]
}
