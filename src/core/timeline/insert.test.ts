import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '../../engine/media/probe'
import { createProject, validateProject } from '../project/schema'
import type { Asset, Clip, Project } from '../project/types'
import {
  addAsset,
  addMusic,
  appendClip,
  assetFromProbe,
  DEFAULT_IMAGE_CLIP_DURATION,
  IMAGE_MAX_DURATION,
  insertClipAt
} from './insert'

const SEC = 1_000_000

function video(id: string, duration = 10 * SEC): Asset {
  return { id, kind: 'video', name: `${id}.mp4`, relPath: `media/${id}.mp4`, size: 1000, duration, width: 1920, height: 1080, fps: 30 }
}

function image(id: string): Asset {
  return { id, kind: 'image', name: `${id}.png`, relPath: `media/${id}.png`, size: 500, duration: IMAGE_MAX_DURATION }
}

function audio(id: string, duration = 4 * SEC): Asset {
  return { id, kind: 'audio', name: `${id}.mp3`, relPath: `media/${id}.mp3`, size: 800, duration }
}

function clip(id: string, start: number, length: number, assetId = 'v1'): Clip {
  return {
    id,
    track: 'video',
    assetId,
    srcIn: 0,
    srcOut: length,
    start,
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null
  }
}

function projectWith(assets: Asset[], clips: Clip[] = []): Project {
  return { ...createProject('test'), assets, clips }
}

function expectValid(project: Project): void {
  const result = validateProject(project)
  expect(result.ok, result.ok ? '' : result.errors.join('; ')).toBe(true)
}

function startsAndLengths(project: Project): [string, number, number][] {
  return [...project.clips]
    .sort((a, b) => a.start - b.start)
    .map((c) => [c.id, c.start, c.srcOut - c.srcIn])
}

function info(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
    kind: 'video',
    name: 'clip.webm',
    size: 4321,
    duration: 4 * SEC,
    width: 640,
    height: 360,
    fps: 30,
    hasAudio: true,
    videoCodec: 'vp9',
    audioCodec: 'opus',
    problems: [],
    ...overrides
  }
}

describe('assetFromProbe', () => {
  it('copies the probe fields of a video', () => {
    const asset = assetFromProbe(info(), 'a1', 'clip.webm')
    expect(asset).toEqual({
      id: 'a1',
      kind: 'video',
      name: 'clip.webm',
      relPath: 'clip.webm',
      size: 4321,
      duration: 4 * SEC,
      width: 640,
      height: 360,
      fps: 30,
      hasAudio: true
    })
  })

  it('gives images the maximum duration, whatever the probe reported', () => {
    const asset = assetFromProbe(info({ kind: 'image', duration: 0, width: 320, height: 180, fps: undefined }), 'img', 'still.png')
    expect(asset.kind).toBe('image')
    expect(asset.duration).toBe(IMAGE_MAX_DURATION)
    expect(asset.width).toBe(320)
    expect(asset).not.toHaveProperty('fps')
  })

  it('omits optional fields the probe did not report', () => {
    const asset = assetFromProbe(info({ kind: 'audio', width: undefined, height: undefined, fps: undefined }), 'm', 'm.mp3')
    expect(asset).not.toHaveProperty('width')
    expect(asset).not.toHaveProperty('height')
    expect(asset).not.toHaveProperty('fps')
    expect(asset.duration).toBe(4 * SEC)
  })

  it('records whether a video or audio file has sound, but not for images', () => {
    expect(assetFromProbe(info({ hasAudio: false }), 'v', 'v.mp4').hasAudio).toBe(false)
    expect(assetFromProbe(info({ kind: 'audio', hasAudio: true }), 'm', 'm.mp3').hasAudio).toBe(true)
    expect(assetFromProbe(info({ kind: 'image', hasAudio: false }), 'i', 'i.png')).not.toHaveProperty('hasAudio')
  })

  it('keeps a zero-duration video at zero (the store marks it unsupported)', () => {
    expect(assetFromProbe(info({ duration: 0 }), 'v', 'v.mp4').duration).toBe(0)
  })
})

describe('addAsset', () => {
  it('appends the asset without changing the input', () => {
    const before = projectWith([video('v1')])
    const after = addAsset(before, video('v2'))
    expect(after.assets.map((a) => a.id)).toEqual(['v1', 'v2'])
    expect(before.assets.map((a) => a.id)).toEqual(['v1'])
    expectValid(after)
  })

  it('rejects a duplicate asset id', () => {
    expect(() => addAsset(projectWith([video('v1')]), video('v1'))).toThrow(RangeError)
  })
})

