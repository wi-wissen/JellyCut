import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Clip, OverlayItem, Project, TextItem } from '../project/types'
import { secondsToMicros } from '../time'
import { deleteItem } from './ops'
import { MIN_ADD_DURATION, editedSpan, fitSpan, fitToVideo, moveSpan, placeSpan, videoEnd } from './fit'

const s = secondsToMicros

function clip(id: string, start: number, seconds: number): Clip {
  return {
    id,
    track: 'video',
    assetId: 'a1',
    srcIn: 0,
    srcOut: s(seconds),
    start: s(start),
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null
  }
}

function projectWith(clips: Clip[], assetSeconds = 120): Project {
  const p = createProject('Fit')
  return {
    ...p,
    assets: [{ id: 'a1', kind: 'video', name: 'a.mp4', relPath: 'media/a.mp4', size: 1, duration: s(assetSeconds), width: 1920, height: 1080, fps: 30 }],
    clips
  }
}

/** A 30 s video: three clips back to back. */
function thirtySeconds(): Project {
  return projectWith([clip('c1', 0, 10), clip('c2', 10, 10), clip('c3', 20, 10)])
}

function sticker(id: string, start: number, duration: number): OverlayItem {
  return {
    id,
    kind: 'sticker',
    start: s(start),
    duration: s(duration),
    pos: { x: 0.5, y: 0.5 },
    scale: 1,
    rotation: 0,
    emoji: '⭐',
    size: 0.12
  }
}

function title(id: string, start: number, duration: number): TextItem {
  return {
    id,
    start: s(start),
    duration: s(duration),
    text: 'Hi',
    style: { font: 'Sora', size: 40, color: '#ffffff', outline: null },
    pos: { x: 0.5, y: 0.5 },
    animIn: null,
    animOut: null
  }
}

describe('videoEnd', () => {
  it('is zero without clips', () => {
    expect(videoEnd(createProject('Empty'))).toBe(0)
  })

  it('is the end of the last clip', () => {
    expect(videoEnd(thirtySeconds())).toBe(s(30))
  })

  it('follows speed changes', () => {
    const p = projectWith([clip('c1', 0, 10), { ...clip('c2', 10, 10), speed: 2 }])
    expect(videoEnd(p)).toBe(s(15))
  })

  it('counts the overlap of a transition, which shortens the planned video', () => {
    const p = projectWith([clip('c1', 0, 5), { ...clip('c2', 5, 5), transitionIn: { type: 'fade', duration: s(1) } }], 5)
    expect(videoEnd(p)).toBe(s(9))
  })

  it('ignores music and texts', () => {
    const p = { ...thirtySeconds(), music: [{ id: 'm', assetId: 'a1', start: 0, srcIn: 0, srcOut: s(90), volume: 1, fadeIn: 0, fadeOut: 0 }] }
    expect(videoEnd(p)).toBe(s(30))
  })
})

describe('placeSpan (new items at the playhead)', () => {
  it('keeps the playhead and the default length inside the video', () => {
    expect(placeSpan(s(2), s(3), s(30))).toEqual({ start: s(2), duration: s(3) })
  })

  it('starts no later than MIN_ADD_DURATION before the end and ends at the end', () => {
    expect(placeSpan(s(29.8), s(3), s(30))).toEqual({ start: s(30) - MIN_ADD_DURATION, duration: MIN_ADD_DURATION })
  })

  it('at or after the end, ends at the end with the default length', () => {
    expect(placeSpan(s(30), s(3), s(30))).toEqual({ start: s(27), duration: s(3) })
    expect(placeSpan(s(45), s(3), s(30))).toEqual({ start: s(27), duration: s(3) })
  })

  it('uses the rest of a video shorter than the minimum', () => {
    expect(placeSpan(s(0.2), s(3), s(0.3))).toEqual({ start: 0, duration: s(0.3) })
  })

  it('is not clamped without clips', () => {
    expect(placeSpan(s(5), s(3), 0)).toEqual({ start: s(5), duration: s(3) })
  })
})

