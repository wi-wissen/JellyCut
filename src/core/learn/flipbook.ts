/** Pixel-level helpers for the flipbook demo. RGBA buffers, row-major, width x height. */

export type Polygon = readonly (readonly [number, number])[]

/** 1 where the pixel centre lies inside the polygon (even-odd rule), 0 elsewhere. */
export function polygonMask(width: number, height: number, polygon: Polygon): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5
    const crossings: number[] = []
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [x1, y1] = polygon[i]!
      const [x2, y2] = polygon[j]!
      if (y1 > cy !== y2 > cy) crossings.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1))
    }
    crossings.sort((p, q) => p - q)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k]! - 0.5))
      const to = Math.min(width - 1, Math.floor(crossings[k + 1]! - 0.5))
      for (let x = from; x <= to; x++) mask[y * width + x] = 1
    }
  }
  return mask
}

/**
 * Copy of the picture with the masked subject removed: every masked run in a row is filled with a
 * straight blend between the pixels left and right of it, so only the background is left.
 */
export function removeSubject(pixels: Uint8ClampedArray, width: number, height: number, mask: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels)
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      if (!mask[y * width + x]) {
        x++
        continue
      }
      const start = x
      while (x < width && mask[y * width + x]) x++
      const end = x - 1
      const leftIndex = start > 0 ? (y * width + start - 1) * 4 : -1
      const rightIndex = end < width - 1 ? (y * width + end + 1) * 4 : -1
      if (leftIndex < 0 && rightIndex < 0) continue
      for (let p = start; p <= end; p++) {
        const t = (p - start + 1) / (end - start + 2)
        for (let c = 0; c < 4; c++) {
          const left = leftIndex >= 0 ? pixels[leftIndex + c]! : pixels[rightIndex + c]!
          const right = rightIndex >= 0 ? pixels[rightIndex + c]! : left
          out[(y * width + p) * 4 + c] = Math.round(left + (right - left) * t)
        }
      }
    }
  }
  return out
}

/** Frame k: the background with the subject (taken from `source`) moved `shifts[k]` pixels to the right. */
export function renderFlipbook(
  source: Uint8ClampedArray,
  background: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  shifts: readonly number[]
): Uint8ClampedArray[] {
  return shifts.map((dx) => {
    const frame = new Uint8ClampedArray(background)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        const tx = x + dx
        if (!mask[p] || tx < 0 || tx >= width) continue
        frame.set(source.subarray(p * 4, p * 4 + 4), (y * width + tx) * 4)
      }
    }
    return frame
  })
}

/** Kinds of changed pixels between two frames (see changeKinds). 0 means unchanged. */
export const NEWLY_COVERED = 1
export const UNCOVERED = 2
export const INSIDE_CHANGE = 3

/** The mask moved `dx` pixels to the right, the same shift renderFlipbook applies to the subject. */
export function shiftMask(mask: Uint8Array, width: number, height: number, dx: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tx = x + dx
      if (mask[y * width + x] && tx >= 0 && tx < width) out[y * width + tx] = 1
    }
  }
  return out
}

/**
 * Kind of every pixel that differs between two consecutive frames (0 where nothing differs).
 * NEWLY_COVERED: the subject covers the pixel now but did not before. UNCOVERED: the subject has
 * just left it, so the background shows again. INSIDE_CHANGE: the subject covers it in both frames
 * but the picture underneath has moved on.
 */
export function changeKinds(changed: Uint8Array, coverBefore: Uint8Array, coverNow: Uint8Array): Uint8Array {
  const kinds = new Uint8Array(changed.length)
  for (let p = 0; p < changed.length; p++) {
    if (!changed[p]) continue
    if (coverNow[p] && !coverBefore[p]) kinds[p] = NEWLY_COVERED
    else if (!coverNow[p] && coverBefore[p]) kinds[p] = UNCOVERED
    else kinds[p] = INSIDE_CHANGE
  }
  return kinds
}
