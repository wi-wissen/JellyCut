import { MICROS_PER_SECOND, type Micros } from '../time'

/** Bytes of uncompressed video: every pixel stores red, green and blue, one byte each. */
export function rawVideoBytes(width: number, height: number, fps: number, seconds: number): number {
  return width * height * 3 * fps * seconds
}

/** Index of the frame that is on screen at `time` (frame 0 starts at 0). */
export function frameAt(time: Micros, fps: number): number {
  return Math.floor((time * fps) / MICROS_PER_SECOND)
}

/** Start of the keyframe that a player has to begin with to show `target`. */
export function keyframeBefore(target: Micros, interval: Micros): Micros {
  return Math.floor(target / interval) * interval
}

export interface SeekPlan {
  keyframe: Micros
  /** Frames that have to be rebuilt after the keyframe, up to the target frame. */
  framesToDecode: number
}

export function seekPlan(target: Micros, keyframeInterval: Micros, fps: number): SeekPlan {
  const keyframe = keyframeBefore(target, keyframeInterval)
  return { keyframe, framesToDecode: frameAt(target, fps) - frameAt(keyframe, fps) }
}

/**
 * Share of a full picture that each frame stores (0 to 1). Keyframes store everything,
 * other frames only the pixels that changed since the frame before.
 */
export function storedShares(changed: readonly number[], total: number, keyframeEvery: number): number[] {
  return changed.map((count, index) => (index % keyframeEvery === 0 ? 1 : count / total))
}

/** Per pixel: 1 where the colour differs by more than `threshold` in any channel. RGBA input. */
export function changedMask(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold: number): Uint8Array {
  const mask = new Uint8Array(a.length / 4)
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4
    const diff = Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!))
    mask[p] = diff > threshold ? 1 : 0
  }
  return mask
}

export function countSet(mask: Uint8Array): number {
  let count = 0
  for (const value of mask) count += value
  return count
}

/** Average colour difference of two RGBA images, in percent of the full range (0 to 100). */
export function meanDifferencePercent(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0
  let channels = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(a[i + c]! - b[i + c]!)
      channels++
    }
  }
  return channels === 0 ? 0 : (sum / (channels * 255)) * 100
}
