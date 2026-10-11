import { describe, expect, it } from 'vitest'
import { clampSamples, mixSegmentInto, type Pcm } from './pcm'
import type { AudioSegment } from './mix'

const S = 1_000_000
const RATE = 48_000

function segment(extra: Partial<AudioSegment> = {}): AudioSegment {
  return {
    kind: 'clip', sourceId: 'c', assetId: 'a', srcStart: 0, srcEnd: 2 * S, timelineStart: 0, timelineEnd: 2 * S,
    speed: 1, envelope: [{ t: 0, gain: 1 }], ...extra
  }
}
/** A mono signal whose value at every frame equals its own time in seconds. */
function rampPcm(seconds: number, rate = RATE, startTime = 0, channels = 1): Pcm {
  const n = Math.round(seconds * rate)
  const ch = () => Float32Array.from({ length: n }, (_, i) => startTime / S + i / rate)
  return { sampleRate: rate, startTime, channels: Array.from({ length: channels }, ch) }
}
function constPcm(value: number, seconds: number, rate = RATE, channels = 1): Pcm {
  const n = Math.round(seconds * rate)
  return { sampleRate: rate, startTime: 0, channels: Array.from({ length: channels }, () => new Float32Array(n).fill(value)) }
}
const silence = (seconds: number, channels = 2) => Array.from({ length: channels }, () => new Float32Array(Math.round(seconds * RATE)))

