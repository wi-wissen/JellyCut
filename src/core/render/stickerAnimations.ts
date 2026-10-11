import type { OverlayItem } from '../project/types'
import type { Micros } from '../time'
import catalogue from '../../assets/stickers-animated/catalogue.json'

/**
 * Animated stickers: Fluent Emoji (animated) by Microsoft, MIT licence. The catalogue is written by
 * scripts/build-animated-stickers.mjs; each id is a picture sticker (core/render/stickerImages) that also has a
 * sprite sheet in src/assets/stickers-animated. The engine loads sheets lazily (engine/render/stickerAnimations).
 */
export interface AnimatedSticker {
  /** Id of the picture sticker this animation belongs to. */
  id: string
  /** File name of the sheet, `sticker-anim-<id>.webp` (the prefix keeps it out of the service worker's precache). */
  sheet: string
  /** Cells in the sheet, row by row from the top left. */
  frames: number
  cols: number
  rows: number
  /** Cell size in pixels. */
  cell: number
  /** One loop in whole microseconds (frames * frameMicros). */
  loopMicros: Micros
  /** Frequency rank and group of the emoji (Unicode Consortium list), kept for the documentation. */
  rank: number
  group: number
  bytes: number
}

export const ANIMATED_STICKERS: readonly AnimatedSticker[] = catalogue.entries

const BY_ID: ReadonlyMap<string, AnimatedSticker> = new Map(ANIMATED_STICKERS.map((s) => [s.id, s]))

/** The animation of a picture sticker id, or null when it has none. */
export function animatedSticker(id: string | undefined): AnimatedSticker | null {
  return id === undefined ? null : BY_ID.get(id) ?? null
}

/** An animated sticker's length is always a whole number of loops; a new one gets this many. */
export const DEFAULT_ANIMATED_LOOPS = 3

/**
 * Cell of the sheet to show `elapsed` microseconds after the item's start: the position inside the current loop
 * mapped onto the frames. Integer arithmetic only, so preview, paused preview and export pick the same cell.
 */
export function animatedFrameIndex(elapsed: Micros, loopMicros: Micros, frames: number): number {
  if (!(loopMicros > 0) || !(frames > 0)) return 0
  const inLoop = ((elapsed % loopMicros) + loopMicros) % loopMicros
  return Math.min(frames - 1, Math.floor((inLoop * frames) / loopMicros))
}

/** Column and row of a cell in the sheet. */
export function sheetCell(sticker: Pick<AnimatedSticker, 'cols'>, index: number): { col: number; row: number } {
  return { col: index % sticker.cols, row: Math.floor(index / sticker.cols) }
}

/** The animation an item actually plays: a picture sticker with `animated` set whose id has a sheet. */
export function itemAnimation(item: OverlayItem): AnimatedSticker | null {
  return item.kind === 'sticker' && item.animated === true ? animatedSticker(item.imageId) : null
}

/** Loop length of an item in microseconds, or undefined for everything that is not an animated sticker. */
export function itemLoopMicros(item: OverlayItem): Micros | undefined {
  return itemAnimation(item)?.loopMicros
}

/** Number of loops in a duration (at least 1). */
export function loopCount(duration: Micros, loopMicros: Micros): number {
  return Math.max(1, Math.round(duration / loopMicros))
}
