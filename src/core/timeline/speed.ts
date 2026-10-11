import { type Micros } from '../time'

/** Tempo range of a video clip, in x. 0.1x is ten times slower, 100x a hundred times faster. */
export const SPEED_MIN = 0.1
export const SPEED_MAX = 100
/** Quick choices in the speed dialog. Speed 1 is normal tempo. */
export const SPEED_PRESETS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 4]
/**
 * Above this tempo a clip is silent: the sound would be too fast to follow. Used by the audio mix and
 * by the timeline's original-audio lane, so both agree.
 */
export const AUDIO_MAX_SPEED = 4

/** Speeds keep three decimals; the timeline length is rounded to whole microseconds anyway. */
const SPEED_DECIMALS = 1000

export function isSpeedInRange(v: number): boolean {
  return Number.isFinite(v) && v >= SPEED_MIN && v <= SPEED_MAX
}

export function hasClipSound(speed: number): boolean {
  return speed <= AUDIO_MAX_SPEED
}

/** Timeline length of a source range played at speed, in whole microseconds (at least one unit is the caller's check). */
export function timelineLength(sourceLength: Micros, speed: number): Micros {
  return Math.round(sourceLength / speed)
}

export type SpeedInput =
  | { ok: true; speed: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'range' }

/**
 * Reads the free speed field: plain decimals, a comma is accepted too ("0,5"). Out-of-range values are
 * rejected, not clamped, so the student sees the limit.
 */
export function parseSpeedInput(text: string): SpeedInput {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return { ok: false, reason: 'empty' }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return { ok: false, reason: 'invalid' }
  const value = Number(trimmed)
  if (!isSpeedInRange(value)) return { ok: false, reason: 'range' }
  return { ok: true, speed: Math.round(value * SPEED_DECIMALS) / SPEED_DECIMALS }
}
