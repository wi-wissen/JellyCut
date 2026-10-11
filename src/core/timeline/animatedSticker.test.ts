import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Clip, Project, StickerOverlay } from '../project/types'
import { animatedSticker } from '../render/stickerAnimations'
import { buildScene, planTimeline } from '../render/scene'
import { secondsToMicros } from '../time'
import { fitSpan, fitToVideo, moveSpan, placeSpan, snapLoops, wholeLoops } from './fit'
import { addImageSticker, duplicateOverlay, moveOverlay, trimOverlayEnd, trimOverlayStart, updateOverlay } from './overlayOps'

const s = secondsToMicros
const LOOP = animatedSticker('heart')!.loopMicros
const FRAMES = animatedSticker('heart')!.frames

function clip(seconds: number): Clip {
  return {
    id: 'c1', track: 'video', assetId: 'a1', srcIn: 0, srcOut: s(seconds), start: 0, speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false }, volume: 1, muted: false, filter: null, transitionIn: null
  }
}

/** A video of the given length with no stickers. */
function video(seconds: number): Project {
  return {
    ...createProject('Loops'),
    assets: [{ id: 'a1', kind: 'video', name: 'a.mp4', relPath: 'media/a.mp4', size: 1, duration: s(60), width: 1920, height: 1080, fps: 30 }],
    clips: [clip(seconds)]
  }
}

const first = (p: Project) => p.overlays[0] as StickerOverlay
const loops = (p: Project) => first(p).duration / LOOP

describe('whole-loop spans (pure helpers)', () => {
  it('snaps to the nearest loop count, never below one', () => {
    expect(snapLoops(1, LOOP)).toBe(LOOP)
    expect(snapLoops(Math.round(2.4 * LOOP), LOOP)).toBe(2 * LOOP)
    expect(snapLoops(Math.round(2.6 * LOOP), LOOP)).toBe(3 * LOOP)
  })

  it('counts whole loops that fit', () => {
    expect(wholeLoops(Math.round(2.9 * LOOP), LOOP)).toBe(2 * LOOP)
    expect(wholeLoops(LOOP - 1, LOOP)).toBe(0)
  })

  it('rounds down at the video end and runs to the end only when less than one loop fits', () => {
    const end = Math.round(5.5 * LOOP)
    expect(fitSpan(0, 8 * LOOP, end, LOOP)).toEqual({ start: 0, duration: 5 * LOOP })
    expect(fitSpan(Math.round(4.8 * LOOP), 3 * LOOP, end, LOOP)).toEqual({ start: Math.round(4.8 * LOOP), duration: end - Math.round(4.8 * LOOP) })
    expect(moveSpan(0, 8 * LOOP, end, LOOP)).toEqual({ start: 0, duration: 5 * LOOP })
    expect(moveSpan(end, 3 * LOOP, end, LOOP)).toEqual({ start: end - 3 * LOOP, duration: 3 * LOOP })
    expect(placeSpan(0, 3 * LOOP, end, LOOP)).toEqual({ start: 0, duration: 3 * LOOP })
    const late = placeSpan(end - 100, 3 * LOOP, end, LOOP)
    expect(late.start + late.duration).toBeLessThanOrEqual(end)
    expect(late.duration % LOOP === 0 || late.start + late.duration === end).toBe(true)
  })

  it('leaves items without a loop exactly as before', () => {
    expect(fitSpan(0, 7, 5)).toEqual({ start: 0, duration: 5 })
    expect(moveSpan(4, 3, 5)).toEqual({ start: 2, duration: 3 })
    expect(placeSpan(0, 7, 5)).toEqual({ start: 0, duration: 5 })
  })
})