describe('mixSegmentInto', () => {
  it('writes the scaled source at the timeline position and nothing outside the segment', () => {
    const out = silence(3)
    mixSegmentInto(out, 0, RATE, segment({ timelineStart: S, timelineEnd: 2 * S, srcEnd: S, envelope: [{ t: 0, gain: 0.5 }] }), constPcm(1, 1))
    expect(out[0]![RATE - 1]).toBe(0)
    expect(out[0]![RATE]).toBeCloseTo(0.5, 6)
    expect(out[0]![2 * RATE - 1]).toBeCloseTo(0.5, 6)
    expect(out[0]![2 * RATE]).toBe(0)
    expect(out[1]![RATE + 100]).toBeCloseTo(0.5, 6)
  })
  it('upmixes a mono source to both output channels and keeps stereo channels apart', () => {
    const out = silence(1)
    mixSegmentInto(out, 0, RATE, segment({ srcEnd: S, timelineEnd: S }), constPcm(0.25, 1))
    expect(out[0]![10]).toBeCloseTo(0.25, 6)
    expect(out[1]![10]).toBeCloseTo(0.25, 6)
    const stereo: Pcm = { sampleRate: RATE, startTime: 0, channels: [new Float32Array(RATE).fill(0.1), new Float32Array(RATE).fill(0.9)] }
    const out2 = silence(1)
    mixSegmentInto(out2, 0, RATE, segment({ srcEnd: S, timelineEnd: S }), stereo)
    expect(out2[0]![10]).toBeCloseTo(0.1, 6)
    expect(out2[1]![10]).toBeCloseTo(0.9, 6)
  })
  it('adds to what is already in the buffer (mixing)', () => {
    const out = silence(1)
    const seg = segment({ srcEnd: S, timelineEnd: S })
    mixSegmentInto(out, 0, RATE, seg, constPcm(0.3, 1))
    mixSegmentInto(out, 0, RATE, seg, constPcm(0.2, 1))
    expect(out[0]![500]).toBeCloseTo(0.5, 6)
  })
  it('plays the source at the segment speed (speed 2 reads twice as fast)', () => {
    const out = silence(1)
    mixSegmentInto(out, 0, RATE, segment({ srcEnd: 2 * S, timelineEnd: S, speed: 2 }), rampPcm(2))
    // At timeline time 0.5 s the source time is 1.0 s, and the ramp equals the source time.
    expect(out[0]![RATE / 2]).toBeCloseTo(1.0, 3)
    expect(out[0]![RATE / 4]).toBeCloseTo(0.5, 3)
  })
  it('honours srcStart and a source buffer that starts later than 0', () => {
    const out = silence(1)
    mixSegmentInto(out, 0, RATE, segment({ srcStart: 3 * S, srcEnd: 4 * S, timelineEnd: S }), rampPcm(1.5, RATE, 2.75 * S))
    expect(out[0]![0]).toBeCloseTo(3.0, 3)
    expect(out[0]![RATE / 2]).toBeCloseTo(3.5, 3)
  })
  it('resamples between sample rates (44.1 kHz source into 48 kHz output)', () => {
    const out = silence(1)
    mixSegmentInto(out, 0, RATE, segment({ srcEnd: S, timelineEnd: S }), rampPcm(1, 44_100))
    expect(out[0]![RATE / 2]).toBeCloseTo(0.5, 3)
    expect(out[0]![RATE - 10]).toBeCloseTo((RATE - 10) / RATE, 3)
  })
  it('applies the gain envelope over time', () => {
    const out = silence(1)
    mixSegmentInto(out, 0, RATE, segment({ srcEnd: S, timelineEnd: S, envelope: [{ t: 0, gain: 0 }, { t: S, gain: 1 }] }), constPcm(1, 1))
    expect(out[0]![0]).toBeCloseTo(0, 4)
    expect(out[0]![RATE / 2]).toBeCloseTo(0.5, 3)
    expect(out[0]![RATE - 1]).toBeCloseTo(1, 3)
  })
  it('contributes zero where the source buffer has no data', () => {
    const out = silence(2)
    mixSegmentInto(out, 0, RATE, segment(), constPcm(1, 1))
    expect(out[0]![RATE / 2]).toBeCloseTo(1, 6)
    expect(out[0]![RATE + 10]).toBe(0)
  })
  it('chunked mixing equals mixing everything at once (no clicks at chunk borders)', () => {
    const seg = segment({ srcStart: 0.3 * S, srcEnd: 1.7 * S, timelineStart: 0.5 * S, timelineEnd: 1.9 * S, envelope: [{ t: 0.5 * S, gain: 0 }, { t: 0.6 * S, gain: 0.8 }, { t: 1.8 * S, gain: 0.8 }, { t: 1.9 * S, gain: 0 }] })
    const src = rampPcm(2, 44_100)
    const whole = silence(2)
    mixSegmentInto(whole, 0, RATE, seg, src)
    const a = silence(0.7)
    const b = silence(1.3)
    mixSegmentInto(a, 0, RATE, seg, src)
    mixSegmentInto(b, Math.round(0.7 * S), RATE, seg, src)
    for (let i = 0; i < a[0]!.length; i++) expect(a[0]![i]).toBeCloseTo(whole[0]![i]!, 6)
    for (let i = 0; i < b[0]!.length; i++) expect(b[0]![i]).toBeCloseTo(whole[0]![a[0]!.length + i]!, 6)
  })
  it('does not change the source and never produces NaN', () => {
    const src = rampPcm(1)
    const copy = Float32Array.from(src.channels[0]!)
    const out = silence(1)
    mixSegmentInto(out, 0, RATE, segment({ srcEnd: S, timelineEnd: S, speed: 0.37 }), src)
    expect(src.channels[0]).toEqual(copy)
    expect(out[0]!.every((v) => Number.isFinite(v))).toBe(true)
  })
  it('ignores segments that do not overlap the output chunk', () => {
    const out = silence(1)
    mixSegmentInto(out, 5 * S, RATE, segment(), constPcm(1, 2))
    expect(out[0]!.every((v) => v === 0)).toBe(true)
  })
})

describe('clampSamples', () => {
  it('limits to [-1, 1] and leaves quiet samples alone', () => {
    const ch = [Float32Array.from([0.5, 1.7, -3, -0.2]), Float32Array.from([2, 0, -1, 0.99])]
    clampSamples(ch)
    expect(Array.from(ch[0]!)).toEqual([0.5, 1, -1, Float32Array.from([-0.2])[0]])
    expect(Array.from(ch[1]!)).toEqual([1, 0, -1, Float32Array.from([0.99])[0]])
  })
})
