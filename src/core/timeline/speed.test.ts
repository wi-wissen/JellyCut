import { describe, expect, it } from 'vitest'
import {
  AUDIO_MAX_SPEED,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  hasClipSound,
  isSpeedInRange,
  parseSpeedInput,
  timelineLength
} from './speed'

describe('speed range', () => {
  it('is 0.1x to 100x, with 0.25x to 4x as the quick choices', () => {
    expect(SPEED_MIN).toBe(0.1)
    expect(SPEED_MAX).toBe(100)
    expect(SPEED_PRESETS).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 4])
    for (const preset of SPEED_PRESETS) expect(isSpeedInRange(preset)).toBe(true)
  })

  it('includes both boundaries and rejects values just outside', () => {
    expect(isSpeedInRange(0.1)).toBe(true)
    expect(isSpeedInRange(100)).toBe(true)
    expect(isSpeedInRange(0.0999)).toBe(false)
    expect(isSpeedInRange(100.001)).toBe(false)
    expect(isSpeedInRange(Number.NaN)).toBe(false)
    expect(isSpeedInRange(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('a clip has sound up to 4x and is silent above', () => {
    expect(AUDIO_MAX_SPEED).toBe(4)
    expect(hasClipSound(4)).toBe(true)
    expect(hasClipSound(4.001)).toBe(false)
    expect(hasClipSound(20)).toBe(false)
  })
})

describe('parseSpeedInput', () => {
  it('reads 0.1, 100 and 20 as valid', () => {
    expect(parseSpeedInput('0.1')).toEqual({ ok: true, speed: 0.1 })
    expect(parseSpeedInput('100')).toEqual({ ok: true, speed: 100 })
    expect(parseSpeedInput('20')).toEqual({ ok: true, speed: 20 })
  })

  it('accepts a comma as decimal separator and trims spaces', () => {
    expect(parseSpeedInput(' 0,5 ')).toEqual({ ok: true, speed: 0.5 })
    expect(parseSpeedInput('2.')).toEqual({ ok: true, speed: 2 })
    expect(parseSpeedInput('.75')).toEqual({ ok: true, speed: 0.75 })
  })

  it('rounds to three decimals', () => {
    expect(parseSpeedInput('1.23456')).toEqual({ ok: true, speed: 1.235 })
  })

  it('rejects out-of-range values instead of clamping', () => {
    expect(parseSpeedInput('0.05')).toEqual({ ok: false, reason: 'range' })
    expect(parseSpeedInput('101')).toEqual({ ok: false, reason: 'range' })
    expect(parseSpeedInput('0')).toEqual({ ok: false, reason: 'range' })
  })

  it('reports empty and non-numeric input', () => {
    expect(parseSpeedInput('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseSpeedInput('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(parseSpeedInput('fast')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseSpeedInput('-2')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseSpeedInput('1e2')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('timelineLength', () => {
  it('divides the source range by the speed and rounds to whole microseconds', () => {
    expect(timelineLength(10_000_000, 2)).toBe(5_000_000)
    expect(timelineLength(10_000_000, 20)).toBe(500_000)
    expect(timelineLength(1_000_000, 3)).toBe(333_333)
    expect(Number.isInteger(timelineLength(7, 0.3))).toBe(true)
  })
})