describe('adding an animated sticker', () => {
  it('starts with three loops and the animated flag', () => {
    const p = addImageSticker(video(30), 'a', s(1), 'heart', undefined, true)
    expect(first(p)).toMatchObject({ imageId: 'heart', animated: true, start: s(1), duration: 3 * LOOP })
    expect(validateProject(p).ok).toBe(true)
  })

  it('is a free-length still sticker when not animated, and ignores the flag for ids without an animation', () => {
    const still = addImageSticker(video(30), 'a', s(1), 'heart')
    expect(first(still)).not.toHaveProperty('animated')
    expect(first(still).duration).toBe(3_000_000)
    const fox = addImageSticker(video(30), 'a', s(1), 'fox', undefined, true)
    expect(first(fox)).not.toHaveProperty('animated')
    expect(first(fox).duration).toBe(3_000_000)
  })

  it('rounds down near the video end and runs to the end when less than one loop fits', () => {
    const p = video(Math.round((5.5 * LOOP) / 1_000_000 * 10) / 10)
    const end = planTimeline(p).duration
    const near = addImageSticker(p, 'a', Math.round(3.2 * LOOP), 'heart', undefined, true)
    expect(first(near).duration % LOOP).toBe(0)
    expect(first(near).start + first(near).duration).toBeLessThanOrEqual(end)
    expect(end - (first(near).start + first(near).duration)).toBeLessThan(LOOP)
    const tight = video(1)
    const added = addImageSticker(tight, 'a', 0, 'heart', undefined, true)
    expect(first(added).start + first(added).duration).toBe(planTimeline(tight).duration)
    expect(first(added).duration).toBeLessThan(LOOP)
  })

  it('keeps whole loops without any clip too', () => {
    const p = addImageSticker(createProject('x'), 'a', 0, 'heart', undefined, true)
    expect(first(p).duration).toBe(3 * LOOP)
  })
})

describe('editing an animated sticker', () => {
  const base = () => addImageSticker(video(60), 'a', s(2), 'heart', undefined, true)

  it('snaps a trimmed end to whole loops', () => {
    expect(loops(trimOverlayEnd(base(), 'a', s(2) + Math.round(1.4 * LOOP)))).toBe(1)
    expect(loops(trimOverlayEnd(base(), 'a', s(2) + Math.round(5.6 * LOOP)))).toBe(6)
    expect(loops(trimOverlayEnd(base(), 'a', s(2) + 10))).toBe(1)
  })

  it('keeps the end when the start is trimmed, in whole loops', () => {
    const p = base()
    const end = first(p).start + first(p).duration
    const trimmed = trimOverlayStart(p, 'a', first(p).start + Math.round(1.2 * LOOP))
    expect(first(trimmed).start + first(trimmed).duration).toBe(end)
    expect(loops(trimmed)).toBe(2)
    const longer = trimOverlayStart(p, 'a', first(p).start - s(1))
    expect(first(longer).start + first(longer).duration).toBe(end)
    expect(first(longer).duration % LOOP).toBe(0)
  })

  it('snaps a typed length and keeps the length when it is moved', () => {
    const typed = updateOverlay(base(), 'a', { duration: s(7) })
    expect(first(typed).duration % LOOP).toBe(0)
    const moved = moveOverlay(base(), 'a', s(20))
    expect(first(moved)).toMatchObject({ start: s(20), duration: 3 * LOOP })
  })

  it('stops a move flush at the video end with whole loops', () => {
    const p = video(20)
    const end = planTimeline(p).duration
    const moved = moveOverlay(addImageSticker(p, 'a', 0, 'heart', undefined, true), 'a', s(19))
    expect(first(moved).start + first(moved).duration).toBe(end)
    expect(first(moved).duration % LOOP).toBe(0)
  })

  it('shortens to whole loops when the animation is switched on, and keeps the length when it is switched off', () => {
    const still = updateOverlay(addImageSticker(video(60), 'a', s(2), 'heart'), 'a', { duration: s(7) })
    const on = updateOverlay(still, 'a', { animated: true })
    expect(first(on)).toMatchObject({ animated: true, duration: 2 * LOOP })
    const off = updateOverlay(on, 'a', { animated: false })
    expect(first(off)).not.toHaveProperty('animated')
    expect(first(off).duration).toBe(2 * LOOP)
  })

  it('never shortens below one loop when the animation is switched on', () => {
    const on = updateOverlay(addImageSticker(video(60), 'a', s(2), 'heart'), 'a', { animated: true })
    expect(first(on).duration).toBe(LOOP)
  })

  it('refuses the flag for stickers without an animation or of another kind', () => {
    const fox = addImageSticker(video(30), 'a', 0, 'fox')
    expect(updateOverlay(fox, 'a', { animated: true })).toBe(fox)
  })

  it('copies the sticker right after the original with whole loops', () => {
    const p = duplicateOverlay(base(), 'a', 'copy')
    const copy = p.overlays[1] as StickerOverlay
    expect(copy.animated).toBe(true)
    expect(copy.duration % LOOP).toBe(0)
  })
})

