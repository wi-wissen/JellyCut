import type { Clip, MediaOverlay, OverlayItem, Project, ProjectFormat, TextItem } from '../project/types'
import type { Micros } from '../time'
import { clipGrade } from '../filters/ops'
import { clipEnd, sourceTimeAt } from '../timeline/edit'
import { planTransitions, type TransitionPlan } from '../timeline/transitions'
import {
  TEXT_ANIM_DURATION,
  TRANSITION_TYPES,
  type LayerTransition,
  type OverlayLayer,
  type Scene,
  type TextLayer,
  type VideoLayer
} from './types'
import { clamp01, easeOutBack, easeOutCubic } from './easing'
import { canonicalAnimation, parseAnimation, type Side } from './animations'
import { animatedFrameIndex, itemAnimation } from './stickerAnimations'

export interface PlannedTimeline {
  clips: Clip[]
  transitions: TransitionPlan[]
  duration: Micros
  shortenedBy: Micros
}

const MISSING_ASSET_PREFIX = 'missing-asset:'

export function planTimeline(project: Project): PlannedTimeline {
  const durations: Record<string, Micros> = {}
  const known = new Set<string>()
  for (const asset of project.assets) {
    durations[asset.id] = asset.duration
    known.add(asset.id)
  }

  // Clips with a missing asset get a private key whose duration is their srcOut,
  // so they have no handles and the planner never throws.
  const originalAsset = new Map<string, string>()
  const input = project.clips.map((clip): Clip => {
    if (known.has(clip.assetId)) return clip
    const key = MISSING_ASSET_PREFIX + clip.id
    durations[key] = clip.srcOut
    originalAsset.set(clip.id, clip.assetId)
    return { ...clip, assetId: key }
  })

  const result = planTransitions(input, durations)
  const clips = result.clips.map((clip): Clip => {
    const original = originalAsset.get(clip.id)
    return original === undefined ? clip : { ...clip, assetId: original }
  })

  return {
    clips,
    transitions: result.transitions,
    duration: clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0),
    shortenedBy: result.shortenedBy
  }
}

export function buildScene(project: Project, planned: PlannedTimeline, t: Micros): Scene {
  const layerTransitions = transitionLayers(planned, t)

  const videos: VideoLayer[] = []
  for (const clip of planned.clips) {
    if (!(clip.start <= t && t < clipEnd(clip))) continue
    const transition = layerTransitions.get(clip.id)
    videos.push({
      clipId: clip.id,
      assetId: clip.assetId,
      srcTime: sourceTimeAt(clip, t),
      transform: { ...clip.transform },
      transition: transition ? { ...transition } : null,
      grade: clipGrade(clip)
    })
  }

  const texts: TextLayer[] = []
  for (const item of project.texts) {
    if (!(item.start <= t && t < item.start + item.duration)) continue
    texts.push(textLayer(item, t))
  }

  const overlays: OverlayLayer[] = []
  for (const item of project.overlays) {
    if (!(item.start <= t && t < item.start + item.duration)) continue
    overlays.push(overlayLayer(item, t, project.format, project.assets))
  }

  return {
    time: t,
    format: { ...project.format, background: { ...project.format.background } },
    videos,
    overlays,
    texts
  }
}

function transitionLayers(planned: PlannedTimeline, t: Micros): Map<string, LayerTransition> {
  const layers = new Map<string, LayerTransition>()
  for (const plan of planned.transitions) {
    if (!(plan.start <= t && t < plan.start + plan.duration)) continue
    const index = planned.clips.findIndex((clip) => clip.id === plan.clipId)
    const incoming = planned.clips[index]
    if (!incoming) continue

    const type = normalizeTransition(incoming.transitionIn?.type)
    const progress = clamp01((t - plan.start) / plan.duration)
    layers.set(incoming.id, { type, progress, role: 'to' })
    const outgoing = index > 0 ? planned.clips[index - 1] : undefined
    if (outgoing) layers.set(outgoing.id, { type, progress, role: 'from' })
  }
  return layers
}

function normalizeTransition(type: string | undefined): string {
  return type !== undefined && (TRANSITION_TYPES as readonly string[]).includes(type) ? type : 'fade'
}

interface AnimState {
  alpha: number
  scale: number
  /** Offsets as fractions of the output height (the same unit for both axes). */
  offsetX: number
  offsetY: number
}

const VISIBLE: AnimState = { alpha: 1, scale: 1, offsetX: 0, offsetY: 0 }

/** Distance a slide travels, as a fraction of the output height. */
const SLIDE_DISTANCE = 0.06

