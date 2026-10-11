import { describe, expect, it } from 'vitest'
import { CAPTURE_FPS, FRAME_INTERVAL_MS, FrameGate, captureSize, sameSize } from './capture'

describe('captureSize', () => {
  it('keeps small pictures and makes odd sides even', () => {
    expect(captureSize(1280, 720)).toEqual({ width: 1280, height: 720 })
    expect(captureSize(801, 601)).toEqual({ width: 802, height: 602 })
  })

  it('caps the long side at 1920 and keeps the aspect ratio', () => {
    expect(captureSize(3840, 2160)).toEqual({ width: 1920, height: 1080 })
    expect(captureSize(2160, 3840)).toEqual({ width: 1080, height: 1920 })
    const odd = captureSize(2561, 1441)
    expect(Math.max(odd.width, odd.height)).toBeLessThanOrEqual(1920)
    expect(odd.width % 2).toBe(0)
    expect(odd.height % 2).toBe(0)
  })

  it('never returns a side below 2 and falls back for invalid input', () => {
    expect(captureSize(4000, 1)).toEqual({ width: 1920, height: 2 })
    expect(captureSize(0, 0)).toEqual({ width: 1280, height: 720 })
    expect(captureSize(Number.NaN, 100)).toEqual({ width: 1280, height: 720 })
  })

  it('compares sizes', () => {
    expect(sameSize({ width: 2, height: 4 }, { width: 2, height: 4 })).toBe(true)
    expect(sameSize({ width: 2, height: 4 }, { width: 4, height: 2 })).toBe(false)
  })
})

describe('FrameGate', () => {
  it('runs at about 30 fps', () => {
    expect(Math.round(1000 / FRAME_INTERVAL_MS)).toBe(CAPTURE_FPS)
  })

  it('draws on every regular tick', () => {
    const gate = new FrameGate()
    const drawn = [0, 33, 66, 99, 133].filter((t) => gate.due(t))
    expect(drawn).toHaveLength(5)
  })

  it('skips ticks that come too early, e.g. from a second timer', () => {
    const gate = new FrameGate()
    expect(gate.due(0)).toBe(true)
    expect(gate.due(5)).toBe(false)
    expect(gate.due(20)).toBe(false)
    expect(gate.due(34)).toBe(true)
  })

  it('draws a late tick once instead of catching up', () => {
    const gate = new FrameGate()
    gate.due(0)
    expect(gate.due(1000)).toBe(true)
    expect(gate.due(1001)).toBe(false)
  })

  it('restarts after reset or when the clock goes backwards', () => {
    const gate = new FrameGate()
    gate.due(500)
    expect(gate.due(100)).toBe(true)
    gate.reset()
    expect(gate.due(101)).toBe(true)
  })
})
