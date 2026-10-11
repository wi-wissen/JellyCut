import { describe, expect, it } from 'vitest'
import { frameStart, secondsToMicros } from '../time'
import {
  clampPxPerSecond,
  DEFAULT_PX_PER_SECOND,
  fitPxPerSecond,
  maxPxPerSecond,
  microsToPx,
  MIN_PX_PER_SECOND,
  pxToMicros,
  rulerTicks,
  sliderFromZoom,
  zoomFromSlider
} from './ruler'

describe('zoom range', () => {
  it('allows one frame to be 64 px wide at the top zoom', () => {
    expect(maxPxPerSecond(30) / 30).toBe(64)
    expect(maxPxPerSecond(25) / 25).toBe(64)
  })

  it('clamps to the range', () => {
    expect(clampPxPerSecond(1, 30)).toBe(MIN_PX_PER_SECOND)
    expect(clampPxPerSecond(1e9, 30)).toBe(1920)
    expect(clampPxPerSecond(50, 30)).toBe(50)
  })

  it('fits the duration into the viewport', () => {
    expect(fitPxPerSecond(900, secondsToMicros(30), 30)).toBe(30)
  })

  it('falls back to the default zoom for an empty project or no width', () => {
    expect(fitPxPerSecond(900, 0, 30)).toBe(DEFAULT_PX_PER_SECOND)
    expect(fitPxPerSecond(0, secondsToMicros(30), 30)).toBe(DEFAULT_PX_PER_SECOND)
  })

  it('clamps the fit to the zoom range', () => {
    expect(fitPxPerSecond(10, secondsToMicros(3600), 30)).toBe(MIN_PX_PER_SECOND)
  })

  it('maps the slider ends to the zoom ends and back', () => {
    expect(zoomFromSlider(0, 30)).toBeCloseTo(MIN_PX_PER_SECOND)
    expect(zoomFromSlider(100, 30)).toBeCloseTo(1920)
    expect(sliderFromZoom(MIN_PX_PER_SECOND, 30)).toBe(0)
    expect(sliderFromZoom(1920, 30)).toBe(100)
    expect(sliderFromZoom(zoomFromSlider(37, 30), 30)).toBe(37)
  })

  it('maps slider values outside 0..100 to the ends', () => {
    expect(zoomFromSlider(-5, 30)).toBeCloseTo(MIN_PX_PER_SECOND)
    expect(zoomFromSlider(200, 30)).toBeCloseTo(1920)
  })
})

describe('px and micros', () => {
  it('converts both ways', () => {
    expect(microsToPx(secondsToMicros(2), 50)).toBe(100)
    expect(pxToMicros(100, 50)).toBe(secondsToMicros(2))
  })

  it('returns integer micros', () => {
    expect(Number.isInteger(pxToMicros(33.3, 47))).toBe(true)
  })
})

describe('rulerTicks', () => {
  it('uses 1 s steps when there is room', () => {
    const ticks = rulerTicks(secondsToMicros(3), 100, 30)
    expect(ticks.map((t) => t.label)).toEqual(['00:00', '00:01', '00:02', '00:03'])
  })

  it('labels a whole second as seconds even at 30 fps', () => {
    const ticks = rulerTicks(secondsToMicros(3), 100, 30)
    expect(ticks.map((t) => t.label)).toEqual(['00:00', '00:01', '00:02', '00:03'])
  })

  it('goes to 2 s steps when 1 s labels would be too close', () => {
    const ticks = rulerTicks(secondsToMicros(6), 50, 30)
    expect(ticks.map((t) => t.label)).toEqual(['00:00', '00:02', '00:04', '00:06'])
  })

  it('uses 30 s and then minute steps when zoomed out', () => {
    const ticks = rulerTicks(secondsToMicros(600), 4, 30)
    expect(ticks.slice(0, 4).map((t) => t.label)).toEqual(['00:00', '00:30', '01:00', '01:30'])
    expect(ticks.length).toBe(21)
    const minutes = rulerTicks(secondsToMicros(600), 2, 30).length
    expect(minutes).toBeGreaterThan(0)
  })

  it('uses frame labels at the highest zoom', () => {
    const fps = 30
    const ticks = rulerTicks(secondsToMicros(1), maxPxPerSecond(fps), fps)
    expect(ticks[0]?.label).toBe('00:00:00')
    expect(ticks[1]?.label).toBe('00:00:01')
    // Frame ticks are exact frame boundaries.
    expect(ticks[1]?.micros).toBe(frameStart(1, fps))
  })

  it('keeps labels at least 60 px apart', () => {
    for (const pps of [4, 17, 50, 130, 700, 1920]) {
      const ticks = rulerTicks(secondsToMicros(100), pps, 30)
      for (let i = 1; i < ticks.length; i++) {
        expect((ticks[i]?.px ?? 0) - (ticks[i - 1]?.px ?? 0)).toBeGreaterThanOrEqual(60 - 1e-9)
      }
    }
  })

  it('stops at the span and includes it when it lands on a tick', () => {
    const ticks = rulerTicks(secondsToMicros(4), 100, 30)
    expect(ticks[ticks.length - 1]?.micros).toBe(secondsToMicros(4))
    expect(ticks.every((t) => t.micros <= secondsToMicros(4))).toBe(true)
  })

  it('returns only the 0 tick for a zero span', () => {
    expect(rulerTicks(0, 50, 30).map((t) => t.micros)).toEqual([0])
  })
})
