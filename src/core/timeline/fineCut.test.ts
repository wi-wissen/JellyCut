import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import type { Clip, Project } from '../project/types'
import { clipEnd } from './edit'
import {
  FINE_CUT_MAX_PX_PER_FRAME,
  clampCut,
  nominalFps,
  clipForFineCut,
  cutBounds,
  frameIndexLabel,
  pauseJumpTarget,
  pxPerFrameForZoom,
  snapToKeyframe,
  srcToTimeline,
  timelineToSrc
} from './fineCut'

const s = (seconds: number) => Math.round(seconds * 1_000_000)
const FRAME = 33_333

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c1',
    track: 'video',
    assetId: 'a1',
    srcIn: s(2),
    srcOut: s(10),
    start: s(5),
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null,
    ...over
  }
}

/** c1 at 0..8 s is a video clip; c2 at 8..10 s uses an image asset, which the fine cut does not handle. */
function project(): Project {
  const p = createProject('T')
  p.assets = [
    { id: 'a1', kind: 'video', name: 'v.mp4', relPath: 'v', size: 1, duration: s(10), fps: 30 },
    { id: 'img', kind: 'image', name: 'i.png', relPath: 'i', size: 1, duration: 0 }
  ]
  p.clips = [
    clip({ id: 'c1', assetId: 'a1', srcIn: 0, srcOut: s(8), start: 0 }),
    clip({ id: 'c2', assetId: 'img', srcIn: 0, srcOut: s(2), start: s(8) })
  ]
  return p
}

describe('clipForFineCut', () => {
  it('returns the clip under the playhead without a selection', () => {
    expect(clipForFineCut(project(), s(3), null)?.id).toBe('c1')
  })

  it('prefers the selected clip over the one under the playhead', () => {
    const p = project()
    p.assets.push({ id: 'a2', kind: 'video', name: 'w.mp4', relPath: 'w', size: 1, duration: s(10) })
    p.clips.push(clip({ id: 'c3', assetId: 'a2', srcIn: 0, srcOut: s(2), start: s(10) }))
    expect(clipForFineCut(p, s(3), { kind: 'clip', id: 'c3' })?.id).toBe('c3')
  })

  it('ignores a selected text or music item and falls back to the playhead', () => {
    expect(clipForFineCut(project(), s(3), { kind: 'text', id: 'x' })?.id).toBe('c1')
  })

  it('returns null outside the clips, and for image clips', () => {
    expect(clipForFineCut(project(), s(50), null)).toBeNull()
    expect(clipForFineCut(project(), s(9), null)).toBeNull()
  })
})

describe('source and timeline mapping', () => {
  it('maps at speed 1 exactly', () => {
    const c = clip()
    expect(srcToTimeline(c, s(3))).toBe(s(6))
    expect(timelineToSrc(c, s(6))).toBe(s(3))
  })

  it.each([0.5, 1, 2])('round trips timeline -> source -> timeline at speed %s', (speed) => {
    const c = clip({ speed })
    for (let t = c.start; t < clipEnd(c); t += 12_345) {
      const back = srcToTimeline(c, timelineToSrc(c, t))
      expect(Math.abs(back - t)).toBeLessThanOrEqual(1)
    }
  })

  it.each([0.5, 1, 2])('round trips source -> timeline -> source at speed %s', (speed) => {
    const c = clip({ speed })
    for (let src = c.srcIn; src < c.srcOut; src += 33_333) {
      const back = timelineToSrc(c, srcToTimeline(c, src))
      expect(Math.abs(back - src)).toBeLessThanOrEqual(1)
    }
  })

  it('maps a source frame at speed 2 to half a frame of timeline time', () => {
    const c = clip({ speed: 2, start: 0, srcIn: 0, srcOut: s(10) })
    expect(srcToTimeline(c, FRAME)).toBe(Math.round(FRAME / 2))
  })
})

