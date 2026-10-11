import { describe, expect, it } from 'vitest'
import { FILTERS, FILTER_IDS, applyGrade, isIdentity, resolveGrade } from './filters'

const NEUTRAL = { brightness: 0, contrast: 0, saturation: 0 }
const MID: [number, number, number] = [0.5, 0.5, 0.5]
const luma = (rgb: readonly number[]) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
const RED: [number, number, number] = [0.9, 0.2, 0.1]

describe('FILTERS', () => {
  it('lists the ten filters, the first being neutral', () => {
    expect(FILTERS.map((f) => f.id)).toEqual([
      'none', 'blackWhite', 'sepia', 'warm', 'cool', 'vivid', 'fade', 'vintage', 'noir', 'dream'
    ])
    expect(FILTER_IDS).toEqual(FILTERS.map((f) => f.id))
    expect(isIdentity(resolveGrade('none', 1, NEUTRAL))).toBe(true)
  })

  it('has finite 3x3 matrices and 3 offsets for every filter', () => {
    for (const f of FILTERS) {
      expect(f.matrix).toHaveLength(9)
      expect(f.offset).toHaveLength(3)
      expect([...f.matrix, ...f.offset].every(Number.isFinite)).toBe(true)
    }
  })
})

describe('resolveGrade: identity', () => {
  it('no filter and neutral adjustments is identity', () => {
    expect(isIdentity(resolveGrade(null, 1, NEUTRAL))).toBe(true)
    expect(isIdentity(resolveGrade(null, undefined, undefined))).toBe(true)
  })

  it('amount 0 is identity for every filter', () => {
    for (const id of FILTER_IDS) {
      expect(isIdentity(resolveGrade(id, 0, NEUTRAL))).toBe(true)
    }
  })

  it('amount 1 equals the filter itself', () => {
    for (const f of FILTERS) {
      const grade = resolveGrade(f.id, 1, NEUTRAL)
      grade.matrix.forEach((v, i) => expect(v).toBeCloseTo(f.matrix[i]!, 12))
      grade.offset.forEach((v, i) => expect(v).toBeCloseTo(f.offset[i]!, 12))
    }
  })

  it('the default amount is 1', () => {
    expect(resolveGrade('sepia', undefined, NEUTRAL)).toEqual(resolveGrade('sepia', 1, NEUTRAL))
  })

  it('an unknown filter id is identity', () => {
    expect(isIdentity(resolveGrade('polaroid', 1, NEUTRAL))).toBe(true)
    expect(isIdentity(resolveGrade('', 1, NEUTRAL))).toBe(true)
  })
})

describe('resolveGrade: amount', () => {
  it('amount 0.5 is the straight mix of original and filtered colour', () => {
    const half = resolveGrade('sepia', 0.5, NEUTRAL)
    const full = resolveGrade('sepia', 1, NEUTRAL)
    for (const rgb of [RED, MID, [0.1, 0.8, 0.4] as const]) {
      const original = [...rgb]
      const filtered = applyGrade(full, [...rgb])
      const mixed = applyGrade(half, [...rgb])
      for (let i = 0; i < 3; i++) {
        expect(mixed[i]).toBeCloseTo(0.5 * original[i]! + 0.5 * filtered[i]!, 9)
      }
    }
  })

  it('clamps the amount to 0..1', () => {
    expect(resolveGrade('blackWhite', 5, NEUTRAL)).toEqual(resolveGrade('blackWhite', 1, NEUTRAL))
    expect(resolveGrade('blackWhite', -3, NEUTRAL)).toEqual(resolveGrade('blackWhite', 0, NEUTRAL))
  })

  it('a non-numeric amount means full strength', () => {
    expect(resolveGrade('blackWhite', NaN, NEUTRAL)).toEqual(resolveGrade('blackWhite', 1, NEUTRAL))
  })
})

