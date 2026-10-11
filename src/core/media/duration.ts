// Duration choice for files whose container carries no (or a useless) length.

/**
 * Browsers' MediaRecorder writes WebM without a Duration or Cues element, so the length has to come from
 * the packets. Candidates are tried in order; metadata may be missing, NaN or Infinity.
 */
export function pickDurationSeconds(candidates: readonly (number | null | undefined)[]): number | null {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return null
}
