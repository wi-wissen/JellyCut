import { describe, expect, it } from 'vitest'
import { mixSegmentInto, type Pcm } from './pcm'
import type { AudioSegment } from './mix'

const S = 1_000_000

describe('mixSegmentInto performance', () => {
  it('mixes 60 s of stereo 48 kHz with a 4-point envelope from 44.1 kHz stereo well under 1.5 s', () => {
    const srcFrames = 60 * 44_100
    const src: Pcm = {
      sampleRate: 44_100,
      startTime: 0,
      channels: [0, 1].map((c) => Float32Array.from({ length: srcFrames }, (_, i) => Math.sin(i * 0.01 * (c + 1)) * 0.5))
    }
    const outFrames = 60 * 48_000
    const out = [new Float32Array(outFrames), new Float32Array(outFrames)]
    const seg: AudioSegment = {
      kind: 'clip', sourceId: 'c', assetId: 'a', srcStart: 0, srcEnd: 60 * S, timelineStart: 0, timelineEnd: 60 * S,
      speed: 1, envelope: [{ t: 0, gain: 0 }, { t: 2 * S, gain: 1 }, { t: 58 * S, gain: 1 }, { t: 60 * S, gain: 0 }]
    }

    const started = performance.now()
    mixSegmentInto(out, 0, 48_000, seg, src)
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(1500)
    expect(out[0]!.every((v) => Number.isFinite(v))).toBe(true)
    expect(out[0]![30 * 48_000]).not.toBe(0)
  })
})
