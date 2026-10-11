import type { Asset, Clip, MusicItem, Project } from '../project/types'
import type { PlannedTimeline } from '../render/scene'
import type { Micros } from '../time'
import { clipEnd } from '../timeline/edit'
import { hasClipSound } from '../timeline/speed'

/** Click-protection ramp at every audio cut and for music without an explicit fade. */
export const CUT_FADE: Micros = 15_000

export interface GainPoint {
  t: Micros
  gain: number
}

export interface AudioSegment {
  kind: 'clip' | 'music'
  sourceId: string
  assetId: string
  srcStart: Micros
  srcEnd: Micros
  timelineStart: Micros
  timelineEnd: Micros
  speed: number
  envelope: GainPoint[]
}

/** Piecewise linear gain curve; a zero-length ramp is a constant 1 (identity for products). */
type Ramp = GainPoint[]

/**
 * Linear interpolation over a sorted envelope. Before the first point and after
 * the last point the nearest value is held. Of two points with the same time the
 * later one wins at that exact time, which makes a step.
 */
export function gainAt(envelope: GainPoint[], t: Micros): number {
  const last = envelope.length - 1
  if (last < 0) return 0
  if (t < envelope[0]!.t) return envelope[0]!.gain

  // Largest index whose point is at or before t.
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (envelope[mid]!.t <= t) lo = mid
    else hi = mid - 1
  }

  const a = envelope[lo]!
  const b = envelope[lo + 1]
  if (b === undefined || a.t === t) return a.gain
  return a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t)
}

function ramp(from: Micros, to: Micros, fromGain: number, toGain: number): Ramp {
  if (to <= from) return [{ t: from, gain: 1 }]
  return [
    { t: from, gain: fromGain },
    { t: to, gain: toGain }
  ]
}

/** Volume times the product of all ramps, sampled at every ramp breakpoint. */
function envelopeOf(volume: number, ramps: Ramp[]): GainPoint[] {
  const times = Array.from(new Set(ramps.flatMap((r) => r.map((p) => p.t)))).sort((a, b) => a - b)
  return times.map((t) => ({
    t,
    gain: ramps.reduce((gain, r) => gain * gainAt(r, t), volume)
  }))
}

interface TransitionRamps {
  fadeIn?: Ramp
  fadeOut?: Ramp
}

/** Crossfade ramps keyed by clip id: the incoming clip fades in, the outgoing one fades out. */
function transitionRamps(planned: PlannedTimeline): Map<string, TransitionRamps> {
  const result = new Map<string, TransitionRamps>()
  const entry = (id: string): TransitionRamps => {
    let found = result.get(id)
    if (!found) {
      found = {}
      result.set(id, found)
    }
    return found
  }

  for (const window of planned.transitions) {
    const index = planned.clips.findIndex((clip) => clip.id === window.clipId)
    if (index < 0) continue
    const end = window.start + window.duration
    entry(window.clipId).fadeIn = ramp(window.start, end, 0, 1)
    if (index > 0) entry(planned.clips[index - 1]!.id).fadeOut = ramp(window.start, end, 1, 0)
  }
  return result
}

function clipSegment(clip: Clip, asset: Asset | undefined, ramps: TransitionRamps | undefined): AudioSegment | null {
  if (!asset || asset.kind !== 'video' || asset.hasAudio === false) return null
  // A freeze frame has no sound of its own.
  if (clip.still !== undefined) return null
  if (clip.muted || clip.volume <= 0 || !hasClipSound(clip.speed)) return null

  const start = clip.start
  const end = clipEnd(clip)
  const duration = end - start
  if (duration < 1) return null

  const fade = Math.min(CUT_FADE, Math.floor(duration / 2))
  const fadeIn = ramps?.fadeIn ?? ramp(start, start + fade, 0, 1)
  const fadeOut = ramps?.fadeOut ?? ramp(end - fade, end, 1, 0)

  return {
    kind: 'clip',
    sourceId: clip.id,
    assetId: clip.assetId,
    srcStart: clip.srcIn,
    srcEnd: clip.srcOut,
    timelineStart: start,
    timelineEnd: end,
    speed: clip.speed,
    envelope: envelopeOf(clip.volume, [fadeIn, fadeOut])
  }
}

function musicSegment(item: MusicItem, asset: Asset | undefined): AudioSegment | null {
  if (!asset || item.volume <= 0 || item.muted === true) return null
  const length = item.srcOut - item.srcIn
  if (length < 1) return null

  let fadeIn = item.fadeIn > 0 ? item.fadeIn : CUT_FADE
  let fadeOut = item.fadeOut > 0 ? item.fadeOut : CUT_FADE
  // Short items: if the ramps would overlap, cap each at half the length so they cannot cross.
  if (fadeIn + fadeOut > length) {
    fadeIn = Math.min(fadeIn, Math.floor(length / 2))
    fadeOut = Math.min(fadeOut, Math.floor(length / 2))
  }

  const start = item.start
  const end = start + length
  return {
    kind: 'music',
    sourceId: item.id,
    assetId: item.assetId,
    srcStart: item.srcIn,
    srcEnd: item.srcOut,
    timelineStart: start,
    timelineEnd: end,
    speed: 1,
    envelope: envelopeOf(item.volume, [ramp(start, start + fadeIn, 0, 1), ramp(end - fadeOut, end, 1, 0)])
  }
}

function compareSegments(a: AudioSegment, b: AudioSegment): number {
  if (a.timelineStart !== b.timelineStart) return a.timelineStart - b.timelineStart
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0
}

export function planAudioSegments(project: Project, planned: PlannedTimeline): AudioSegment[] {
  const assets = new Map<string, Asset>(project.assets.map((asset): [string, Asset] => [asset.id, asset]))
  const transitions = transitionRamps(planned)

  const segments: AudioSegment[] = []
  for (const clip of planned.clips) {
    const segment = clipSegment(clip, assets.get(clip.assetId), transitions.get(clip.id))
    if (segment) segments.push(segment)
  }
  for (const item of project.music) {
    const segment = musicSegment(item, assets.get(item.assetId))
    if (segment) segments.push(segment)
  }
  return segments.sort(compareSegments)
}
