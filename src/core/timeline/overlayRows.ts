export interface Span {
  start: number
  end: number
}

/** Rows the overlay lane shows at most. Overlaps beyond that share the last row (the "stack row"). */
export const OVERLAY_ROW_LIMIT = 4

/**
 * Stacking rows for bars in one lane. The input is in stacking order: later spans are in front. The
 * front-most bar takes the upper row, and a bar behind it that overlaps it in time goes one row lower.
 * Bars that do not overlap may share a row. Each span is placed below every span in front of it that it
 * overlaps, so for every overlapping pair the front bar has the smaller row number.
 * With `maxRows`, rows past the limit are not added: a span that would need a lower row goes to the last
 * row even if it overlaps, so the lane stays short and the bars there are drawn on top of each other.
 * Returns the row of every input span (same order) and the number of rows (at least one).
 */
export function packRows(spans: readonly Span[], maxRows = Infinity): { rows: number[]; count: number } {
  const rows = spans.map(() => 0)
  const placed: number[] = []
  const last = Math.max(0, maxRows - 1)
  let deepest = 0
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!
    let row = 0
    for (const j of placed) {
      const front = spans[j]!
      if (front.start < span.end && span.start < front.end) row = Math.max(row, rows[j]! + 1)
    }
    rows[i] = Math.min(row, last)
    deepest = Math.max(deepest, rows[i]!)
    placed.push(i)
  }
  return { rows, count: Math.max(1, Math.min(deepest + 1, maxRows)) }
}