describe('the video-end invariant for animated stickers', () => {
  it('rounds down to whole loops when the video gets shorter and is idempotent', () => {
    const long = addImageSticker(video(60), 'a', s(2), 'heart', undefined, true)
    const shorter = { ...long, clips: [clip(10)] }
    const fitted = fitToVideo(shorter)
    const end = planTimeline(shorter).duration
    expect(first(fitted).duration % LOOP).toBe(0)
    expect(first(fitted).start + first(fitted).duration).toBeLessThanOrEqual(end)
    expect(end - (first(fitted).start + first(fitted).duration)).toBeLessThan(LOOP)
    expect(fitToVideo(fitted)).toBe(fitted)
  })

  it('normalises a hand-edited length to whole loops on load', () => {
    const p = addImageSticker(video(60), 'a', s(2), 'heart', undefined, true)
    const odd = { ...p, overlays: [{ ...first(p), duration: s(4) }] }
    const fitted = fitToVideo(odd)
    expect(first(fitted).duration % LOOP).toBe(0)
    expect(fitToVideo(fitted)).toBe(fitted)
  })

  it('does not touch still stickers', () => {
    const p = addImageSticker(video(60), 'a', s(2), 'heart')
    expect(fitToVideo(p)).toBe(p)
  })
})

describe('project format', () => {
  it('validates the animated flag strictly', () => {
    const p = addImageSticker(video(30), 'a', 0, 'heart', undefined, true)
    const withFlag = (extra: object, overlay = first(p)) => ({ ...p, overlays: [{ ...overlay, ...extra }] })
    expect(validateProject(withFlag({})).ok).toBe(true)
    expect(validateProject(withFlag({ animated: 'yes' })).ok).toBe(false)
    expect(validateProject(withFlag({ imageId: 'fox' })).ok).toBe(false)
    expect(validateProject(withFlag({ imageId: undefined, emoji: '⭐' })).ok).toBe(false)
    const still = addImageSticker(video(30), 'a', 0, 'heart')
    expect(validateProject(still).ok).toBe(true)
  })

  it('survives a JSON round trip', () => {
    const p = addImageSticker(video(30), 'a', 0, 'heart', undefined, true)
    expect(JSON.parse(JSON.stringify(p)).overlays[0].animated).toBe(true)
  })
})

describe('the scene picks the cell of the loop', () => {
  const p = addImageSticker(video(30), 'a', s(1), 'heart', undefined, true)
  const frameAt = (t: number) => buildScene(p, planTimeline(p), t).overlays[0]!.frame

  it('starts at cell 0, advances, and repeats after one loop', () => {
    expect(frameAt(s(1))).toBe(0)
    expect(frameAt(s(1) + Math.floor(LOOP / 2))).toBe(Math.floor(FRAMES / 2))
    expect(frameAt(s(1) + LOOP)).toBe(0)
    expect(frameAt(s(1) + LOOP + 12_345)).toBe(frameAt(s(1) + 12_345))
  })

  it('has no cell for a still sticker', () => {
    const still = addImageSticker(video(30), 'a', s(1), 'heart')
    expect(buildScene(still, planTimeline(still), s(2)).overlays[0]).not.toHaveProperty('frame')
  })
})