describe('appendClip', () => {
  it('adds a video clip at 0 to an empty track with the full asset length', () => {
    const project = projectWith([video('v1', 7 * SEC)])
    const next = appendClip(project, 'v1', 'c1')
    expect(next.clips).toHaveLength(1)
    const c = next.clips[0]!
    expect(c).toEqual({
      id: 'c1',
      track: 'video',
      assetId: 'v1',
      srcIn: 0,
      srcOut: 7 * SEC,
      start: 0,
      speed: 1,
      transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
      volume: 1,
      muted: false,
      filter: null,
      transitionIn: null
    })
    expectValid(next)
  })

  it('starts after the end of the last clip', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 2 * SEC), clip('b', 2 * SEC, 3 * SEC)])
    const next = appendClip(project, 'v1', 'c')
    expect(next.clips.find((c) => c.id === 'c')?.start).toBe(5 * SEC)
    expectValid(next)
  })

  it('uses the end of the clip that finishes last, not the last one in the array', () => {
    const project = projectWith([video('v1')], [clip('late', 9 * SEC, 1 * SEC), clip('early', 0, 2 * SEC)])
    const next = appendClip(project, 'v1', 'c')
    expect(next.clips.find((c) => c.id === 'c')?.start).toBe(10 * SEC)
  })

  it('counts the speed of existing clips when finding the end', () => {
    const fast: Clip = { ...clip('fast', 0, 4 * SEC), speed: 2 }
    const next = appendClip(projectWith([video('v1')], [fast]), 'v1', 'c')
    expect(next.clips.find((c) => c.id === 'c')?.start).toBe(2 * SEC)
  })

  it('gives an image a 5 second clip', () => {
    const next = appendClip(projectWith([image('img')]), 'img', 'c')
    const c = next.clips[0]!
    expect(c.srcIn).toBe(0)
    expect(c.srcOut).toBe(DEFAULT_IMAGE_CLIP_DURATION)
    expect(DEFAULT_IMAGE_CLIP_DURATION).toBe(5 * SEC)
    expectValid(next)
  })

  it('throws a RangeError for audio', () => {
    expect(() => appendClip(projectWith([audio('m')]), 'm', 'c')).toThrow(RangeError)
  })

  it('throws for an unknown asset', () => {
    expect(() => appendClip(projectWith([]), 'nope', 'c')).toThrow(RangeError)
  })

  it('throws when the clip id is already used by a text, music item or clip', () => {
    const project = projectWith([video('v1')], [clip('c', 0, SEC)])
    expect(() => appendClip(project, 'v1', 'c')).toThrow(RangeError)
  })

  it('throws for a video whose duration is zero', () => {
    expect(() => appendClip(projectWith([video('v1', 0)]), 'v1', 'c')).toThrow(RangeError)
  })

  it('does not modify the input project', () => {
    const project = projectWith([video('v1')], [clip('a', 0, SEC)])
    const snapshot = JSON.stringify(project)
    appendClip(project, 'v1', 'c')
    expect(JSON.stringify(project)).toBe(snapshot)
  })
})

describe('addMusic', () => {
  it('adds a music item with the full length, 0.6 volume and no fades', () => {
    const project = projectWith([audio('m', 12 * SEC)])
    const next = addMusic(project, 'm', 'mu1', 3 * SEC)
    expect(next.music).toEqual([
      { id: 'mu1', assetId: 'm', start: 3 * SEC, srcIn: 0, srcOut: 12 * SEC, volume: 0.6, fadeIn: 0, fadeOut: 0 }
    ])
    expectValid(next)
  })

  it('keeps existing music items', () => {
    const first = addMusic(projectWith([audio('m')]), 'm', 'mu1', 0)
    const second = addMusic(first, 'm', 'mu2', SEC)
    expect(second.music.map((m) => m.id)).toEqual(['mu1', 'mu2'])
    expectValid(second)
  })

  it('throws for a video asset', () => {
    expect(() => addMusic(projectWith([video('v1')]), 'v1', 'mu', 0)).toThrow(RangeError)
  })

  it('throws for an unknown asset', () => {
    expect(() => addMusic(projectWith([]), 'm', 'mu', 0)).toThrow(RangeError)
  })

  it('throws for a negative or fractional start', () => {
    const project = projectWith([audio('m')])
    expect(() => addMusic(project, 'm', 'mu', -1)).toThrow(RangeError)
    expect(() => addMusic(project, 'm', 'mu', 1.5)).toThrow(RangeError)
  })

  it('throws when the id is already in use', () => {
    const project = addMusic(projectWith([audio('m')]), 'm', 'mu', 0)
    expect(() => addMusic(project, 'm', 'mu', SEC)).toThrow(RangeError)
  })
})

