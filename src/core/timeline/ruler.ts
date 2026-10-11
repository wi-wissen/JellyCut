import { formatTimecode, frameStart, MICROS_PER_SECOND, type Micros } from '../time'

export const MIN_PX_PER_SECOND = 4
export const DEFAULT_PX_PER_SECOND = 50
/** At the top zoom one frame is this many pixels wide. */
const PX_PER_FRAME_AT_MAX = 64
/** Ruler labels need at least this much room. */
export const RULER_MIN_SPACING_PX = 60

const FRAME_STEPS = [1, 2, 5, 10, 15] as const
const SECOND_STEPS = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600] as const

export interface RulerTick {
  micros: Micros
  px: number
  label: string
}

export function maxPxPerSecond(fps: number): number {
  return PX_PER_FRAME_AT_MAX * fps
}

export function clampPxPerSecond(pxPerSecond: number, fps: number): number {
  return Math.min(Math.max(pxPerSecond, MIN_PX_PER_SECOND), maxPxPerSecond(fps))
}

/** Zoom that fits a duration into a viewport width. An empty project gets the default zoom. */
export function fitPxPerSecond(viewportPx: number, durationMicros: Micros, fps: number): number {
  const seconds = durationMicros / MICROS_PER_SECOND
  if (!(seconds > 0) || !(viewportPx > 0)) return clampPxPerSecond(DEFAULT_PX_PER_SECOND, fps)
  return clampPxPerSecond(viewportPx / seconds, fps)
}

/** Maps a slider position 0..100 onto the zoom range on a logarithmic scale. */
export function zoomFromSlider(position: number, fps: number): number {
  const ratio = maxPxPerSecond(fps) / MIN_PX_PER_SECOND
  const p = Math.min(Math.max(position, 0), 100) / 100
  return MIN_PX_PER_SECOND * ratio ** p
}

export function sliderFromZoom(pxPerSecond: number, fps: number): number {
  const ratio = maxPxPerSecond(fps) / MIN_PX_PER_SECOND
  if (ratio <= 1) return 0
  const p = Math.log(clampPxPerSecond(pxPerSecond, fps) / MIN_PX_PER_SECOND) / Math.log(ratio)
  return Math.round(Math.min(Math.max(p, 0), 1) * 100)
}

export function microsToPx(t: Micros, pxPerSecond: number): number {
  return (t / MICROS_PER_SECOND) * pxPerSecond
}

export function pxToMicros(px: number, pxPerSecond: number): Micros {
  return Math.round((px / pxPerSecond) * MICROS_PER_SECOND)
}

type Step = { kind: 'frames'; frames: number } | { kind: 'seconds'; seconds: number }

function stepLength(step: Step, fps: number): Micros {
  return step.kind === 'frames' ? frameStart(step.frames, fps) : step.seconds * MICROS_PER_SECOND
}

function tickTime(step: Step, index: number, fps: number): Micros {
  return step.kind === 'frames' ? frameStart(index * step.frames, fps) : index * step.seconds * MICROS_PER_SECOND
}

function tickLabel(step: Step, t: Micros, fps: number): string {
  if (step.kind === 'frames') return formatTimecode(t, fps)
  const seconds = Math.round(t / MICROS_PER_SECOND)
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0')
  const ss = (seconds % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * Ticks from 0 up to spanMicros. The step is the smallest nice interval (frames at high zoom,
 * then 1 s, 2 s, 5 s, 10 s, 30 s, 1 min, ...) that keeps labels RULER_MIN_SPACING_PX apart.
 */
export function rulerTicks(spanMicros: Micros, pxPerSecond: number, fps: number): RulerTick[] {
  const steps: Step[] = [
    // Frame steps only below one second, so a whole second is always labelled as seconds.
    ...FRAME_STEPS.filter((frames) => frames < fps).map((frames): Step => ({ kind: 'frames', frames })),
    ...SECOND_STEPS.map((seconds): Step => ({ kind: 'seconds', seconds }))
  ]
  const step =
    steps.find((s) => microsToPx(stepLength(s, fps), pxPerSecond) >= RULER_MIN_SPACING_PX) ?? steps[steps.length - 1]
  if (!step) return []

  const ticks: RulerTick[] = []
  for (let index = 0; ; index++) {
    const micros = tickTime(step, index, fps)
    if (micros > spanMicros) break
    ticks.push({ micros, px: microsToPx(micros, pxPerSecond), label: tickLabel(step, micros, fps) })
  }
  return ticks
}
