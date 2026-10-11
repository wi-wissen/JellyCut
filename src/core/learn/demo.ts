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

export interface JumpSteps {
  /** Keyframe the player starts from (frame index, 0 based). */
  keyframe: number
  /** Frames rebuilt one after another, from the frame after the keyframe up to the target. */
  rebuild: number[]
}

/** Frames a player rebuilds to show `target` when keyframes come every `keyframeEvery` frames. */
export function jumpSteps(target: number, keyframeEvery: number): JumpSteps {
  const keyframe = Math.floor(target / keyframeEvery) * keyframeEvery
  const rebuild: number[] = []
  for (let frame = keyframe + 1; frame <= target; frame++) rebuild.push(frame)
  return { keyframe, rebuild }
}

/** Small seeded PRNG (mulberry32): the same seed always gives the same numbers. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Loudness per bar, 0 to 1, for the demo track. Several tones with unrelated frequencies, noise and
 * an envelope with quiet gaps: irregular, and the same for the same seed.
 */
export function demoWaveform(count: number, seed = 7): number[] {
  const random = seededRandom(seed)
  const tones = Array.from({ length: 4 }, (_, k) => ({
    frequency: 0.9 + k * 0.83 + random() * 0.6,
    phase: random() * Math.PI * 2,
    weight: 0.4 + random() * 0.6
  }))
  const bursts = Array.from({ length: 5 }, () => ({ centre: random() * count, width: count * (0.04 + random() * 0.08) }))
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    let tone = 0
    let weight = 0
    for (const t of tones) {
      tone += t.weight * Math.sin(i * t.frequency + t.phase)
      weight += t.weight
    }
    const burst = bursts.reduce((max, b) => Math.max(max, Math.exp(-(((i - b.centre) / b.width) ** 2))), 0)
    const envelope = 0.05 + 0.95 * burst
    const noise = random() * 2 - 1
    values.push(envelope * Math.abs(0.55 * (tone / weight) + 0.45 * noise))
  }
  const peak = Math.max(...values, 1e-9)
  return values.map((v) => v / peak)
}