describe('insertClipAt', () => {
  it('inserts at 0 on an empty track', () => {
    const next = insertClipAt(projectWith([video('v1')]), 'v1', 'c', 5 * SEC)
    expect(startsAndLengths(next)).toEqual([['c', 0, 10 * SEC]])
    expectValid(next)
  })

  it('inserts before the first clip when the time is nearer the start', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 4 * SEC), clip('b', 4 * SEC, 4 * SEC)])
    const next = insertClipAt(project, 'v1', 'c', 100_000)
    expect(next.clips.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(startsAndLengths(next)).toEqual([
      ['c', 0, 10 * SEC],
      ['a', 10 * SEC, 4 * SEC],
      ['b', 14 * SEC, 4 * SEC]
    ])
    expectValid(next)
  })

  it('inserts between two clips at the nearest cut', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 4 * SEC), clip('b', 4 * SEC, 4 * SEC)])
    const next = insertClipAt(project, 'v1', 'c', 4 * SEC + 900_000)
    expect(next.clips.map((c) => c.id)).toEqual(['a', 'c', 'b'])
    expect(startsAndLengths(next)).toEqual([
      ['a', 0, 4 * SEC],
      ['c', 4 * SEC, 10 * SEC],
      ['b', 14 * SEC, 4 * SEC]
    ])
    expectValid(next)
  })

  it('appends after the last clip when the time is past the end', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 4 * SEC)])
    const next = insertClipAt(project, 'v1', 'c', 60 * SEC)
    expect(next.clips.map((c) => c.id)).toEqual(['a', 'c'])
    expect(next.clips.find((c) => c.id === 'c')?.start).toBe(4 * SEC)
    expectValid(next)
  })

  it('closes gaps between existing clips', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 2 * SEC), clip('b', 5 * SEC, 2 * SEC)])
    const next = insertClipAt(project, 'v1', 'c', 0)
    expect(startsAndLengths(next)).toEqual([
      ['c', 0, 10 * SEC],
      ['a', 10 * SEC, 2 * SEC],
      ['b', 12 * SEC, 2 * SEC]
    ])
    expectValid(next)
  })

  it('uses the cut at the end of a clip when the time falls on it', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 2 * SEC), clip('b', 2 * SEC, 2 * SEC), clip('d', 4 * SEC, 2 * SEC)])
    const next = insertClipAt(project, 'v1', 'c', 2 * SEC)
    expect(next.clips.map((c) => c.id)).toEqual(['a', 'c', 'b', 'd'])
    expectValid(next)
  })

  it('treats a time on a clip start as the cut before that clip', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 2 * SEC), clip('b', 2 * SEC, 2 * SEC)])
    const next = insertClipAt(project, 'v1', 'c', 2 * SEC - 10_000)
    expect(next.clips.map((c) => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('handles clips given out of time order', () => {
    const project = projectWith([video('v1')], [clip('b', 4 * SEC, 4 * SEC), clip('a', 0, 4 * SEC)])
    const next = insertClipAt(project, 'v1', 'c', 4 * SEC)
    expect(startsAndLengths(next).map(([id]) => id)).toEqual(['a', 'c', 'b'])
    expectValid(next)
  })

  it('keeps the transform and other properties of existing clips', () => {
    const styled: Clip = { ...clip('a', 0, 4 * SEC), volume: 0.5, muted: true, filter: 'warm', transform: { fit: 'fill', scale: 2, x: 0.1, y: -0.1, rotation: 90, flipX: true } }
    const next = insertClipAt(projectWith([video('v1')], [styled]), 'v1', 'c', 0)
    expect(next.clips.find((c) => c.id === 'a')).toEqual({ ...styled, start: 10 * SEC })
  })

  it('inserts an image as a 5 second clip', () => {
    const next = insertClipAt(projectWith([image('img'), video('v1')], [clip('a', 0, 4 * SEC)]), 'img', 'c', 0)
    expect(next.clips.find((c) => c.id === 'c')?.srcOut).toBe(DEFAULT_IMAGE_CLIP_DURATION)
    expectValid(next)
  })

  it('throws for audio', () => {
    expect(() => insertClipAt(projectWith([audio('m')]), 'm', 'c', 0)).toThrow(RangeError)
  })

  it('does not modify the input project', () => {
    const project = projectWith([video('v1')], [clip('a', 0, 4 * SEC), clip('b', 6 * SEC, 4 * SEC)])
    const snapshot = JSON.stringify(project)
    insertClipAt(project, 'v1', 'c', 4 * SEC)
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it('returns a result that keeps the music and text items untouched', () => {
    const base = addMusic(projectWith([audio('m'), video('v1')], [clip('a', 0, SEC)]), 'm', 'mu', 0)
    const next = insertClipAt(base, 'v1', 'c', 0)
    expect(next.music).toEqual(base.music)
    expect(next.texts).toEqual(base.texts)
    expectValid(next)
  })
})
