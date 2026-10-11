import { describe, expect, it } from 'vitest'
import { FIRST_MELODY, SECOND_MELODY, melodySampleCount, renderMelody } from './melody'

describe('renderMelody', () => {
  it('has exactly the sample count of its notes at the given rate', () => {
    const notes = [
      { frequency: 220, seconds: 1 },
      { frequency: 330, seconds: 0.5 }
    ]
    expect(renderMelody(notes, 8000).length).toBe(12000)
    expect(renderMelody(notes, 48000).length).toBe(72000)
    expect(melodySampleCount(notes, 44100)).toBe(66150)
  })

  it('produces finite samples inside [-1, 1]', () => {
    const samples = renderMelody(FIRST_MELODY, 48000)
    let peak = 0
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true)
      peak = Math.max(peak, Math.abs(s))
    }
    expect(peak).toBeGreaterThan(0.1)
    expect(peak).toBeLessThanOrEqual(1)
  })

  it('fades in and out at every note edge', () => {
    const rate = 48000
    const notes = [
      { frequency: 440, seconds: 0.5 },
      { frequency: 660, seconds: 0.5 }
    ]
    const samples = renderMelody(notes, rate)
    const boundary = 0.5 * rate
    // First and last sample of each note sit at zero, and the first few milliseconds are quiet.
    expect(Math.abs(samples[0] ?? 1)).toBe(0)
    expect(Math.abs(samples[boundary - 1] ?? 1)).toBeLessThan(0.01)
    expect(Math.abs(samples[boundary] ?? 1)).toBeLessThan(0.01)
    expect(Math.abs(samples[samples.length - 1] ?? 1)).toBeLessThan(0.01)
    const middle = Math.floor(0.25 * rate)
    let loudInMiddle = 0
    for (let i = middle; i < middle + 100; i++) loudInMiddle = Math.max(loudInMiddle, Math.abs(samples[i] ?? 0))
    expect(loudInMiddle).toBeGreaterThan(0.1)
  })

  it('handles zero-length and empty input', () => {
    expect(renderMelody([], 48000).length).toBe(0)
    expect(renderMelody([{ frequency: 440, seconds: 0 }], 48000).length).toBe(0)
  })

  it('built-in melodies fill the example clip lengths exactly', () => {
    expect(melodySampleCount(FIRST_MELODY, 48000)).toBe(6 * 48000)
    expect(melodySampleCount(SECOND_MELODY, 48000)).toBe(4 * 48000)
  })
})