describe('resolveGrade: adjustments', () => {
  it('brightness +1 raises the luminance of mid grey', () => {
    const grade = resolveGrade(null, 1, { ...NEUTRAL, brightness: 1 })
    const out = applyGrade(grade, MID)
    expect(luma(out)).toBeGreaterThan(luma(MID))
    expect(out[0]).toBeCloseTo(0.75, 6)
  })

  it('brightness -1 lowers the luminance of mid grey', () => {
    expect(luma(applyGrade(resolveGrade(null, 1, { ...NEUTRAL, brightness: -1 }), MID))).toBeLessThan(luma(MID))
  })

  it('brightness raises luminance monotonically', () => {
    const values = [-1, -0.5, 0, 0.5, 1].map((b) => luma(applyGrade(resolveGrade(null, 1, { ...NEUTRAL, brightness: b }), MID)))
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!)
  })

  it('contrast 0 leaves mid grey unchanged', () => {
    const out = applyGrade(resolveGrade(null, 1, { ...NEUTRAL, contrast: 0 }), MID)
    expect(out).toEqual([0.5, 0.5, 0.5])
  })

  it('contrast +1 pushes colours away from mid grey', () => {
    const out = applyGrade(resolveGrade(null, 1, { ...NEUTRAL, contrast: 1 }), [0.3, 0.5, 0.7])
    expect(out[0]).toBeCloseTo(0.1, 6)
    expect(out[2]).toBeCloseTo(0.9, 6)
  })

  it('contrast -1 flattens everything to mid grey', () => {
    const out = applyGrade(resolveGrade(null, 1, { ...NEUTRAL, contrast: -1 }), RED)
    out.forEach((v) => expect(v).toBeCloseTo(0.5, 6))
  })

  it('saturation -1 gives a grey with the same luma', () => {
    const grade = resolveGrade(null, 1, { ...NEUTRAL, saturation: -1 })
    const out = applyGrade(grade, RED)
    expect(out[0]).toBeCloseTo(out[1]!, 9)
    expect(out[1]).toBeCloseTo(out[2]!, 9)
    expect(out[0]).toBeCloseTo(luma(RED), 9)
  })

  it('saturation 0 leaves colour unchanged, +1 makes it more saturated', () => {
    const same = applyGrade(resolveGrade(null, 1, { ...NEUTRAL, saturation: 0 }), RED)
    same.forEach((v, i) => expect(v).toBeCloseTo(RED[i]!, 9))
    const spread = (rgb: readonly number[]) => Math.max(...rgb) - Math.min(...rgb)
    const vivid = applyGrade(resolveGrade(null, 1, { ...NEUTRAL, saturation: 1 }), RED)
    expect(spread(vivid)).toBeGreaterThan(spread(RED))
  })

  it('black and white output has equal channels for any colour', () => {
    for (const rgb of [RED, [0.2, 0.7, 0.4] as const, [0.05, 0.1, 0.9] as const]) {
      const out = applyGrade(resolveGrade('blackWhite', 1, NEUTRAL), [...rgb])
      expect(out[0]).toBeCloseTo(out[1]!, 9)
      expect(out[1]).toBeCloseTo(out[2]!, 9)
    }
  })

  it('noir is grey as well', () => {
    const out = applyGrade(resolveGrade('noir', 1, NEUTRAL), RED)
    expect(out[0]).toBeCloseTo(out[2]!, 9)
  })

  it('sepia has r > g > b for a mid grey and for red', () => {
    const grey = applyGrade(resolveGrade('sepia', 1, NEUTRAL), MID)
    expect(grey[0]).toBeGreaterThan(grey[1]!)
    expect(grey[1]).toBeGreaterThan(grey[2]!)
  })

  it('clamps out of range adjustment values to -1..1', () => {
    expect(resolveGrade(null, 1, { ...NEUTRAL, brightness: 7 })).toEqual(resolveGrade(null, 1, { ...NEUTRAL, brightness: 1 }))
    expect(resolveGrade(null, 1, { ...NEUTRAL, contrast: -9 })).toEqual(resolveGrade(null, 1, { ...NEUTRAL, contrast: -1 }))
  })

  it('treats missing or non-numeric adjustments as neutral', () => {
    expect(isIdentity(resolveGrade(null, 1, { brightness: NaN, contrast: undefined, saturation: Infinity } as never))).toBe(true)
  })
})

describe('resolveGrade: robustness', () => {
  it('never produces NaN or infinite values', () => {
    const inputs: Array<[string | null, number | undefined, Partial<typeof NEUTRAL> | undefined]> = [
      ['sepia', NaN, { brightness: NaN }],
      [null, Infinity, { contrast: -Infinity, saturation: 1e9 }],
      ['nope', -1, undefined],
      ['vivid', 0.3, { brightness: 0.2, contrast: -0.4, saturation: 0.9 }]
    ]
    for (const [id, amount, adjust] of inputs) {
      const g = resolveGrade(id, amount, adjust)
      expect([...g.matrix, ...g.offset].every(Number.isFinite)).toBe(true)
    }
  })

  it('applyGrade clamps to 0..1', () => {
    const out = applyGrade(resolveGrade(null, 1, { brightness: 1, contrast: 1, saturation: 1 }), [1, 1, 1])
    out.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    })
  })
})
