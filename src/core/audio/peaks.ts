import { MICROS_PER_SECOND, type Micros } from '../time'

/** Finest bin width. Each coarser level is BIN_RATIO times wider. */
export const BASE_BIN: Micros = 5_000
const BIN_RATIO = 4
const BINS_PER_SECOND = MICROS_PER_SECOND / BASE_BIN

export interface PeakLevel {
  binMicros: Micros
  /** Max absolute amplitude per bin, across all channels. */
  peaks: Float32Array
}

export interface Waveform {
  duration: Micros
  /** levels[0] is the finest level; each next level is BIN_RATIO times coarser. */
  levels: PeakLevel[]
}

export interface Pause {
  start: Micros
  end: Micros
}

export interface PeakAccumulator {
  push(channels: Float32Array[]): void
  finish(): Waveform
}

export function createPeakAccumulator(sampleRate: number): PeakAccumulator {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`sampleRate must be a positive finite number, got ${sampleRate}`)
  }
  let frames = 0
  let peaks = new Float32Array(1024)
  let bin = -1
  // First frame index that belongs to the next bin. Bin changes are found from the
  // integer frame index, so no float error accumulates over long inputs.
  let nextBinStart = 0

  return {
    push(channels) {
      const n = channels[0]?.length ?? 0
      for (let j = 0; j < n; j++) {
        const i = frames + j
        if (i >= nextBinStart) {
          bin = Math.floor((i * BINS_PER_SECOND) / sampleRate)
          nextBinStart = Math.max(i + 1, Math.ceil(((bin + 1) * sampleRate) / BINS_PER_SECOND))
          if (bin >= peaks.length) {
            const grown = new Float32Array(Math.max(bin + 1, peaks.length * 2))
            grown.set(peaks)
            peaks = grown
          }
        }
        let m = peaks[bin]!
        for (let c = 0; c < channels.length; c++) {
          const x = channels[c]![j]!
          const a = x < 0 ? -x : x
          // NaN and infinite samples fail these comparisons and count as 0.
          if (a > m && a < Infinity) m = a
        }
        peaks[bin] = m
      }
      frames += n
    },

    finish() {
      const duration = Math.round((frames * MICROS_PER_SECOND) / sampleRate)
      const count = Math.max(Math.ceil(duration / BASE_BIN), bin + 1)
      const base = new Float32Array(count)
      base.set(peaks.subarray(0, Math.min(count, peaks.length)))
      return { duration, levels: buildLevels(base) }
    },
  }
}

function buildLevels(base: Float32Array): PeakLevel[] {
  const levels: PeakLevel[] = [{ binMicros: BASE_BIN, peaks: base }]
  let prev = base
  let binMicros = BASE_BIN
  while (prev.length > 1) {
    const next = new Float32Array(Math.ceil(prev.length / BIN_RATIO))
    for (let i = 0; i < prev.length; i++) {
      const t = Math.floor(i / BIN_RATIO)
      if (prev[i]! > next[t]!) next[t] = prev[i]!
    }
    binMicros *= BIN_RATIO
    levels.push({ binMicros, peaks: next })
    prev = next
  }
  return levels
}

/**
 * Max amplitude for `bins` equal slices of [start, end). Outside [0, duration)
 * yields 0.
 */
export function peaksForRange(wf: Waveform, start: Micros, end: Micros, bins: number): Float32Array {
  const count = Math.max(0, Math.floor(bins))
  const out = new Float32Array(count)
  if (count === 0 || !(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) return out

  const width = (end - start) / count
  const level = chooseLevel(wf, start, width)
  const binMicros = level.binMicros
  const peaks = level.peaks
  for (let k = 0; k < count; k++) {
    const a = start + k * width
    const b = start + (k + 1) * width
    if (b <= 0 || a >= wf.duration) continue
    const lo = Math.max(0, Math.floor(a / binMicros))
    const hi = Math.min(peaks.length - 1, Math.ceil(b / binMicros) - 1)
    let m = 0
    for (let j = lo; j <= hi; j++) {
      if (peaks[j]! > m) m = peaks[j]!
    }
    out[k] = m
  }
  return out
}

/**
 * Coarsest level no wider than the output bin. Prefers levels whose bins tile the
 * output exactly, so that a coarse bin never leaks into a neighbouring output bin.
 */
function chooseLevel(wf: Waveform, start: Micros, width: number): PeakLevel {
  const levels = wf.levels
  for (let l = levels.length - 1; l >= 0; l--) {
    const level = levels[l]!
    if (level.binMicros > width) continue
    if (isWhole(width / level.binMicros) && isWhole(start / level.binMicros)) return level
  }
  for (let l = levels.length - 1; l >= 0; l--) {
    if (levels[l]!.binMicros <= width) return levels[l]!
  }
  return levels[0]!
}

function isWhole(x: number): boolean {
  return Math.abs(x - Math.round(x)) < 1e-9
}

/** Pauses are the quiet runs of the finest level that last at least minDuration. */
export function findPauses(
  wf: Waveform,
  options: { thresholdDb?: number; minDuration?: Micros } = {},
): Pause[] {
  const thresholdDb = options.thresholdDb ?? -40
  const minDuration = options.minDuration ?? 300_000
  const base = wf.levels[0]
  if (!base || base.peaks.length === 0) return []

  const limit = 10 ** (thresholdDb / 20)
  const binMicros = base.binMicros
  const peaks = base.peaks
  const pauses: Pause[] = []
  const closeRun = (first: number, after: number) => {
    const start = first * binMicros
    const end = Math.min(wf.duration, after * binMicros)
    if (end - start >= minDuration) pauses.push({ start, end })
  }

  let runStart = -1
  for (let j = 0; j <= peaks.length; j++) {
    const quiet = j < peaks.length && peaks[j]! <= limit
    if (quiet) {
      if (runStart < 0) runStart = j
    } else if (runStart >= 0) {
      closeRun(runStart, j)
      runStart = -1
    }
  }
  return pauses
}

export function nextPause(pauses: readonly Pause[], t: Micros, direction: 1 | -1): Pause | null {
  let best: Pause | null = null
  for (const p of pauses) {
    if (direction === 1) {
      if (p.start > t && (best === null || p.start < best.start)) best = p
    } else if (p.start < t && (best === null || p.start > best.start)) {
      best = p
    }
  }
  return best
}
