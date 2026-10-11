import type { Micros } from '../time'

export type AssetKind = 'video' | 'audio' | 'image'
export type FormatRatio = '16:9' | '9:16' | '1:1' | '4:5'
export type FitMode = 'fit' | 'fill'

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
}

export interface Transform {
  fit: FitMode
  scale: number
  x: number
  y: number
  rotation: number
  flipX: boolean
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
  filter: string | null
  transitionIn: TransitionIn | null
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

export interface ProjectFormat {
  ratio: FormatRatio
  width: number
  height: number
  fps: number
  background: { type: 'blur' } | { type: 'color'; color: string }
}

export interface Project {
  version: number
  name: string
  format: ProjectFormat
  assets: Asset[]
  clips: Clip[]
  texts: TextItem[]
  overlays: unknown[]
  stickers: unknown[]
  drawings: unknown[]
  music: MusicItem[]
}
