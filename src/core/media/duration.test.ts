import { describe, expect, it } from 'vitest'
import { pickDurationSeconds } from './duration'

describe('pickDurationSeconds', () => {
  it('takes the first finite positive candidate', () => {
    expect(pickDurationSeconds([Infinity, NaN, 0, -1, null, undefined, 2.5, 9])).toBe(2.5)
  })
  it('returns null when nothing is usable', () => {
    expect(pickDurationSeconds([Infinity, 0, null])).toBeNull()
    expect(pickDurationSeconds([])).toBeNull()
  })
})
