export interface Span {
  start: number
  end: number
}

/** Rows the overlay lane shows at most. Overlaps beyond that share the last row (the "stack row"). */
export const OVERLAY_ROW_LIMIT = 4

/**
 * Greedy row packing for bars in one lane: each span takes the first row whose last bar has ended
 * before it starts, so only overlapping bars get different rows. With `maxRows`, rows past the limit
 * are not added: a span that fits no row goes to the last row even if it overlaps, so the lane stays
 * short and the bars there are drawn on top of each other (the selected one on top).
 * Returns the row of every input span (same order) and the number of rows (at least one).
 */
export function packRows(spans: readonly Span[], maxRows = Infinity): { rows: number[]; count: number } {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a]!.start - spans[b]!.start || a - b)
  const rowEnds: number[] = []
  const rows = spans.map(() => 0)
  const last = Math.max(0, maxRows - 1)
  for (const i of order) {
    const span = spans[i]!
    let row = rowEnds.findIndex((end) => end <= span.start)
    if (row < 0) {
      if (rowEnds.length < maxRows) {
        row = rowEnds.length
        rowEnds.push(span.end)
      } else {
        row = last
        rowEnds[row] = Math.max(rowEnds[row]!, span.end)
      }
    } else {
      rowEnds[row] = span.end
    }
    rows[i] = row
  }
  return { rows, count: Math.max(1, rowEnds.length) }
}