function textLayer(item: TextItem, t: Micros): TextLayer {
  const state = spanState(item, t)
  return {
    id: item.id,
    text: item.text,
    style: { ...item.style },
    pos: { ...item.pos },
    alpha: state.alpha,
    scale: state.scale,
    offsetX: state.offsetX,
    offsetY: state.offsetY
  }
}

/** Anything with a start, a length and optional in / out animations: texts and overlays. */
interface AnimatedSpan {
  start: Micros
  duration: Micros
  animIn?: string | null
  animOut?: string | null
}

/**
 * Entrance and exit state of an item at time t. The default length is shortened to half the span when needed.
 * Stored names are canonicalised first, so legacy 'slideUp' values still play.
 */
function spanState(item: AnimatedSpan, t: Micros): AnimState {
  const length = Math.min(TEXT_ANIM_DURATION, Math.floor(item.duration / 2))
  if (length <= 0) return VISIBLE
  const elapsed = t - item.start
  const remaining = item.start + item.duration - t
  const inName = canonicalAnimation(item.animIn, 'in')
  const outName = canonicalAnimation(item.animOut, 'out')
  // The out animation runs backwards: progress 1 is fully visible, 0 is gone.
  if (inName && elapsed < length) return animationAt(inName, elapsed / length)
  if (outName && remaining < length) return animationAt(outName, remaining / length)
  return VISIBLE
}

/** Wiggle loop: a tilt of WIGGLE_DEG to either side, one swing per WIGGLE_PERIOD. */
const WIGGLE_DEG = 8
const WIGGLE_PERIOD: Micros = 900_000

function overlayLayer(item: OverlayItem, t: Micros, format: ProjectFormat, assets: Project['assets']): OverlayLayer {
  const anim = spanState(item, t)
  const wiggle = item.loop === 'wiggle' ? WIGGLE_DEG * Math.sin((2 * Math.PI * (t - item.start)) / WIGGLE_PERIOD) : 0
  // pos.x is a fraction of the width, so the horizontal offset (a height fraction) is converted.
  const aspect = format.width / format.height
  const animation = itemAnimation(item)
  const layer: OverlayLayer = {
    item,
    x: item.pos.x + (aspect > 0 ? anim.offsetX / aspect : 0),
    y: item.pos.y + anim.offsetY,
    scale: item.scale * anim.scale,
    rotation: item.rotation + wiggle,
    alpha: clamp01((item.opacity ?? 1) * anim.alpha),
    srcTime: item.kind === 'media' ? pictureTime(item, t, assets) : 0
  }
  if (animation) layer.frame = animatedFrameIndex(t - item.start, animation.loopMicros, animation.frames)
  return layer
}

/**
 * Frame of a picture-in-picture video at time t: it starts at `srcIn` of the asset, runs at `speed` and holds
 * the last frame after the end of the file.
 */
function pictureTime(item: MediaOverlay, t: Micros, assets: Project['assets']): Micros {
  const elapsed = Math.max(0, t - item.start)
  const asset = assets.find((a) => a.id === item.assetId)
  if (!asset || asset.kind !== 'video') return 0
  const speed = item.speed !== undefined && Number.isFinite(item.speed) && item.speed > 0 ? item.speed : 1
  const from = item.srcIn !== undefined && item.srcIn > 0 ? item.srcIn : 0
  const last = Math.max(0, asset.duration - 1)
  return Math.min(from + Math.round(elapsed * speed), last)
}

/** Progress runs 0 -> 1 over an in animation and 1 -> 0 over an out animation (the caller reverses it). */
function animationAt(name: string, progress: number): AnimState {
  const p = clamp01(progress)
  const kind = parseAnimation(name)
  if (kind?.kind === 'pop') return { alpha: p, scale: 1 - 0.6 * (1 - easeOutBack(p)), offsetX: 0, offsetY: 0 }
  if (kind?.kind === 'slide') {
    // The slide starts a full distance away on its side and reaches the place (or leaves it) at p = 1 / 0.
    const d = SLIDE_DISTANCE * (1 - easeOutCubic(p))
    const dir = SIDE_VECTOR[kind.side]
    return { alpha: p, scale: 1, offsetX: dir[0] * d, offsetY: dir[1] * d }
  }
  return { alpha: p, scale: 1, offsetX: 0, offsetY: 0 }
}

/** Unit vector of the side an animation comes from or leaves towards (y grows downwards). */
const SIDE_VECTOR: Record<Side, [number, number]> = {
  top: [0, -1],
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0]
}
