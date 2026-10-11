import { describe, expect, it } from 'vitest'
import { createPeakAccumulator, peaksForRange } from './peaks'

const RATE = 48_000
const CHUNK_SECONDS = 1
const MINUTES = 50

/** Cheap deterministic pattern, max |sample| 0.495. */
function pattern(): Float32Array[] {
  const chunk = Float32Array.from({ length: RATE * CHUNK_SECONDS }, (_, i) => ((i * 7) % 100) / 200)
  return [chunk, chunk]
}

describe('peak accumulator performance', () => {
  const chunks = pattern()
  const seconds = MINUTES * 60
  let wf = createPeakAccumulator(RATE).finish()
  let elapsed = 0

  it('accumulates 50 minutes of 48 kHz stereo in a few seconds into 600 000 finest bins', () => {
    const acc = createPeakAccumulator(RATE)
    const started = performance.now()
    for (let s = 0; s < seconds; s++) acc.push(chunks)
    wf = acc.finish()
    elapsed = performance.now() - started

    expect(wf.duration).toBe(seconds * 1_000_000)
    expect(wf.levels[0]!.peaks.length).toBe(600_000)
    expect(elapsed).toBeLessThan(5000)
  })

  it('computes 2000 output bins over the whole recording in under 50 ms', () => {
    const started = performance.now()
    const out = peaksForRange(wf, 0, wf.duration, 2000)
    const took = performance.now() - started

    expect(out.length).toBe(2000)
    expect(took).toBeLessThan(50)
    expect(out[0]).toBeCloseTo(0.495, 3)
    expect(out[1999]).toBeCloseTo(0.495, 3)
  })
})
