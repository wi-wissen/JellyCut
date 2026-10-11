import { describe, expect, it } from 'vitest'
import { packRows } from './overlayRows'

describe('packRows', () => {
  it('keeps non-overlapping bars in one row', () => {
    expect(packRows([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 25, end: 30 }])).toEqual({ rows: [0, 0, 0], count: 1 })
  })

  it('puts the front-most bar in the upper row when two bars overlap', () => {
    // Index 1 is later in the array, so it is in front: it gets row 0, the bar behind goes lower.
    expect(packRows([{ start: 0, end: 100 }, { start: 50, end: 150 }]).rows).toEqual([1, 0])
    expect(packRows([{ start: 0, end: 100 }, { start: 50, end: 150 }]).count).toBe(2)
  })

  it('a bar behind an overlapping bar is always in a lower row, whatever the times', () => {
    const spans = [
      { start: 0, end: 100 },
      { start: 50, end: 150 },
      { start: 120, end: 200 },
      { start: 160, end: 170 }
    ]
    const { rows } = packRows(spans)
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i]!
        const b = spans[j]!
        if (a.start < b.end && b.start < a.end) expect(rows[j]).toBeLessThan(rows[i]!)
      }
    }
  })

  it('reuses the row of a bar that does not overlap the bars in front of it', () => {
    // Front bar [120,200] row 0; the bar behind it [0,100] does not overlap it, so it shares row 0.
    expect(packRows([{ start: 0, end: 100 }, { start: 120, end: 200 }]).rows).toEqual([0, 0])
  })

  it('returns the input order, not the sorted order', () => {
    const result = packRows([{ start: 40, end: 60 }, { start: 0, end: 50 }])
    expect(result.rows).toEqual([1, 0])
    expect(result.count).toBe(2)
  })

  it('reports one row for an empty lane', () => {
    expect(packRows([])).toEqual({ rows: [], count: 1 })
  })
})

describe('packRows with a row limit', () => {
  it('puts overlaps past the limit into the last row, which is drawn on top of itself', () => {
    const spans = [0, 0, 0, 0, 0].map((start) => ({ start, end: 100 }))
    const result = packRows(spans, 3)
    expect(result.rows).toEqual([2, 2, 2, 1, 0])
    expect(result.count).toBe(3)
  })

  it('keeps the count within the limit', () => {
    const spans = [0, 0, 0, 0, 0, 0].map((start) => ({ start, end: 100 }))
    expect(packRows(spans, 4).count).toBe(4)
  })
})
