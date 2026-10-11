import { describe, expect, it } from 'vitest'
import { BASE_BIN, createPeakAccumulator, findPauses, nextPause, peaksForRange, type Waveform } from './peaks'

const RATE = 48_000
const S = 1_000_000

function sine(seconds: number, amp: number, freq = 440, rate = RATE): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate))
}
function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
function build(data: Float32Array, rate = RATE, chunk = 4096): Waveform {
  const acc = createPeakAccumulator(rate)
  for (let i = 0; i < data.length; i += chunk) acc.push([data.subarray(i, i + chunk)])
  return acc.finish()
}

describe('createPeakAccumulator', () => {
  it('uses 5 ms base bins and reports the duration', () => {
    expect(BASE_BIN).toBe(5_000)
    const wf = build(sine(2, 0.5))
    expect(wf.duration).toBe(2 * S)
    expect(wf.levels[0]!.binMicros).toBe(BASE_BIN)
    expect(wf.levels[0]!.peaks.length).toBe(400)
  })
  it('records the maximum absolute amplitude of each bin', () => {
    const wf = build(sine(1, 0.5))
    for (const p of wf.levels[0]!.peaks) {
      expect(p).toBeGreaterThan(0.45)
      expect(p).toBeLessThanOrEqual(0.5 + 1e-6)
    }
  })
  it('sees negative peaks and quiet passages', () => {
    const data = concat(new Float32Array(RATE).fill(0), new Float32Array(RATE).fill(-0.8))
    const wf = build(data)
    expect(wf.levels[0]!.peaks[10]).toBe(0)
    expect(wf.levels[0]!.peaks[300]).toBeCloseTo(0.8, 5)
  })
  it('takes the maximum over all channels', () => {
    const acc = createPeakAccumulator(RATE)
    acc.push([new Float32Array(RATE).fill(0.1), new Float32Array(RATE).fill(0.9)])
    expect(acc.finish().levels[0]!.peaks[5]).toBeCloseTo(0.9, 5)
  })
  it('gives the same result however the audio is cut into chunks (also odd sizes)', () => {
    const data = sine(3, 0.7, 123)
    const a = build(data, RATE, 4096)
    const b = build(data, RATE, 777)
    const c = build(data, RATE, data.length)
    for (const wf of [b, c]) {
      expect(wf.levels.length).toBe(a.levels.length)
      for (let l = 0; l < a.levels.length; l++) {
        expect(Array.from(wf.levels[l]!.peaks)).toEqual(Array.from(a.levels[l]!.peaks))
      }
    }
  })
  it('works for 44.1 kHz input and keeps the time axis right', () => {
    const wf = build(sine(2, 0.5, 440, 44_100), 44_100)
    expect(wf.duration).toBe(2 * S)
    expect(wf.levels[0]!.peaks.length).toBe(400)
  })
  it('builds coarser levels, each 4x coarser, holding the max of their children', () => {
    const wf = build(concat(new Float32Array(RATE).fill(0.1), new Float32Array(RATE).fill(0.6)))
    expect(wf.levels.length).toBeGreaterThan(3)
    for (let l = 1; l < wf.levels.length; l++) {
      expect(wf.levels[l]!.binMicros).toBe(wf.levels[l - 1]!.binMicros * 4)
      const fine = wf.levels[l - 1]!.peaks
      const coarse = wf.levels[l]!.peaks
      expect(coarse.length).toBe(Math.ceil(fine.length / 4))
      for (let i = 0; i < coarse.length; i++) {
        let max = 0
        for (let k = i * 4; k < Math.min(fine.length, i * 4 + 4); k++) max = Math.max(max, fine[k]!)
        expect(coarse[i]).toBe(max)
      }
    }
  })
  it('handles empty input', () => {
    const wf = createPeakAccumulator(RATE).finish()
    expect(wf.duration).toBe(0)
    expect(wf.levels[0]!.peaks.length).toBe(0)
  })
})

