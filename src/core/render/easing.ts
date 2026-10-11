/** Clamps to [0, 1]. NaN maps to 0 so animations never produce NaN. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function easeOutCubic(x: number): number {
  const y = 1 - clamp01(x)
  return 1 - y * y * y
}

/** Overshoots past 1 (peak about 1.10) before settling exactly on 1 at x = 1. */
export function easeOutBack(x: number): number {
  const v = clamp01(x)
  // Endpoints are returned directly: the polynomial leaves float noise at x = 0.
  if (v === 0 || v === 1) return v
  const c1 = 1.70158
  const c3 = c1 + 1
  const y = v - 1
  return 1 + c3 * y * y * y + c1 * y * y
}

export function easeInOutCubic(x: number): number {
  const v = clamp01(x)
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}