describe('moveSpan (moves keep the length and stop flush)', () => {
  it('stops flush at the end', () => {
    expect(moveSpan(s(29), s(3), s(30))).toEqual({ start: s(27), duration: s(3) })
  })

  it('stops at zero', () => {
    expect(moveSpan(s(-4), s(3), s(30))).toEqual({ start: 0, duration: s(3) })
  })

  it('shortens an item that is longer than the video', () => {
    expect(moveSpan(0, s(40), s(30))).toEqual({ start: 0, duration: s(30) })
  })
})

describe('fitSpan (items reaching past the end)', () => {
  it('shortens an item that sticks out', () => {
    expect(fitSpan(s(28), s(5), s(30))).toEqual({ start: s(28), duration: s(2) })
  })

  it('moves an item that starts at or after the end so it ends there, keeping its length', () => {
    expect(fitSpan(s(31), s(3), s(30))).toEqual({ start: s(27), duration: s(3) })
    expect(fitSpan(s(30), s(2), s(30))).toEqual({ start: s(28), duration: s(2) })
  })

  it('shortens an item to the video when the video is shorter than the item', () => {
    expect(fitSpan(s(31), s(40), s(30))).toEqual({ start: 0, duration: s(30) })
  })

  it('leaves an item inside the video unchanged', () => {
    expect(fitSpan(s(1), s(2), s(30))).toEqual({ start: s(1), duration: s(2) })
  })

  it('does nothing without clips', () => {
    expect(fitSpan(s(31), s(3), 0)).toEqual({ start: s(31), duration: s(3) })
  })
})

describe('editedSpan', () => {
  it('treats a start-only edit as a move', () => {
    // The span is the item after the patch, as updateOverlay passes it.
    expect(editedSpan({ start: s(29), duration: s(3) }, { start: s(29) }, s(30))).toEqual({ start: s(27), duration: s(3) })
  })

  it('treats any other timing edit as a trim at the end', () => {
    expect(editedSpan({ start: s(1), duration: s(40) }, { duration: s(40) }, s(30))).toEqual({ start: s(1), duration: s(29) })
  })
})

describe('fitToVideo', () => {
  it('returns the same project when there are no clips, so a title can be added first', () => {
    const p = { ...createProject('Titles'), texts: [title('t1', 0, 3600)] }
    expect(fitToVideo(p)).toBe(p)
  })

  it('returns the same project when nothing hangs over the end', () => {
    const p = { ...thirtySeconds(), overlays: [sticker('o1', 1, 2)], texts: [title('t1', 28, 2)] }
    expect(fitToVideo(p)).toBe(p)
  })

  it('shortens overlays and texts that hang over the end', () => {
    const p = { ...thirtySeconds(), overlays: [sticker('o1', 28, 5)], texts: [title('t1', 29, 4)] }
    const fitted = fitToVideo(p)
    expect(fitted.overlays[0]).toMatchObject({ start: s(28), duration: s(2) })
    expect(fitted.texts[0]).toMatchObject({ start: s(29), duration: s(1) })
    expect(validateProject(fitted).ok).toBe(true)
  })

  it('moves items that start after the end flush to it', () => {
    const p = { ...thirtySeconds(), overlays: [sticker('o1', 40, 2)] }
    expect(fitToVideo(p).overlays[0]).toMatchObject({ start: s(28), duration: s(2) })
  })

  it('is idempotent', () => {
    const p = { ...thirtySeconds(), overlays: [sticker('o1', 40, 9)], texts: [title('t1', 25, 9)] }
    const once = fitToVideo(p)
    expect(once).not.toBe(p)
    expect(fitToVideo(once)).toBe(once)
  })

  it('follows the end when the last clip is deleted', () => {
    const p = { ...thirtySeconds(), overlays: [sticker('o1', 25, 3)] }
    const shorter = deleteItem(p, { kind: 'clip', id: 'c3' })
    const fitted = fitToVideo(shorter)
    expect(videoEnd(fitted)).toBe(s(20))
    expect(fitted.overlays[0]).toMatchObject({ start: s(17), duration: s(3) })
  })

  it('does not touch music', () => {
    const music = [{ id: 'm', assetId: 'a1', start: 0, srcIn: 0, srcOut: s(90), volume: 1, fadeIn: 0, fadeOut: 0 }]
    const p = { ...thirtySeconds(), music }
    expect(fitToVideo(p)).toBe(p)
  })
})
