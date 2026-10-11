/** Time in whole microseconds, matching WebCodecs timestamps. */
export type Micros = number

export const MICROS_PER_SECOND = 1_000_000

export function secondsToMicros(seconds: number): Micros {
  return Math.round(seconds * MICROS_PER_SECOND)
}

export function microsToSeconds(t: Micros): number {
  return t / MICROS_PER_SECOND
}

/**
 * Exact rational value of the decimal written by String(x), e.g. 29.97 -> 2997/100.
 * Using the decimal form avoids the binary double error (29.97 is stored slightly low).
 */
function exactRatio(x: number): { num: bigint; den: bigint } {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(x))
  if (!match) {
    throw new RangeError(`cannot convert ${x} to a decimal ratio`)
  }
  const fraction = match[2] ?? ''
  const exponent = Number(match[3] ?? 0) - fraction.length
  let num = BigInt(match[1] + fraction)
  let den = 1n
  if (exponent >= 0) {
    num *= 10n ** BigInt(exponent)
  } else {
    den = 10n ** BigInt(-exponent)
  }
  return { num, den }
}

function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`fps must be a positive finite number, got ${fps}`)
  }
}

function assertTime(t: Micros): void {
  if (!Number.isSafeInteger(t) || t < 0) {
    throw new RangeError(`time must be a non-negative integer, got ${t}`)
  }
}

export function frameDuration(fps: number): Micros {
  return frameStart(1, fps)
}

export function frameIndexAt(t: Micros, fps: number): number {
  assertFps(fps)
  assertTime(t)
  const { num, den } = exactRatio(fps)
  // All operands are non-negative, so BigInt division is floor division.
  return Number((BigInt(t) * num) / (den * BigInt(MICROS_PER_SECOND)))
}

export function frameStart(index: number, fps: number): Micros {
  assertFps(fps)
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError(`frame index must be a non-negative integer, got ${index}`)
  }
  const { num, den } = exactRatio(fps)
  // round(index * 1e6 / fps) with half-up rounding, computed exactly.
  const n = BigInt(index) * BigInt(MICROS_PER_SECOND) * den
  return Number((2n * n + num) / (2n * num))
}

export function snapToFrame(t: Micros, fps: number): Micros {
  return frameStart(frameIndexAt(t, fps), fps)
}

/**
 * Formats as MM:SS:FF. Frames are counted at the nominal (rounded) rate, so
 * 29.97 fps is labelled like 30 fps (non-drop-frame timecode).
 */
export function formatTimecode(t: Micros, fps: number): string {
  assertFps(fps)
  const nominal = Math.max(1, Math.round(fps))
  const frame = frameIndexAt(t, nominal)
  const ff = frame % nominal
  const totalSeconds = Math.floor(frame / nominal)
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60)
  return `${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}
