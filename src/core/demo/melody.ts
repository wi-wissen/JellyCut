/** One note of a generated melody. */
export interface MelodyNote {
  /** Frequency in hertz. */
  frequency: number
  /** Length in seconds. Sample counts are rounded per note, so the total length is exact. */
  seconds: number
}

const FADE_SECONDS = 0.02
const OUTPUT_GAIN = 0.3
/** The second tone sits a fifth above the melody note and is quieter, which keeps it gentle. */
const FIFTH_RATIO = 1.5
const FIFTH_GAIN = 0.35

export function noteSampleCount(seconds: number, sampleRate: number): number {
  return Math.max(0, Math.round(seconds * sampleRate))
}

export function melodySampleCount(notes: readonly MelodyNote[], sampleRate: number): number {
  return notes.reduce((sum, note) => sum + noteSampleCount(note.seconds, sampleRate), 0)
}

/**
 * Mono samples in [-1, 1] for the notes in order. Every note fades in and out at its edges, so the
 * notes start and stop without clicks.
 */
export function renderMelody(notes: readonly MelodyNote[], sampleRate: number): Float32Array {
  const out = new Float32Array(melodySampleCount(notes, sampleRate))
  let offset = 0
  for (const note of notes) {
    const count = noteSampleCount(note.seconds, sampleRate)
    const fade = Math.max(1, Math.min(Math.floor(count / 2), Math.round(FADE_SECONDS * sampleRate)))
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate
      const tone =
        Math.sin(2 * Math.PI * note.frequency * t) +
        FIFTH_GAIN * Math.sin(2 * Math.PI * note.frequency * FIFTH_RATIO * t)
      const envelope = Math.min(1, i / fade, (count - 1 - i) / fade)
      out[offset + i] = Math.max(-1, Math.min(1, OUTPUT_GAIN * envelope * tone))
    }
    offset += count
  }
  return out
}

const C5 = 523.25
const D5 = 587.33
const E5 = 659.25
const G5 = 783.99
const A5 = 880
const F5 = 698.46
const G4 = 392
const B4 = 493.88
const A4 = 440

/** Twelve half-second notes: six seconds. */
export const FIRST_MELODY: readonly MelodyNote[] = [C5, E5, G5, E5, D5, F5, A5, F5, E5, G5, C5, C5].map((frequency) => ({
  frequency,
  seconds: 0.5
}))

/** Eight half-second notes: four seconds. */
export const SECOND_MELODY: readonly MelodyNote[] = [G4, B4, D5, B4, A4, C5, E5, C5].map((frequency) => ({
  frequency,
  seconds: 0.5
}))
