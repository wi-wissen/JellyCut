import { describe, expect, it } from 'vitest'
import { SPEED_STEPS, nearestSpeedStep, speedStepIndex } from './speed'

describe('SPEED_STEPS', () => {
  it('lists the nine tempo steps from 0.25x to 4x', () => {
    expect(SPEED_STEPS).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4])
  })
})

describe('nearestSpeedStep', () => {
  it('returns a step unchanged', () => {
    for (const step of SPEED_STEPS) expect(nearestSpeedStep(step)).toBe(step)
  })

  it('picks the closest step', () => {
    expect(nearestSpeedStep(1.35)).toBe(1.25)
    expect(nearestSpeedStep(1.4)).toBe(1.5)
    expect(nearestSpeedStep(1.6)).toBe(1.5)
    expect(nearestSpeedStep(2.6)).toBe(3)
  })

  it('clamps values outside the range', () => {
    expect(nearestSpeedStep(0.01)).toBe(0.25)
    expect(nearestSpeedStep(40)).toBe(4)
  })

  it('falls back to normal speed for non-finite input', () => {
    expect(nearestSpeedStep(Number.NaN)).toBe(1)
    expect(nearestSpeedStep(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('a tie goes to the slower step', () => {
    expect(nearestSpeedStep(0.875)).toBe(0.75)
  })
})

describe('speedStepIndex', () => {
  it('gives the slider index of the nearest step', () => {
    expect(speedStepIndex(1)).toBe(3)
    expect(speedStepIndex(4)).toBe(8)
    expect(speedStepIndex(0.25)).toBe(0)
    expect(speedStepIndex(1.3)).toBe(4)
  })
})
