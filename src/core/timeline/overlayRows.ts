export interface Span {
  start: number
  end: number
}

/**
 * Greedy row packing for bars in one lane: each span takes the first row whose last bar has ended
 * before it starts, so only overlapping bars get different rows. Returns the row of every input span
 * (same order) and the number of rows (at least one).
 */
export function packRows(spans: readonly Span[]): { rows: number[]; count: number } {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a]!.start - spans[b]!.start || a - b)
  const rowEnds: number[] = []
  const rows = spans.map(() => 0)
  for (const i of order) {
    const span = spans[i]!
    let row = rowEnds.findIndex((end) => end <= span.start)
    if (row < 0) {
      row = rowEnds.length
      rowEnds.push(span.end)
    } else {
      rowEnds[row] = span.end
    }
    rows[i] = row
  }
  return { rows, count: Math.max(1, rowEnds.length) }
}
