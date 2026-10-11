import type { ColorAdjust } from '../project/types'

/**
 * Colour filters and adjustments as plain numbers. The compositor applies the resolved Grade to
 * straight RGB values in 0..1 (gamma-encoded, like CSS and most editors do), in the shader that
 * draws the picture and the blurred background. Everything here is pure and testable.
 *
 * Order of the grade, fixed: filter (scaled by intensity) -> brightness -> contrast -> saturation.
 */

export const FILTER_IDS = [
  'none',
  'blackWhite',
  'sepia',
  'warm',
  'cool',
  'vivid',
  'fade',
  'vintage',
  'noir',
  'dream'
] as const
export type FilterId = (typeof FILTER_IDS)[number]

/** One output colour as a function of the input: out = matrix * rgb + offset, row-major 3x3. */
export interface Grade {
  readonly matrix: readonly number[]
  readonly offset: readonly number[]
}

export interface FilterSpec extends Grade {
  id: FilterId
}

export const ADJUST_RANGE = { min: -1, max: 1 } as const
export const NEUTRAL_ADJUST: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0 }

/** Brightness +1 adds this much to every channel (0.25 is a quarter of the full range). */
const BRIGHTNESS_SCALE = 0.25
/** Rec. 709 luma weights, used by the saturation and black and white matrices. */
const LUMA = [0.2126, 0.7152, 0.0722] as const
const IDENTITY_MATRIX = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const
const NO_OFFSET = [0, 0, 0] as const
const IDENTITY: Grade = { matrix: IDENTITY_MATRIX, offset: NO_OFFSET }
const EPSILON = 1e-9

interface Affine {
  readonly matrix: readonly number[]
  readonly offset: readonly number[]
}

/** Applies `first`, then `then`. */
function compose(first: Affine, then: Affine): Affine {
  return {
    matrix: mul3(then.matrix, first.matrix),
    offset: addVec(mulVec3(then.matrix, first.offset), then.offset)
  }
}

function mul3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += a[i * 3 + k]! * b[k * 3 + j]!
      out[i * 3 + j] = sum
    }
  }
  return out
}

function mulVec3(m: readonly number[], v: readonly number[]): number[] {
  return [0, 1, 2].map((i) => m[i * 3]! * v[0]! + m[i * 3 + 1]! * v[1]! + m[i * 3 + 2]! * v[2]!)
}

function addVec(a: readonly number[], b: readonly number[]): number[] {
  return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!]
}

function affine(matrix: readonly number[], offset: readonly number[] = NO_OFFSET): Affine {
  return { matrix, offset }
}

/** Saturation factor: 1 unchanged, 0 grey (every channel equals the luma). */
function saturate(factor: number): Affine {
  const m: number[] = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      m.push((i === j ? factor : 0) + (1 - factor) * LUMA[j]!)
    }
  }
  return affine(m)
}

/** Contrast factor around mid grey (0.5): 1 unchanged, 0 flat grey. */
function contrast(factor: number): Affine {
  const scaled = IDENTITY_MATRIX.map((v) => v * factor)
  const shift = 0.5 * (1 - factor)
  return affine(scaled, [shift, shift, shift])
}

function gain(r: number, g: number, b: number): Affine {
  return affine([r, 0, 0, 0, g, 0, 0, 0, b])
}

function lift(v: number): Affine {
  return affine(IDENTITY_MATRIX, [v, v, v])
}

/** Applies `first`, then `then` for a list of steps. */
function chain(...steps: Affine[]): Affine {
  return steps.reduce((acc, step) => compose(acc, step), affine(IDENTITY_MATRIX))
}

const SEPIA_MATRIX = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131] as const

const FILTER_AFFINES: Record<FilterId, Affine> = {
  none: affine(IDENTITY_MATRIX),
  blackWhite: saturate(0),
  sepia: affine(SEPIA_MATRIX),
  warm: gain(1.08, 1, 0.88),
  cool: gain(0.9, 1, 1.12),
  vivid: chain(saturate(1.4), contrast(1.1)),
  // Matte: colours pulled towards grey, blacks lifted, whites slightly dimmed.
  fade: chain(saturate(0.75), affine([0.88, 0, 0, 0, 0.88, 0, 0, 0, 0.88], [0.1, 0.1, 0.1])),
  vintage: chain(saturate(0.55), affine([1.06, 0, 0, 0, 1, 0, 0, 0, 0.86], [0.04, 0.02, 0])),
  // High contrast black and white.
  noir: chain(saturate(0), contrast(1.6)),
  // Soft and bright, slightly desaturated.
  dream: chain(saturate(0.88), affine([0.94, 0, 0, 0, 0.94, 0, 0, 0, 0.94], [0.07, 0.07, 0.07]))
}

/** Every filter at full strength, in the order of FILTER_IDS. */
export const FILTERS: readonly FilterSpec[] = FILTER_IDS.map((id) => {
  const a = FILTER_AFFINES[id]
  return { id, matrix: [...a.matrix], offset: [...a.offset] }
})

export function isFilterId(value: unknown): value is FilterId {
  return typeof value === 'string' && (FILTER_IDS as readonly string[]).includes(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Amount 0..1; missing or non-numeric values mean full strength. */
export function clampAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : 1
}

/** Adjustment -1..1; missing or non-numeric values mean neutral. */
export function clampAdjustValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, ADJUST_RANGE.min, ADJUST_RANGE.max) : 0
}

/**
 * The grade for one clip. The filter is blended towards identity by `amount` (a straight linear mix
 * of the picture: amount 0.5 is halfway between the original and the filtered pixels), then the
 * three adjustments follow at full strength. Unknown filter ids and invalid numbers fall back to
 * neutral values, so the result is always finite.
 */
export function resolveGrade(
  filterId: string | null | undefined,
  amount: number | undefined,
  adjust: Partial<ColorAdjust> | undefined
): Grade {
  const filter = isFilterId(filterId) ? FILTER_AFFINES[filterId] : FILTER_AFFINES.none
  const a = clampAmount(amount)
  const blended = affine(
    IDENTITY_MATRIX.map((v, i) => (1 - a) * v + a * filter.matrix[i]!),
    filter.offset.map((v) => a * v)
  )
  const brightness = clampAdjustValue(adjust?.brightness)
  const contrastValue = clampAdjustValue(adjust?.contrast)
  const saturationValue = clampAdjustValue(adjust?.saturation)
  const total = chain(
    blended,
    lift(brightness * BRIGHTNESS_SCALE),
    contrast(1 + contrastValue),
    saturate(1 + saturationValue)
  )
  return { matrix: [...total.matrix], offset: [...total.offset] }
}

export function isIdentity(grade: Grade): boolean {
  return (
    grade.matrix.every((v, i) => Math.abs(v - IDENTITY.matrix[i]!) <= EPSILON) &&
    grade.offset.every((v) => Math.abs(v) <= EPSILON)
  )
}

/** Applies a grade to one straight RGB colour in 0..1 and clamps the result to 0..1. */
export function applyGrade(grade: Grade, rgb: readonly [number, number, number]): [number, number, number] {
  const out = mulVec3(grade.matrix, rgb)
  return [0, 1, 2].map((i) => clamp(out[i]! + grade.offset[i]!, 0, 1)) as [number, number, number]
}