describe('clampCut', () => {
  it('keeps one frame on both sides', () => {
    const c = clip()
    expect(clampCut(c, c.start, FRAME)).toBe(c.start + FRAME)
    expect(clampCut(c, clipEnd(c), FRAME)).toBe(clipEnd(c) - FRAME)
    expect(clampCut(c, s(6), FRAME)).toBe(s(6))
  })

  it('accounts for speed through the timeline frame length passed in', () => {
    const c = clip({ speed: 2 })
    const tlFrame = Math.round(FRAME / 2)
    expect(cutBounds(c, tlFrame)).toEqual({ min: c.start + tlFrame, max: clipEnd(c) - tlFrame })
  })

  it('reports no bounds for a clip shorter than two frames', () => {
    const short = clip({ srcIn: 0, srcOut: FRAME, start: 0 })
    expect(cutBounds(short, FRAME)).toBeNull()
  })
})

describe('frameIndexLabel', () => {
  it('counts frames from the source time, tolerating container rounding', () => {
    expect(frameIndexLabel(0, 30)).toBe(0)
    expect(frameIndexLabel(33_000, 30)).toBe(1)
    expect(frameIndexLabel(s(1), 30)).toBe(30)
    expect(frameIndexLabel(s(11) + 8_000, 30)).toBe(330)
  })
})

describe('nominalFps', () => {
  it('snaps probed averages to the frame rate they stand for', () => {
    expect(nominalFps(29.996)).toBe(30)
    expect(nominalFps(30.001)).toBe(30)
    expect(nominalFps(24)).toBe(24)
  })

  it('keeps NTSC rates exact', () => {
    expect(nominalFps(29.97)).toBe(29.97)
    expect(nominalFps(23.976)).toBe(23.976)
  })
})

describe('snapToKeyframe', () => {
  const keys = [s(0), s(1), s(2)]

  it('returns the nearest keyframe within the threshold', () => {
    expect(snapToKeyframe(s(1) - 40_000, keys, 100_000)).toBe(s(1))
    expect(snapToKeyframe(s(2) + 99_000, keys, 100_000)).toBe(s(2))
  })

  it('returns the candidate when no keyframe is near', () => {
    expect(snapToKeyframe(s(1.5), keys, 100_000)).toBe(s(1.5))
  })

  it('picks the closer one of two keyframes in range', () => {
    expect(snapToKeyframe(s(0.9), [s(0), s(1)], 200_000)).toBe(s(1))
  })
})

describe('pauseJumpTarget', () => {
  it('lands on the pause start converted to the timeline', () => {
    const c = clip({ srcIn: s(2), start: s(5) })
    expect(pauseJumpTarget({ start: s(3), end: s(4) }, c)).toBe(s(6))
  })

  it('clamps a pause before the clip to the clip start and one after it to the clip end', () => {
    const c = clip({ srcIn: s(2), srcOut: s(10), start: s(5) })
    expect(pauseJumpTarget({ start: s(0), end: s(1) }, c)).toBe(c.start)
    expect(pauseJumpTarget({ start: s(20), end: s(21) }, c)).toBe(clipEnd(c))
  })
})

describe('pxPerFrameForZoom', () => {
  it('shows one second across the viewport at zoom 0', () => {
    expect(pxPerFrameForZoom(0, 900, 30)).toBeCloseTo(30, 6)
  })

  it('reaches the maximum of 64 px per frame at zoom 100', () => {
    expect(pxPerFrameForZoom(100, 900, 30)).toBeCloseTo(FINE_CUT_MAX_PX_PER_FRAME, 6)
  })

  it('grows monotonically and stays in range for odd input', () => {
    let last = 0
    for (let z = 0; z <= 100; z += 5) {
      const px = pxPerFrameForZoom(z, 400, 25)
      expect(px).toBeGreaterThanOrEqual(last)
      last = px
    }
    expect(pxPerFrameForZoom(-5, 400, 25)).toBe(pxPerFrameForZoom(0, 400, 25))
    expect(pxPerFrameForZoom(500, 400, 25)).toBe(FINE_CUT_MAX_PX_PER_FRAME)
  })
})