describe('peaksForRange', () => {
  const data = concat(new Float32Array(RATE).fill(0.1), new Float32Array(RATE).fill(0.9), new Float32Array(RATE).fill(0.3))
  const wf = build(data)
  it('returns the requested number of bins with the max of each time slice', () => {
    const p = peaksForRange(wf, 0, 3 * S, 3)
    expect(p.length).toBe(3)
    expect(p[0]).toBeCloseTo(0.1, 5)
    expect(p[1]).toBeCloseTo(0.9, 5)
    expect(p[2]).toBeCloseTo(0.3, 5)
  })
  it('zooms into a sub range and still sees short loud events', () => {
    const p = peaksForRange(wf, 900_000, 1_100_000, 4)
    expect(p.length).toBe(4)
    expect(p[0]).toBeCloseTo(0.1, 5)
    expect(p[3]).toBeCloseTo(0.9, 5)
  })
  it('returns zeros outside the audio and clamps the range', () => {
    const p = peaksForRange(wf, 5 * S, 6 * S, 5)
    expect(Array.from(p)).toEqual([0, 0, 0, 0, 0])
    const q = peaksForRange(wf, -1 * S, 0, 2)
    expect(Array.from(q)).toEqual([0, 0])
  })
  it('handles huge bin counts and tiny ranges without NaN', () => {
    const p = peaksForRange(wf, 0, 1000, 500)
    expect(p.length).toBe(500)
    expect(Array.from(p).every((v) => Number.isFinite(v))).toBe(true)
    expect(peaksForRange(wf, 0, 0, 3).length).toBe(3)
  })
})

describe('findPauses', () => {
  const speech = (s: number) => sine(s, 0.5, 200)
  const quiet = (s: number) => new Float32Array(Math.round(s * RATE)).fill(0.001)
  const wf = build(concat(speech(1), quiet(0.5), speech(1), quiet(0.2), speech(1), quiet(0.8)))
  it('marks passages below the threshold that last long enough', () => {
    const pauses = findPauses(wf, { thresholdDb: -40, minDuration: 300_000 })
    expect(pauses).toHaveLength(2)
    expect(pauses[0]!.start).toBeGreaterThanOrEqual(0.99 * S)
    expect(pauses[0]!.start).toBeLessThanOrEqual(1.01 * S)
    expect(pauses[0]!.end).toBeGreaterThanOrEqual(1.49 * S)
    expect(pauses[0]!.end).toBeLessThanOrEqual(1.51 * S)
    expect(pauses[1]!.end).toBe(wf.duration)
  })
  it('ignores shorter pauses and reacts to the threshold', () => {
    expect(findPauses(wf, { thresholdDb: -40, minDuration: 600_000 })).toHaveLength(1)
    expect(findPauses(wf, { thresholdDb: -40, minDuration: 100_000 })).toHaveLength(3)
    expect(findPauses(wf, { thresholdDb: -80, minDuration: 100_000 })).toHaveLength(0)
  })
  it('has sane defaults (-40 dB, 0.3 s)', () => {
    expect(findPauses(wf)).toHaveLength(2)
  })
  it('returns nothing for empty audio and one pause for pure silence', () => {
    expect(findPauses(createPeakAccumulator(RATE).finish())).toEqual([])
    const silent = build(new Float32Array(RATE * 2))
    expect(findPauses(silent)).toEqual([{ start: 0, end: 2 * S }])
  })
})

describe('nextPause', () => {
  const pauses = [{ start: 1 * S, end: 2 * S }, { start: 4 * S, end: 5 * S }, { start: 8 * S, end: 9 * S }]
  it('finds the next pause start after t, or the previous one before t', () => {
    expect(nextPause(pauses, 0, 1)).toEqual(pauses[0])
    expect(nextPause(pauses, 1 * S, 1)).toEqual(pauses[1])
    expect(nextPause(pauses, 4.5 * S, 1)).toEqual(pauses[2])
    expect(nextPause(pauses, 8 * S, 1)).toBeNull()
    expect(nextPause(pauses, 10 * S, -1)).toEqual(pauses[2])
    expect(nextPause(pauses, 8 * S, -1)).toEqual(pauses[1])
    expect(nextPause(pauses, 1 * S, -1)).toBeNull()
  })
  it('handles an empty list', () => {
    expect(nextPause([], 0, 1)).toBeNull()
    expect(nextPause([], 0, -1)).toBeNull()
  })
})
