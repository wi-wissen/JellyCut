import { describe, expect, it } from 'vitest'
import { packRows } from './overlayRows'

describe('packRows', () => {
  it('keeps non-overlapping bars in one row', () => {
    expect(packRows([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 25, end: 30 }])).toEqual({ rows: [0, 0, 0], count: 1 })
  })

  it('gives overlapping bars their own rows and reuses a row once it is free', () => {
    const result = packRows([
      { start: 0, end: 100 },
      { start: 50, end: 150 },
      { start: 120, end: 200 },
      { start: 160, end: 170 }
    ])
    // The third bar fits row 0 again (it starts after 100); the fourth starts before row 0 ends (200) but after row 1 (150).
    expect(result.rows).toEqual([0, 1, 0, 1])
    expect(result.count).toBe(2)
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
