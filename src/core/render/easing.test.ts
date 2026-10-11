import { describe, expect, it } from 'vitest'
import { clamp01, easeInOutCubic, easeOutBack, easeOutCubic } from './easing'

describe('clamp01', () => {
  it('clamps to [0, 1] and maps NaN to 0', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(0.25)).toBe(0.25)
    expect(clamp01(3)).toBe(1)
    expect(clamp01(NaN)).toBe(0)
  })
})

describe('easing curves', () => {
  it('hit their endpoints exactly', () => {
    for (const ease of [easeOutCubic, easeOutBack, easeInOutCubic]) {
      expect(ease(0)).toBe(0)
      expect(ease(1)).toBe(1)
    }
  })
  it('easeOutCubic is monotonic and stays within [0, 1]', () => {
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = easeOutCubic(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeLessThanOrEqual(1)
      prev = v
    }
  })
  it('easeOutBack overshoots to about 1.1 before settling', () => {
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)))
    expect(peak).toBeGreaterThan(1.05)
    expect(peak).toBeLessThan(1.15)
  })
  it('easeInOutCubic is symmetric around the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12)
    expect(easeInOutCubic(0.2) + easeInOutCubic(0.8)).toBeCloseTo(1, 12)
  })
  it('clamps out-of-range input', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutBack(5)).toBe(1)
  })
})
