import { MICROS_PER_SECOND, type Micros } from '../time'
import { FIRST_MELODY, SECOND_MELODY, type MelodyNote } from './melody'

export const EXAMPLE_WIDTH = 1280
export const EXAMPLE_HEIGHT = 720
export const EXAMPLE_FPS = 30

export type Rgb = readonly [number, number, number]

export interface ExamplePalette {
  top: Rgb
  bottom: Rgb
  shape: Rgb
}

export interface ExampleClipSpec {
  name: string
  seconds: number
  palette: ExamplePalette
  melody: readonly MelodyNote[]
}

export const PALETTE_SUNRISE: ExamplePalette = { top: [255, 150, 90], bottom: [96, 40, 140], shape: [255, 226, 120] }
export const PALETTE_OCEAN: ExamplePalette = { top: [46, 200, 196], bottom: [14, 58, 112], shape: [255, 116, 168] }

/** The two clips of the example. Their lengths are whole seconds, so frames and audio end together. */
export const EXAMPLE_CLIPS: readonly ExampleClipSpec[] = [
  { name: 'Example video.mp4', seconds: 6, palette: PALETTE_SUNRISE, melody: FIRST_MELODY },
  { name: 'Example clip 2.mp4', seconds: 4, palette: PALETTE_OCEAN, melody: SECOND_MELODY }
]

/** Length of the background gradient cycle, in seconds. */
const GRADIENT_PERIOD_SECONDS = 6

export function exampleFrameCount(seconds: number, fps: number = EXAMPLE_FPS): number {
  return Math.round(seconds * fps)
}

/** Whole percent of done out of total, clamped to 0..100. */
export function percentOf(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t))
  const channel = (i: number): number => Math.round((a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * k)
  return [channel(0), channel(1), channel(2)]
}

export function rgbCss(color: Rgb): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`
}

/** Background colours at a time: the bottom colour drifts towards the top colour and back once per cycle. */
export function gradientAt(palette: ExamplePalette, t: Micros): { top: Rgb; bottom: Rgb } {
  const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / MICROS_PER_SECOND / GRADIENT_PERIOD_SECONDS)
  return { top: palette.top, bottom: mixRgb(palette.bottom, palette.top, 0.35 * phase) }
}

export interface Point {
  x: number
  y: number
}

/** Centre of the moving shape in pixels: a slow figure eight that stays inside the frame. */
export function shapeCenter(t: Micros, width: number, height: number, radius: number): Point {
  const seconds = t / MICROS_PER_SECOND
  const reachX = Math.max(0, width / 2 - radius - width * 0.04)
  const reachY = height * 0.04
  return {
    x: width / 2 + reachX * Math.sin((2 * Math.PI * seconds) / 4),
    y: height * 0.72 + reachY * Math.sin((2 * Math.PI * seconds) / 2)
  }
}

/** Running counter in seconds with two decimals, for example "1.23 s". */
export function counterLabel(t: Micros): string {
  return `${(t / MICROS_PER_SECOND).toFixed(2)} s`
}

/** Clock label mm:ss; the fraction of a second is cut off. */
export function clockLabel(t: Micros): string {
  const total = Math.floor(t / MICROS_PER_SECOND)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export interface ExampleScene {
  top: Rgb
  bottom: Rgb
  shape: Point & { radius: number; color: Rgb }
  title: string
  counter: string
  clock: string
}

/** Everything one frame of an example clip shows, at a frame's start time. */
export function exampleScene(
  palette: ExamplePalette,
  t: Micros,
  duration: Micros,
  width = EXAMPLE_WIDTH,
  height = EXAMPLE_HEIGHT
): ExampleScene {
  const radius = Math.round(height * 0.11)
  return {
    ...gradientAt(palette, t),
    shape: { ...shapeCenter(t, width, height, radius), radius, color: palette.shape },
    title: 'Jelly Cut',
    counter: counterLabel(t),
    clock: `${clockLabel(t)} / ${clockLabel(duration)}`
  }
}
