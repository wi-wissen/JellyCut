import { describe, expect, it } from 'vitest'
import type { PhaseSeconds } from './estimate'
import {
  EMPTY_CALIBRATION,
  calibrationFor,
  estimateRange,
  familyCalibrated,
  familyOf,
  learnRun,
  parseCalibration,
  uncertainty,
  updateCalibration,
  type Calibration
} from './calibration'

const phases = (decode: number, draw: number, encode: number, audio = 0, fixed = 0): PhaseSeconds => ({ decode, draw, encode, audio, fixed })

describe('familyOf', () => {
  it('maps VP9 and AV1 to the software family', () => {
    expect(familyOf('vp9')).toBe('software')
    expect(familyOf('av1')).toBe('software')
    expect(familyOf('avc')).toBe('avc')
  })
})

describe('parseCalibration', () => {
  it('reads the first format (one factor per family) as a plain entry with one sample', () => {
    const c = parseCalibration({ avc: 1.5, software: null })
    expect(c.avc.plain).toEqual({ samples: 1, factors: { decode: 1.5, draw: 1.5, encode: 1.5 } })
    expect(c.software.plain).toBeUndefined()
  })

  it('reads the phase format and drops entries without samples or with broken factors', () => {
    const c = parseCalibration({
      avc: { plain: { samples: 2, factors: { decode: 1, draw: 2, encode: 3 } }, video: { samples: 0, factors: { decode: 1, draw: 1, encode: 1 } } },
      software: { plain: { samples: 1, factors: { decode: Number.NaN, draw: 1, encode: 1 } } }
    })
    expect(c.avc.plain).toEqual({ samples: 2, factors: { decode: 1, draw: 2, encode: 3 } })
    expect(c.avc.video).toBeUndefined()
    expect(c.software.plain).toBeUndefined()
  })

  it('clamps stored factors to 0.1 .. 10 and ignores garbage', () => {
    expect(parseCalibration({ avc: 1000 }).avc.plain?.factors.draw).toBe(10)
    expect(parseCalibration('nonsense')).toEqual(EMPTY_CALIBRATION)
    expect(parseCalibration(null)).toEqual(EMPTY_CALIBRATION)
  })
})

describe('calibrationFor', () => {
  it('uses the own entry when it has samples', () => {
    const c: Calibration = { avc: { video: { samples: 3, factors: { decode: 2, draw: 2, encode: 2 } } }, software: {} }
    expect(calibrationFor(c, 'avc', 'video')).toEqual({ factors: { decode: 2, draw: 2, encode: 2 }, samples: 3 })
  })

  it('borrows the factors of the best-known class with zero own samples, so the range stays wide', () => {
    const c: Calibration = { avc: { plain: { samples: 4, factors: { decode: 1.2, draw: 1.1, encode: 1.3 } } }, software: {} }
    expect(calibrationFor(c, 'avc', 'video')).toEqual({ factors: { decode: 1.2, draw: 1.1, encode: 1.3 }, samples: 0 })
  })

  it('is neutral with nothing learned', () => {
    expect(calibrationFor(EMPTY_CALIBRATION, 'software', 'plain')).toEqual({ factors: { decode: 1, draw: 1, encode: 1 }, samples: 0 })
  })
})

describe('familyCalibrated', () => {
  it('is false until one export of the family has taught something, whatever the class', () => {
    expect(familyCalibrated(EMPTY_CALIBRATION, 'avc')).toBe(false)
    const after = learnRun(EMPTY_CALIBRATION, 'avc', 'video', phases(2, 2, 2), phases(4, 4, 4))
    expect(familyCalibrated(after, 'avc')).toBe(true)
    expect(familyCalibrated(after, 'software')).toBe(false)
  })
})

