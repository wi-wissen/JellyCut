import type { Project } from '../project/types'
import type { PlannedTimeline } from '../render/scene'
import { clipEnd } from '../timeline/edit'
import { clipGrade } from '../filters/ops'
import { MICROS_PER_SECOND, type Micros } from '../time'
import { totalFrames } from './presets'
import {
  AUDIO_SECONDS_PER_SECOND,
  BLEND_PASSES,
  BLUR_BACKGROUND_PASSES,
  CODEC_FACTOR,
  DECODE_MP_PER_S,
  DEFAULT_FPS,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DRAW_CALL_SECONDS,
  DRAW_MP_PER_S,
  ENCODE_MP_PER_S,
  FRAME_OVERHEAD_SECONDS,
  GIF_ENCODE_MP_PER_S,
  GIF_READBACK_MP_PER_S,
  GRADE_PASSES,
  RASTER_MP_PER_S,
  REGION_BLUR_PASSES,
  REGION_PASSES,
  STARTUP_SECONDS,
  TEXT_RASTER_SECONDS,
  UPLOAD_MP_PER_S,
  type EstimateCodec
} from './costs'

export type { EstimateCodec } from './costs'

/** Work done by the export, split the way it is measured (see the exporter). Seconds. */
export const PHASES = ['decode', 'draw', 'encode', 'audio', 'fixed'] as const
export type PhaseKey = (typeof PHASES)[number]
export type PhaseSeconds = Record<PhaseKey, number>

/** Multipliers learned per measured group: decode, draw, and encode (which also covers audio and fixed work). */
export type PhaseFactors = Record<'decode' | 'draw' | 'encode', number>

/** Plain projects and projects with a video picture over the video. Their costs differ by a lot. */
export type FeatureClass = 'plain' | 'video'

export function emptyPhases(): PhaseSeconds {
  return { decode: 0, draw: 0, encode: 0, audio: 0, fixed: 0 }
}

export function totalSeconds(phases: PhaseSeconds): number {
  return PHASES.reduce((sum, key) => sum + phases[key], 0)
}

/** Multiplies each phase by its learned factor. Audio and fixed work follow the encoder. */
export function applyFactors(phases: PhaseSeconds, factors: PhaseFactors): PhaseSeconds {
  return {
    decode: phases.decode * factors.decode,
    draw: phases.draw * factors.draw,
    encode: phases.encode * factors.encode,
    audio: phases.audio * factors.encode,
    fixed: phases.fixed * factors.encode
  }
}

export function estimateCodecOf(video: string | null | undefined): EstimateCodec {
  return video === 'vp9' || video === 'av1' ? video : 'avc'
}

export interface ProfileInput {
  project: Project
  planned: PlannedTimeline
  width: number
  height: number
  fps: number
  durationMicros: number
  /** 'gif' reads frames back and quantises them instead of encoding video. */
  kind: 'mp4' | 'gif'
  codec: EstimateCodec
  /** Also return the seconds per output frame, for the progress estimate. */
  withWeights?: boolean
}

export interface ExportProfile {
  frames: number
  /** Uncalibrated seconds per phase. */
  phases: PhaseSeconds
  featureClass: FeatureClass
  /** Uncalibrated seconds per output frame, summing to the phases. Only with withWeights. */
  frameWeights: Float64Array | null
}

/** Seconds of work per second of timeline, by phase. */
type Rates = Partial<PhaseSeconds>

interface Span {
  start: Micros
  end: Micros
  rates: Rates
}

