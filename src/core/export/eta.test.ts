import { describe, expect, it } from 'vitest'
import { ETA_MIN_FRAMES, ExportEta } from './eta'

/** Runs an export at a constant speed of one frame per `msPerFrame`, reporting every 8 frames. */
function run(total: number, msPerFrame: number, weights: ArrayLike<number> | null = null, reportEvery = 8): (number | null)[] {
  const eta = new ExportEta(weights, total)
  const out: (number | null)[] = []
  for (let done = 8; done <= total; done += reportEvery) {
    out.push(eta.update(done * msPerFrame, done))
  }
  return out
}

describe('ExportEta', () => {
  it('shows nothing before enough frames are done', () => {
    const eta = new ExportEta(null, 100)
    expect(eta.update(1000, ETA_MIN_FRAMES - 1)).toBeNull()
  })

  it('predicts the remaining time at a steady speed', () => {
    const eta = new ExportEta(null, 300)
    expect(eta.update(16 * 100, 16)).toBeCloseTo(284 * 100, -2)
  })

  it('counts down between updates instead of holding still', () => {
    const eta = new ExportEta(null, 1000)
    const first = eta.update(2000, 20)!
    const later = eta.update(2200, 22)!
    expect(later).toBeLessThan(first)
    expect(first - later).toBeLessThan(400)
  })

  it('weights make the slower later frames count: the estimate rises when they arrive', () => {
    const total = 200
    const uniform = run(total, 10)
    const slowLater = new Float64Array(total).fill(1).map((w, i) => (i >= 100 ? 3 : w))
    const weighted = run(total, 10, slowLater)
    // At the middle of the export the weighted estimate expects the slow half still to come.
    const middle = Math.floor(uniform.length / 2)
    expect(weighted[middle]!).toBeGreaterThan(uniform[middle]!)
  })

  it('holds a value that moves only a little (hysteresis), and never goes negative', () => {
    const eta = new ExportEta(null, 400)
    let elapsed = 1600
    let previous = eta.update(elapsed, 16)!
    let jumps = 0
    for (let done = 24; done <= 400; done += 8) {
      // Each step of 8 frames takes about 800 ms, give or take 3 %: the shown value must not jump around.
      elapsed += 800 * (done % 16 === 0 ? 1.03 : 0.97)
      const now = eta.update(elapsed, done)
      if (now === null) continue
      expect(now).toBeGreaterThanOrEqual(0)
      if (Math.abs(now - previous) > 2500) jumps++
      previous = now
    }
    expect(jumps).toBe(0)
  })

  it('is zero once the last frame is done', () => {
    const eta = new ExportEta(null, 50)
    const value = eta.update(5000, 50)
    expect(value).toBe(0)
  })
})

describe('ExportEta warm-up', () => {
  it('uses the average since the start while the averaging window is not full', () => {
    const eta = new ExportEta(null, 1000)
    // 40 frames in 2 s: 50 ms per frame on average, so 960 frames are still 48 s away.
    expect(eta.update(2000, 40)).toBeCloseTo(960 * 50, -1)
  })
})

describe('ExportEta pausing', () => {
  it('progress made while paused does not change the rate', () => {
    const eta = new ExportEta(null, 1000)
    for (let done = 8; done <= 200; done += 8) eta.update(done * 100, done)
    // 100 frames appear in 1 s while the tab is hidden: this progress says nothing about the speed.
    eta.update(21_000, 300, true)
    // Back at the steady pace of 100 ms per frame: 100 frames in 10 s.
    const value = eta.update(31_000, 400)!
    // 600 frames still to go at 100 ms each.
    expect(value).toBeGreaterThan(60_000 * 0.75)
    expect(value).toBeLessThan(60_000 * 1.25)
  })
})
