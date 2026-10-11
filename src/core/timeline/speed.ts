/** Tempo choices offered by the clip panel. Speed 1 is normal tempo. */
export const SPEED_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

/** The step closest to v; non-finite input falls back to normal tempo. Ties go to the slower step. */
export function nearestSpeedStep(v: number): number {
  if (!Number.isFinite(v)) return 1
  let best = SPEED_STEPS[0] ?? 1
  for (const step of SPEED_STEPS) {
    if (Math.abs(step - v) < Math.abs(best - v)) best = step
  }
  return best
}

/** Index of the step closest to v, for a slider over SPEED_STEPS. */
export function speedStepIndex(v: number): number {
  return Math.max(0, SPEED_STEPS.indexOf(nearestSpeedStep(v)))
}