interface OneOff {
  at: Micros
  phase: PhaseKey
  seconds: number
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Predicted work of one export. Every cost is attached to the time span where it happens, so a transition
 * (two clips on screen), a video overlay (its own decode and upload) or a blur region only costs time while
 * it is on screen. Per-second rates times the frames in the span give the totals.
 */
export function profileExport(input: ProfileInput): ExportProfile {
  const { project, planned, width, height, fps, codec } = input
  const duration = Number.isFinite(input.durationMicros) && input.durationMicros > 0 ? Math.round(input.durationMicros) : 0
  const frames = totalFrames(duration, fps)
  const pixels = width * height
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const spans: Span[] = []
  const oneOffs: OneOff[] = []
  const blurBackground = project.format.background?.type !== 'color'

  // Seconds of drawing per timeline second for a number of full-frame passes at the output size.
  const passRate = (passes: number, mpPerS = DRAW_MP_PER_S): number => (pixels * fps * passes) / 1_000_000 / mpPerS
  const drawCallRate = DRAW_CALL_SECONDS * fps

  if (input.kind === 'mp4') {
    spans.push({ start: 0, end: duration, rates: { encode: passRate(1, ENCODE_MP_PER_S) * CODEC_FACTOR[codec], audio: AUDIO_SECONDS_PER_SECOND } })
  } else {
    spans.push({ start: 0, end: duration, rates: { encode: passRate(1, GIF_ENCODE_MP_PER_S), draw: passRate(1, GIF_READBACK_MP_PER_S) } })
  }
  spans.push({ start: 0, end: duration, rates: { draw: FRAME_OVERHEAD_SECONDS * fps } })
  oneOffs.push({ at: 0, phase: 'fixed', seconds: STARTUP_SECONDS })

  let videoOverlay = false

  for (const clip of planned.clips) {
    const asset = assets.get(clip.assetId)
    if (asset?.kind === 'audio') continue
    const sourcePixels = positiveOr(asset?.width, DEFAULT_WIDTH) * positiveOr(asset?.height, DEFAULT_HEIGHT)
    const sourceFps = positiveOr(asset?.fps, DEFAULT_FPS)
    const passes = 1 + (blurBackground ? BLUR_BACKGROUND_PASSES - 1 : 0) + (clipGrade(clip) ? GRADE_PASSES : 0)
    const start = clip.start
    const end = clipEnd(clip)
    const rates: Rates = { draw: passRate(passes) }
    if (asset?.kind === 'image' || clip.still !== undefined) {
      // One decoded picture for the whole clip; it is drawn every frame from its texture.
      oneOffs.push({ at: start, phase: 'decode', seconds: sourcePixels / 1_000_000 / DECODE_MP_PER_S })
      oneOffs.push({ at: start, phase: 'draw', seconds: sourcePixels / 1_000_000 / UPLOAD_MP_PER_S })
    } else {
      const speed = Math.max(0, clip.speed)
      rates.decode = (sourcePixels * sourceFps * speed) / 1_000_000 / DECODE_MP_PER_S
      rates.draw = (rates.draw ?? 0) + (sourcePixels * Math.min(sourceFps * speed, fps)) / 1_000_000 / UPLOAD_MP_PER_S
    }
    spans.push({ start, end, rates })
  }

  for (const plan of planned.transitions) {
    spans.push({ start: plan.start, end: plan.start + plan.duration, rates: { draw: passRate(BLEND_PASSES) } })
  }

  for (const text of project.texts) {
    spans.push({ start: text.start, end: text.start + text.duration, rates: { draw: drawCallRate } })
    oneOffs.push({ at: text.start, phase: 'draw', seconds: TEXT_RASTER_SECONDS })
  }

  for (const overlay of project.overlays) {
    const { start, duration: length, scale, kind } = overlay
    const end = start + length
    const size = positiveOr(scale, 1)
    const hPx = height
    switch (kind) {
      case 'region': {
        const passes = REGION_PASSES + (overlay.effect === 'blur' ? REGION_BLUR_PASSES : 0)
        spans.push({ start, end, rates: { draw: passRate(passes) + drawCallRate } })
        break
      }
      case 'media': {
        const asset = assets.get(overlay.assetId)
        const boxPixels = overlay.width * hPx * size * (overlay.height * hPx * size)
        const boxRate = (boxPixels * fps) / 1_000_000 / DRAW_MP_PER_S + drawCallRate
        if (asset?.kind === 'video') {
          videoOverlay ||= start < duration
          const sourcePixels = positiveOr(asset.width, DEFAULT_WIDTH) * positiveOr(asset.height, DEFAULT_HEIGHT)
          const sourceFps = positiveOr(asset.fps, DEFAULT_FPS)
          const pictureSpeed = positiveOr(overlay.speed, 1)
          // The picture plays from srcIn at its speed, then holds its last frame: no decoding after that.
          const sourceLeft = Math.max(0, asset.duration - Math.max(0, overlay.srcIn ?? 0))
          const playEnd = Math.min(end, start + sourceLeft / pictureSpeed)
          const decode = (sourcePixels * sourceFps * pictureSpeed) / 1_000_000 / DECODE_MP_PER_S
          const upload = (sourcePixels * Math.min(sourceFps * pictureSpeed, fps)) / 1_000_000 / UPLOAD_MP_PER_S
          if (playEnd > start) spans.push({ start, end: playEnd, rates: { decode, draw: boxRate + upload } })
          if (end > playEnd) spans.push({ start: Math.max(start, playEnd), end, rates: { draw: boxRate } })
        } else {
          if (asset?.kind === 'image') {
            const sourcePixels = positiveOr(asset.width, DEFAULT_WIDTH) * positiveOr(asset.height, DEFAULT_HEIGHT)
            oneOffs.push({ at: start, phase: 'decode', seconds: sourcePixels / 1_000_000 / DECODE_MP_PER_S })
            oneOffs.push({ at: start, phase: 'draw', seconds: sourcePixels / 1_000_000 / UPLOAD_MP_PER_S })
          }
          spans.push({ start, end, rates: { draw: boxRate } })
        }
        break
      }
      case 'stroke': {
        const xs = overlay.points.map((p) => p[0])
        const ys = overlay.points.map((p) => p[1])
        const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
        const spanY = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
        const boxW = (spanX * hPx + overlay.lineWidth * hPx) * size
        const boxH = (spanY * hPx + overlay.lineWidth * hPx) * size
        oneOffs.push({ at: start, phase: 'draw', seconds: Math.max(1, boxW * boxH) / 1_000_000 / RASTER_MP_PER_S })
        spans.push({ start, end, rates: { draw: drawCallRate } })
        break
      }
      case 'shape': {
        const boxW = overlay.width * hPx * size
        const boxH = overlay.height * hPx * size
        oneOffs.push({ at: start, phase: 'draw', seconds: Math.max(1, boxW * boxH) / 1_000_000 / RASTER_MP_PER_S })
        spans.push({ start, end, rates: { draw: drawCallRate } })
        break
      }
      case 'sticker': {
        // A glyph is a square-ish box about 1.2 times its height.
        const side = overlay.size * hPx * size * 1.2
        oneOffs.push({ at: start, phase: 'draw', seconds: Math.max(1, side * side) / 1_000_000 / RASTER_MP_PER_S })
        spans.push({ start, end, rates: { draw: drawCallRate } })
        break
      }
      default:
        spans.push({ start, end, rates: { draw: drawCallRate } })
    }
  }

  const phases = emptyPhases()
  const weights = input.withWeights && frames > 0 ? new Float64Array(frames + 1) : null
  const frameIndexAt = (t: Micros): number => Math.min(frames, Math.max(0, Math.ceil((t * fps) / MICROS_PER_SECOND)))

  for (const span of spans) {
    const first = frameIndexAt(span.start)
    const last = frameIndexAt(span.end)
    if (last <= first) continue
    let perFrame = 0
    for (const key of PHASES) {
      const rate = span.rates[key]
      if (!rate) continue
      phases[key] += (rate * (last - first)) / fps
      perFrame += rate / fps
    }
    if (weights && perFrame > 0) {
      weights[first] = weights[first]! + perFrame
      weights[last] = weights[last]! - perFrame
    }
  }

  const extra = input.withWeights && frames > 0 ? new Float64Array(frames) : null
  for (const item of oneOffs) {
    phases[item.phase] += item.seconds
    if (extra) {
      const index = Math.min(frames - 1, frameIndexAt(item.at))
      extra[index] = extra[index]! + item.seconds
    }
  }

  let frameWeights: Float64Array | null = null
  if (weights && extra) {
    frameWeights = new Float64Array(frames)
    let running = 0
    for (let i = 0; i < frames; i++) {
      running += weights[i]!
      frameWeights[i] = Math.max(0, running) + extra[i]!
    }
  }

  return { frames, phases, featureClass: videoOverlay ? 'video' : 'plain', frameWeights }
}

/** Unit of a time text. Ranges use one unit for both ends. */
export type TimeUnit = 'seconds' | 'minutes' | 'hours'

/** Low and high end of a duration in the given unit (equal ends mean a single value). */
export interface TimeRange {
  unit: TimeUnit
  low: number
  high: number
}

const UNIT_SECONDS: Record<TimeUnit, number> = { seconds: 1, minutes: 60, hours: 3600 }

function unitFor(seconds: number): TimeUnit {
  if (seconds < 60) return 'seconds'
  return seconds < 3600 ? 'minutes' : 'hours'
}

/** Rounding steps: 5 s below a minute, half a minute below ten minutes, whole minutes above, half hours beyond. */
function stepFor(unit: TimeUnit, seconds: number): number {
  if (unit === 'seconds') return 5
  if (unit === 'minutes') return seconds < 600 ? 0.5 : 1
  return 0.5
}

/**
 * Turns an uncertain duration into a range the dialog can show, rounded outwards so the real time
 * falls inside it: "30 s - 1.5 min", or a single value when both ends round to the same step.
 */
export function formatEstimateRange(lowSeconds: number, highSeconds: number): TimeRange {
  const lo = Number.isFinite(lowSeconds) && lowSeconds > 0 ? lowSeconds : 0
  const hi = Math.max(lo, Number.isFinite(highSeconds) && highSeconds > 0 ? highSeconds : 0)
  const unit = unitFor(hi)
  const scale = UNIT_SECONDS[unit]
  const step = stepFor(unit, hi)
  const floorTo = (x: number): number => Math.round(Math.floor(x / step + 1e-9) * step * 100) / 100
  const ceilTo = (x: number): number => Math.round(Math.ceil(x / step - 1e-9) * step * 100) / 100
  const low = Math.max(step, floorTo(lo / scale))
  const high = Math.max(low, ceilTo(hi / scale))
  return { unit, low, high }
}

/** A single duration rounded to the nearest step, for measured times and the value shown in the details. */
export function formatEstimateValue(seconds: number): TimeRange {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const unit = unitFor(s)
  const step = stepFor(unit, s)
  const value = Math.max(step, Math.round(s / UNIT_SECONDS[unit] / step) * step)
  return { unit, low: value, high: value }
}
