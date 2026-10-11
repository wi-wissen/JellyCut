import type { AudioSegment } from './mix'
import type { Micros } from '../time'

const MICROS = 1_000_000
const EDGE_EPSILON = 1e-6 // in source samples

/** Decoded source audio, planar. `startTime` is the source time of sample 0. */
export interface Pcm {
  sampleRate: number
  startTime: Micros
  channels: Float32Array[]
}

/**
 * Adds the segment's audio into the planar output chunk `out`, whose first frame
 * sits at timeline time `outStart`. Frame n is at outStart + n * 1e6 / outRate.
 */
export function mixSegmentInto(out: Float32Array[], outStart: Micros, outRate: number, seg: AudioSegment, src: Pcm): void {
  const frames = out[0]?.length ?? 0
  const srcLength = src.channels[0]?.length ?? 0
  if (frames === 0 || srcLength === 0 || src.channels.length === 0) return
  if (!(outRate > 0) || !(src.sampleRate > 0) || !(seg.speed > 0)) return

  const frameTime = (n: number): number => outStart + (n * MICROS) / outRate
  const firstFrame = firstFrameAtOrAfter(outStart, outRate, seg.timelineStart, frames, frameTime)
  const endFrame = firstFrameAtOrAfter(outStart, outRate, seg.timelineEnd, frames, frameTime)
  const points = seg.envelope
  if (firstFrame >= endFrame || points.length === 0) return

  const first = points[0]!
  const last = points[points.length - 1]!
  const lastPoint = points.length - 1
  const srcPerMicro = src.sampleRate / MICROS
  const srcOffset = seg.srcStart - src.startTime
  const srcChannels = src.channels.length
  let k = 0 // envelope interval [points[k], points[k + 1]] containing the current time

  for (let n = firstFrame; n < endFrame; n++) {
    const t = frameTime(n)

    let gain: number
    if (t < first.t) {
      gain = first.gain
    } else if (t >= last.t) {
      gain = last.gain
    } else {
      while (k < lastPoint - 1 && t >= points[k + 1]!.t) k++
      const a = points[k]!
      const b = points[k + 1]!
      gain = b.t === a.t ? b.gain : a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t)
    }
    if (gain === 0 || !Number.isFinite(gain)) continue

    let idx = (srcOffset + (t - seg.timelineStart) * seg.speed) * srcPerMicro
    // Tolerate float noise at the buffer edges (exact index can be 47999 while computed as 47999.0000001).
    if (idx < 0 && idx > -EDGE_EPSILON) idx = 0
    if (idx > srcLength - 1 && idx < srcLength - 1 + EDGE_EPSILON) idx = srcLength - 1
    if (!(idx >= 0 && idx <= srcLength - 1)) continue
    const i0 = Math.floor(idx)
    const i1 = i0 + 1 < srcLength ? i0 + 1 : i0
    const frac = idx - i0

    for (let c = 0; c < out.length; c++) {
      const data = src.channels[srcChannels === 1 ? 0 : Math.min(c, srcChannels - 1)]!
      const a = data[i0]!
      const b = data[i1]!
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      out[c]![n]! += (a + (b - a) * frac) * gain
    }
  }
}

/** Hard-clamps every sample to [-1, 1] in place; NaN becomes 0. */
export function clampSamples(channels: Float32Array[]): void {
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!
      data[i] = v > 1 ? 1 : v < -1 ? -1 : v === v ? v : 0
    }
  }
}

/**
 * Smallest frame index n in [0, frames] whose time is at or after `time`, so the
 * half-open range [firstFrameAtOrAfter(start), firstFrameAtOrAfter(end)) holds
 * exactly the frames with start <= t < end.
 */
function firstFrameAtOrAfter(outStart: Micros, outRate: number, time: Micros, frames: number, frameTime: (n: number) => number): number {
  const estimate = Math.ceil(((time - outStart) * outRate) / MICROS)
  let n = Number.isFinite(estimate) ? Math.min(frames, Math.max(0, estimate)) : 0
  while (n > 0 && frameTime(n - 1) >= time) n--
  while (n < frames && frameTime(n) < time) n++
  return n
}