describe('learnRun', () => {
  it('ignores exports shorter than 3 s of measured time', () => {
    expect(learnRun(EMPTY_CALIBRATION, 'avc', 'plain', phases(0.5, 0.5, 0.5), phases(0.6, 0.6, 0.6))).toBe(EMPTY_CALIBRATION)
  })

  it('takes the measured/predicted ratio of each phase group as the first sample', () => {
    const c = learnRun(EMPTY_CALIBRATION, 'avc', 'plain', phases(10, 10, 10), phases(20, 5, 30))
    expect(c.avc.plain).toEqual({ samples: 1, factors: { decode: 2, draw: 0.5, encode: 3 } })
  })

  it('moves the factor by half the difference on the second export, then by a smaller share', () => {
    let c = learnRun(EMPTY_CALIBRATION, 'avc', 'plain', phases(10, 10, 10), phases(20, 20, 20))
    c = learnRun(c, 'avc', 'plain', phases(10, 10, 10), phases(10, 10, 10))
    expect(c.avc.plain!.factors.decode).toBeCloseTo(1.5, 9)
    expect(c.avc.plain!.samples).toBe(2)
    c = learnRun(c, 'avc', 'plain', phases(10, 10, 10), phases(10, 10, 10))
    expect(c.avc.plain!.factors.decode).toBeCloseTo(1.5 * (2 / 3) + 1 / 3, 9)
  })

  it('does not learn a phase group with too little predicted work', () => {
    const c = learnRun(EMPTY_CALIBRATION, 'avc', 'plain', phases(0.01, 10, 10), phases(1, 20, 20))
    expect(c.avc.plain!.factors.decode).toBe(1)
    expect(c.avc.plain!.factors.draw).toBe(2)
  })

  it('keeps the families and classes apart', () => {
    const c = learnRun(EMPTY_CALIBRATION, 'software', 'video', phases(10, 10, 10), phases(40, 40, 40))
    expect(c.software.video!.factors.encode).toBe(4)
    expect(c.avc).toEqual({})
    expect(c.software.plain).toBeUndefined()
  })

  it('starts a new class from the borrowed factors of the family', () => {
    const plain = learnRun(EMPTY_CALIBRATION, 'avc', 'plain', phases(10, 10, 10), phases(20, 20, 20))
    const video = learnRun(plain, 'avc', 'video', phases(10, 10, 10), phases(20, 20, 20))
    expect(video.avc.video!.samples).toBe(1)
    expect(video.avc.video!.factors.decode).toBe(2)
  })

  it('clamps factors to 0.1 .. 10 even for extreme ratios', () => {
    const c = learnRun(EMPTY_CALIBRATION, 'avc', 'plain', phases(1, 1, 1), phases(1000, 0.001, 1000))
    expect(c.avc.plain!.factors.decode).toBe(10)
    expect(c.avc.plain!.factors.draw).toBe(0.1)
  })
})

describe('uncertainty and ranges', () => {
  it('starts at 50 % with no sample and shrinks with the number of samples', () => {
    expect(uncertainty(0)).toBeCloseTo(0.5, 9)
    expect(uncertainty(1)).toBeLessThan(uncertainty(0))
    expect(uncertainty(4)).toBeLessThan(uncertainty(1))
  })

  it('never goes below 10 %', () => {
    expect(uncertainty(10_000)).toBe(0.1)
  })

  it('the range narrows around the estimate as samples accumulate', () => {
    const width = (samples: number) => {
      const r = estimateRange(120, samples)
      return r.high / r.low
    }
    expect(width(0)).toBeGreaterThan(width(2))
    expect(width(2)).toBeGreaterThan(width(20))
  })
})

describe('updateCalibration (GIF speed)', () => {
  it('takes the ratio as the first sample and averages with weight 0.5 after', () => {
    expect(updateCalibration(null, 100, 150)).toBeCloseTo(1.5, 12)
    expect(updateCalibration(2, 100, 100)).toBeCloseTo(1.5, 12)
  })

  it('ignores nonsense and too-short samples', () => {
    expect(updateCalibration(1.7, Number.NaN, 100)).toBe(1.7)
    expect(updateCalibration(1.7, 100, 0)).toBe(1.7)
    expect(updateCalibration(null, 2, 2.9)).toBeNull()
  })
})
