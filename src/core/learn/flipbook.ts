/** Pixel helpers for the flipbook demo. RGBA buffers, row-major, width x height. */
import { changedMask } from './demo'

/** A cut-out subject: RGBA pixels, transparent where there is nothing to draw. */
export interface Sprite {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

/** From this alpha on, a sprite pixel replaces the picture underneath (no blending, so every change is exact). */
const COVER_ALPHA = 128

/** Calls visit(pictureIndex, spriteIndex) for each sprite pixel that covers the picture when drawn at (x, y). */
function forCovered(
  sprite: Sprite,
  width: number,
  height: number,
  x: number,
  y: number,
  visit: (picture: number, source: number) => void
): void {
  for (let sy = 0; sy < sprite.height; sy++) {
    const py = y + sy
    if (py < 0 || py >= height) continue
    for (let sx = 0; sx < sprite.width; sx++) {
      const px = x + sx
      const s = (sy * sprite.width + sx) * 4
      if (px < 0 || px >= width || sprite.pixels[s + 3]! < COVER_ALPHA) continue
      visit(py * width + px, s)
    }
  }
}

/** The plate with the sprite drawn at (x, y). The plate itself is not changed. */
export function composeFrame(plate: Uint8ClampedArray, width: number, height: number, sprite: Sprite, x: number, y: number): Uint8ClampedArray {
  const frame = new Uint8ClampedArray(plate)
  forCovered(sprite, width, height, x, y, (p, s) => {
    frame[p * 4] = sprite.pixels[s]!
    frame[p * 4 + 1] = sprite.pixels[s + 1]!
    frame[p * 4 + 2] = sprite.pixels[s + 2]!
  })
  return frame
}

/** 1 where the sprite covers the picture when drawn at (x, y), 0 elsewhere. */
export function coverMask(sprite: Sprite, width: number, height: number, x: number, y: number): Uint8Array {
  const mask = new Uint8Array(width * height)
  forCovered(sprite, width, height, x, y, (p) => {
    mask[p] = 1
  })
  return mask
}

export interface Flipbook {
  frames: Uint8ClampedArray[]
  /** Per frame: the pixels the sprite covers. */
  covers: Uint8Array[]
}

/** Frame k draws the sprite at x = xs[k] over the same plate, so the background never moves. */
export function buildFlipbook(
  plate: Uint8ClampedArray,
  width: number,
  height: number,
  sprite: Sprite,
  xs: readonly number[],
  y: number
): Flipbook {
  return {
    frames: xs.map((x) => composeFrame(plate, width, height, sprite, x, y)),
    covers: xs.map((x) => coverMask(sprite, width, height, x, y))
  }
}

/** Kinds of changed pixels between two frames (see changeKinds). 0 means unchanged. */
export const NEWLY_COVERED = 1
export const UNCOVERED = 2
export const INSIDE_CHANGE = 3

/**
 * Kind of every pixel that differs between two consecutive frames (0 where nothing differs).
 * NEWLY_COVERED: the subject covers the pixel now but did not before. UNCOVERED: the subject has
 * just left it, so the background shows again. INSIDE_CHANGE: the subject covers it in both frames
 * but the picture underneath has moved on.
 */
export function changeKinds(changed: Uint8Array, coverBefore: Uint8Array, coverNow: Uint8Array): Uint8Array<ArrayBuffer> {
  const kinds = new Uint8Array(changed.length)
  for (let p = 0; p < changed.length; p++) {
    if (!changed[p]) continue
    if (coverNow[p] && !coverBefore[p]) kinds[p] = NEWLY_COVERED
    else if (!coverNow[p] && coverBefore[p]) kinds[p] = UNCOVERED
    else kinds[p] = INSIDE_CHANGE
  }
  return kinds
}

/**
 * Change kinds for every frame, compared with the frame before it. Frame 0 has no earlier frame,
 * so all its kinds are 0. Every pixel is compared, so the uncovered background counts too.
 */
export function flipbookKinds(book: Flipbook, width: number, height: number, threshold: number): Uint8Array[] {
  const kinds: Uint8Array[] = [new Uint8Array(width * height)]
  for (let k = 1; k < book.frames.length; k++) {
    const changed = changedMask(book.frames[k - 1]!, book.frames[k]!, threshold)
    kinds.push(changeKinds(changed, book.covers[k - 1]!, book.covers[k]!))
  }
  return kinds
}
