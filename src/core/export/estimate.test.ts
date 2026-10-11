import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import type { Asset, Clip, MediaOverlay, OverlayItem, Project, RegionOverlay, StickerOverlay, TextItem } from '../project/types'
import { planTimeline } from '../render/scene'
import { FILTERS } from '../filters/filters'
import { clipGrade } from '../filters/ops'
import {
  AUDIO_SECONDS_PER_SECOND,
  BLUR_BACKGROUND_PASSES,
  CODEC_FACTOR,
  DECODE_MP_PER_S,
  DRAW_MP_PER_S,
  ENCODE_MP_PER_S,
  GIF_ENCODE_MP_PER_S,
  GIF_READBACK_MP_PER_S,
  STARTUP_SECONDS,
  UPLOAD_MP_PER_S,
  type EstimateCodec
} from './costs'
import {
  applyFactors,
  estimateCodecOf,
  emptyPhases,
  formatEstimateRange,
  formatEstimateValue,
  profileExport,
  totalSeconds,
  type ExportProfile,
  type PhaseSeconds
} from './estimate'

const SECOND = 1_000_000
const FPS = 30

function asset(id: string, overrides: Partial<Asset> = {}): Asset {
  return { id, kind: 'video', name: `${id}.mp4`, relPath: `${id}.mp4`, size: 1, duration: 60 * SECOND, width: 1920, height: 1080, fps: FPS, ...overrides }
}

function clip(id: string, assetId: string, srcIn: number, srcOut: number, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    track: 'video',
    assetId,
    srcIn,
    srcOut,
    start: 0,
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null,
    ...overrides
  }
}

function projectWith(assets: Asset[], clips: Clip[], extra: Partial<Project> = {}): Project {
  return { ...createProject('test'), assets, clips, ...extra }
}

function overlayBase(id: string, start: number, duration: number) {
  return { id, start, duration, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 }
}

function sticker(id: string, start = 0, duration = 10 * SECOND): StickerOverlay {
  return { ...overlayBase(id, start, duration), kind: 'sticker', size: 0.1, emoji: '*' }
}

function region(id: string, effect: 'blur' | 'pixelate', start = 0, duration = 10 * SECOND): RegionOverlay {
  return { ...overlayBase(id, start, duration), kind: 'region', shape: 'rect', effect, strength: 0.5, width: 0.4, height: 0.3 }
}

function media(id: string, assetId: string, start = 0, duration = 10 * SECOND, extra: Partial<MediaOverlay> = {}): MediaOverlay {
  return {
    ...overlayBase(id, start, duration),
    kind: 'media',
    assetId,
    width: 0.4,
    height: 0.3,
    radius: 0,
    border: 0,
    borderColor: '#ffffff',
    ...extra
  }
}

function text(id: string, start: number, duration: number): TextItem {
  return {
    id,
    start,
    duration,
    text: 'Hallo',
    style: { font: 'Inter', size: 0.05, color: '#ffffff', outline: null },
    pos: { x: 0.5, y: 0.5 },
    animIn: null,
    animOut: null
  }
}

/** Profile of a project at 1080p30 for a given length, with the default encoder (AVC). */
function profileOf(project: Project, durationMicros = 10 * SECOND, options: { kind?: 'mp4' | 'gif'; codec?: EstimateCodec; withWeights?: boolean; width?: number; height?: number; fps?: number } = {}): ExportProfile {
  return profileExport({
    project,
    planned: planTimeline(project),
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    fps: options.fps ?? FPS,
    durationMicros,
    kind: options.kind ?? 'mp4',
    codec: options.codec ?? 'avc',
    withWeights: options.withWeights
  })
}

const MP = 1_000_000
/** Megapixels of 1080p frames for the given number of frames. */
const mp1080 = (frames: number): number => (1920 * 1080 * frames) / MP

describe('profileExport: plain project', () => {
  const plain = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)])

  it('counts decoding of the source range at the asset rate and resolution', () => {
    const p = profileOf(plain)
    expect(p.phases.decode).toBeCloseTo(mp1080(FPS * 10) / DECODE_MP_PER_S, 9)
    expect(p.featureClass).toBe('plain')
  })

  it('counts encoding of every output frame, scaled by the codec factor', () => {
    const avc = profileOf(plain)
    const vp9 = profileOf(plain, 10 * SECOND, { codec: 'vp9' })
    expect(avc.phases.encode).toBeCloseTo(mp1080(FPS * 10) / ENCODE_MP_PER_S, 9)
    expect(vp9.phases.encode).toBeCloseTo(avc.phases.encode * CODEC_FACTOR.vp9, 9)
    expect(vp9.phases.decode).toBeCloseTo(avc.phases.decode, 9)
  })

  it('draws one picture pass plus the fit-blur background, and uploads each decoded frame', () => {
    const p = profileOf(plain)
    const draw = mp1080(FPS * 10) * BLUR_BACKGROUND_PASSES / DRAW_MP_PER_S
    const upload = mp1080(FPS * 10) / UPLOAD_MP_PER_S
    const overhead = FPS * 10 * 0.001
    expect(p.phases.draw).toBeCloseTo(draw + upload + overhead, 6)
  })

  it('has no blur background when the background is a colour', () => {
    const colour = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], { format: { ...createProject('x').format, background: { type: 'color', color: '#000000' } } })
    expect(profileOf(colour).phases.draw).toBeLessThan(profileOf(plain).phases.draw)
  })

  it('counts audio and the fixed start-up', () => {
    const p = profileOf(plain)
    expect(p.phases.audio).toBeCloseTo(10 * AUDIO_SECONDS_PER_SECOND, 9)
    expect(p.phases.fixed).toBeCloseTo(STARTUP_SECONDS, 9)
  })

  it('is start-up only for an empty project', () => {
    const p = profileOf(projectWith([], []), 0)
    expect(p.frames).toBe(0)
    expect(totalSeconds(p.phases)).toBeCloseTo(STARTUP_SECONDS, 9)
  })

  it('grows with the output size and the frame rate', () => {
    const base = totalSeconds(profileOf(plain).phases)
    expect(totalSeconds(profileOf(plain, 10 * SECOND, { width: 1280, height: 720 }).phases)).toBeLessThan(base)
    expect(totalSeconds(profileOf(plain, 10 * SECOND, { fps: 60 }).phases)).toBeGreaterThan(base)
  })

  it('counts a partial frame as a whole one, like the exporter', () => {
    const p = profileOf(plain, 1)
    expect(p.frames).toBe(1)
  })

  it('uses 1920x1080 at 30 fps when the asset has no size or rate', () => {
    const bare = projectWith([asset('a', { fps: undefined, width: undefined, height: undefined })], [clip('c', 'a', 0, 10 * SECOND)])
    expect(profileOf(bare).phases.decode).toBeCloseTo(mp1080(FPS * 10) / DECODE_MP_PER_S, 9)
  })
})

describe('profileExport: clips', () => {
  it('decodes the source range, so speed does not change the total decoding', () => {
    const normal = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)]), 10 * SECOND)
    const fast = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND, { speed: 2 })]), 5 * SECOND)
    expect(fast.phases.decode).toBeCloseTo(normal.phases.decode, 6)
  })

  it('a slow clip decodes the same source frames over a longer time', () => {
    const slow = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 5 * SECOND, { speed: 0.5 })]), 10 * SECOND)
    const normal = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 5 * SECOND)]), 5 * SECOND)
    expect(slow.phases.decode).toBeCloseTo(normal.phases.decode, 6)
  })

  it('uses the source resolution: 4K costs four times 1080p for the same range', () => {
    const hd = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)]))
    const uhd = profileOf(projectWith([asset('a', { width: 3840, height: 2160 })], [clip('c', 'a', 0, 10 * SECOND)]))
    expect(uhd.phases.decode).toBeCloseTo(4 * hd.phases.decode, 6)
  })

  it('counts each clip, so one asset used twice is decoded twice', () => {
    const once = profileOf(projectWith([asset('a')], [clip('c1', 'a', 0, 5 * SECOND)]), 5 * SECOND)
    const twice = profileOf(projectWith([asset('a')], [clip('c1', 'a', 0, 5 * SECOND), clip('c2', 'a', 0, 5 * SECOND, { start: 5 * SECOND })]), 10 * SECOND)
    expect(twice.phases.decode).toBeCloseTo(2 * once.phases.decode, 6)
  })

  it('decodes an image once per clip, however long the clip is', () => {
    const img = asset('i', { kind: 'image', duration: 0, width: 1000, height: 500, fps: undefined })
    const short = profileOf(projectWith([img], [clip('c', 'i', 0, 1 * SECOND)]), 1 * SECOND)
    const long = profileOf(projectWith([img], [clip('c', 'i', 0, 120 * SECOND)]), 120 * SECOND)
    expect(short.phases.decode).toBeCloseTo((1000 * 500) / MP / DECODE_MP_PER_S, 9)
    expect(long.phases.decode).toBeCloseTo(short.phases.decode, 9)
  })

  it('a still frame decodes once', () => {
    const still = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND, { still: 2 * SECOND })]), 10 * SECOND)
    expect(still.phases.decode).toBeCloseTo((1920 * 1080) / MP / DECODE_MP_PER_S, 9)
  })

  it('ignores audio assets', () => {
    const p = profileOf(projectWith([asset('m', { kind: 'audio', width: undefined, height: undefined, fps: undefined })], [clip('c', 'm', 0, 10 * SECOND)]))
    expect(p.phases.decode).toBe(0)
  })

  it('a filter adds a grade pass to the picture', () => {
    const filter = FILTERS.find((f) => clipGrade(clip('x', 'a', 0, SECOND, { filter: f.id })) !== null)!.id
    const plain = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)]))
    const graded = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND, { filter })]))
    expect(graded.phases.draw).toBeGreaterThan(plain.phases.draw)
  })
})

describe('profileExport: transitions', () => {
  it('two clips on screen during a transition: both decode, and the blend adds a pass', () => {
    const cuts = projectWith(
      [asset('a')],
      [clip('c1', 'a', 0, 5 * SECOND), clip('c2', 'a', 5 * SECOND, 10 * SECOND, { start: 5 * SECOND })]
    )
    const withTransition = projectWith(
      [asset('a')],
      [clip('c1', 'a', 0, 5 * SECOND), clip('c2', 'a', 5 * SECOND, 10 * SECOND, { start: 5 * SECOND, transitionIn: { type: 'fade', duration: SECOND } })]
    )
    const planned = planTimeline(withTransition)
    expect(planned.transitions.length).toBeGreaterThan(0)
    const plain = profileOf(cuts)
    const blend = profileOf(withTransition)
    expect(blend.phases.decode).toBeGreaterThan(plain.phases.decode)
    expect(blend.phases.draw).toBeGreaterThan(plain.phases.draw)
  })
})

describe('profileExport: overlays and texts', () => {
  const base = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)])
  const plainTotal = totalSeconds(profileOf(base).phases)

  it('each text adds drawing and a one-time raster', () => {
    const withText = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], { texts: [text('t', 0, 10 * SECOND)] }))
    expect(totalSeconds(withText.phases)).toBeGreaterThan(plainTotal)
    expect(withText.phases.draw).toBeGreaterThan(profileOf(base).phases.draw)
  })

  it('a region costs full-frame passes while it is on screen; blur costs more than pixelate', () => {
    const none = profileOf(base).phases.draw
    const pix = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [region('r', 'pixelate')] })).phases.draw
    const blur = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [region('r', 'blur')] })).phases.draw
    expect(pix).toBeGreaterThan(none)
    expect(blur).toBeGreaterThan(pix)
  })

  it('a region only costs while it is on screen', () => {
    const short = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [region('r', 'pixelate', 0, 2 * SECOND)] })).phases.draw
    const long = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [region('r', 'pixelate', 0, 10 * SECOND)] })).phases.draw
    expect(long - profileOf(base).phases.draw).toBeGreaterThan(short - profileOf(base).phases.draw)
  })

  it('each sticker adds a raster and a draw call per frame: more stickers cost more', () => {
    const three = profileOf(projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [sticker('s1'), sticker('s2'), sticker('s3')] }))
    const six = profileOf(
      projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)], {
        overlays: [sticker('s1'), sticker('s2'), sticker('s3'), sticker('s4'), sticker('s5'), sticker('s6')]
      })
    )
    expect(six.phases.draw).toBeGreaterThan(three.phases.draw)
    expect(three.featureClass).toBe('plain')
  })

  it('a picture-in-picture video decodes and uploads its own source, and makes the class video', () => {
    const pip = profileOf(
      projectWith([asset('a'), asset('v', { width: 1280, height: 720 })], [clip('c', 'a', 0, 10 * SECOND)], {
        overlays: [media('m', 'v', 0, 10 * SECOND)]
      })
    )
    const extraDecode = (1280 * 720 * FPS * 10) / MP / DECODE_MP_PER_S
    expect(pip.phases.decode - profileOf(base).phases.decode).toBeCloseTo(extraDecode, 6)
    expect(pip.phases.draw).toBeGreaterThan(profileOf(base).phases.draw)
    expect(pip.featureClass).toBe('video')
  })

  it('a picture that plays out holds its last frame: no decoding after the source ends', () => {
    const overlayLong = profileOf(
      projectWith([asset('a'), asset('v', { duration: 4 * SECOND })], [clip('c', 'a', 0, 10 * SECOND)], {
        overlays: [media('m', 'v', 0, 10 * SECOND)]
      })
    )
    const overlayShort = profileOf(
      projectWith([asset('a'), asset('v', { duration: 4 * SECOND })], [clip('c', 'a', 0, 10 * SECOND)], {
        overlays: [media('m', 'v', 0, 4 * SECOND)]
      })
    )
    expect(overlayLong.phases.decode).toBeCloseTo(overlayShort.phases.decode, 6)
  })

  it('a faster picture reads more source in the same time on screen', () => {
    const baseDecode = profileOf(base).phases.decode
    const normal = profileOf(
      projectWith([asset('a'), asset('v')], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [media('m', 'v', 0, 5 * SECOND)] })
    ).phases.decode - baseDecode
    const fast = profileOf(
      projectWith([asset('a'), asset('v')], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [media('m', 'v', 0, 5 * SECOND, { speed: 2 })] })
    ).phases.decode - baseDecode
    // The normal picture reads 5 s of source in the 5 s on screen, the double-speed one 10 s.
    expect(fast).toBeCloseTo(2 * normal, 6)
  })

  it('a picture overlay of an image decodes once and does not make the class video', () => {
    const img = profileOf(
      projectWith([asset('a'), asset('i', { kind: 'image', duration: 0, width: 800, height: 600, fps: undefined })], [clip('c', 'a', 0, 10 * SECOND)], {
        overlays: [media('m', 'i', 0, 10 * SECOND)]
      })
    )
    expect(img.featureClass).toBe('plain')
    expect(img.phases.decode - profileOf(base).phases.decode).toBeCloseTo((800 * 600) / MP / DECODE_MP_PER_S, 9)
  })

  it('the video overlay uploads one frame per source frame, up to the export rate', () => {
    const v15 = profileOf(
      projectWith([asset('a'), asset('v', { fps: 15 })], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [media('m', 'v', 0, 10 * SECOND)] })
    )
    const v30 = profileOf(
      projectWith([asset('a'), asset('v', { fps: 30 })], [clip('c', 'a', 0, 10 * SECOND)], { overlays: [media('m', 'v', 0, 10 * SECOND)] })
    )
    // 15 extra uploads per second for 10 seconds of 1080p frames.
    expect(v30.phases.draw - v15.phases.draw).toBeCloseTo((1920 * 1080 * 15 * 10) / MP / UPLOAD_MP_PER_S, 9)
  })
})

describe('profileExport: GIF', () => {
  const plain = projectWith([asset('a')], [clip('c', 'a', 0, 10 * SECOND)])

  it('reads frames back and quantises them instead of encoding video, without audio', () => {
    const gif = profileOf(plain, 10 * SECOND, { kind: 'gif', width: 480, height: 270, fps: 15 })
    const frames = 150
    const pixels = 480 * 270
    expect(gif.phases.encode).toBeCloseTo((pixels * frames) / MP / GIF_ENCODE_MP_PER_S, 6)
    expect(gif.phases.draw).toBeGreaterThan((pixels * frames) / MP / GIF_READBACK_MP_PER_S)
    expect(gif.phases.audio).toBe(0)
  })

  it('a GIF at a smaller width is faster', () => {
    const small = totalSeconds(profileOf(plain, 10 * SECOND, { kind: 'gif', width: 320, height: 180, fps: 15 }).phases)
    const large = totalSeconds(profileOf(plain, 10 * SECOND, { kind: 'gif', width: 640, height: 360, fps: 15 }).phases)
    expect(small).toBeLessThan(large)
  })
})

describe('profileExport: per-frame weights', () => {
  const project = projectWith(
    [asset('a'), asset('v')],
    [clip('c', 'a', 0, 10 * SECOND)],
    { overlays: [media('m', 'v', 5 * SECOND, 5 * SECOND)] }
  )

  it('the weights of all frames add up to the phase total', () => {
    const p = profileOf(project, 10 * SECOND, { withWeights: true })
    expect(p.frameWeights).not.toBeNull()
    const sum = Array.from(p.frameWeights!).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(totalSeconds(p.phases), 6)
  })

  it('frames with a video picture weigh more than the plain frames before it', () => {
    const p = profileOf(project, 10 * SECOND, { withWeights: true })
    const weights = p.frameWeights!
    const early = weights[10]!
    const late = weights[FPS * 8]!
    expect(late).toBeGreaterThan(early)
  })

  it('is not computed unless asked for', () => {
    expect(profileOf(project).frameWeights).toBeNull()
  })
})

describe('applyFactors', () => {
  const phases: PhaseSeconds = { decode: 2, draw: 3, encode: 5, audio: 1, fixed: 2 }

  it('multiplies decode, draw and encode by their own factors, and audio and fixed with encode', () => {
    expect(applyFactors(phases, { decode: 2, draw: 0.5, encode: 3 })).toEqual({ decode: 4, draw: 1.5, encode: 15, audio: 3, fixed: 6 })
  })

  it('with factors 1 nothing changes', () => {
    expect(applyFactors(phases, { decode: 1, draw: 1, encode: 1 })).toEqual(phases)
  })
})

describe('codec family', () => {
  it('VP9 and AV1 are the software family; anything else is AVC', () => {
    expect(estimateCodecOf('vp9')).toBe('vp9')
    expect(estimateCodecOf('av1')).toBe('av1')
    expect(estimateCodecOf('avc')).toBe('avc')
    expect(estimateCodecOf(null)).toBe('avc')
    expect(estimateCodecOf(undefined)).toBe('avc')
  })
})

describe('formatEstimateRange', () => {
  it('rounds outwards to the step of its unit', () => {
    expect(formatEstimateRange(8, 12)).toEqual({ unit: 'seconds', low: 5, high: 15 })
    expect(formatEstimateRange(33, 75)).toEqual({ unit: 'minutes', low: 0.5, high: 1.5 })
    expect(formatEstimateRange(700, 800)).toEqual({ unit: 'minutes', low: 11, high: 14 })
    expect(formatEstimateRange(4000, 5000)).toEqual({ unit: 'hours', low: 1, high: 1.5 })
  })

  it('gives a single value when both ends fall into one step', () => {
    const r = formatEstimateRange(5, 5)
    expect(r.low).toBe(5)
    expect(r.high).toBe(5)
  })

  it('always contains the input range', () => {
    // Below the smallest step (5 s) the low end is the step itself, so the check starts above it.
    for (let s = 10; s < 8000; s += 37) {
      const r = formatEstimateRange(s * 0.8, s * 1.25)
      const scale = r.unit === 'seconds' ? 1 : r.unit === 'minutes' ? 60 : 3600
      expect(r.low * scale).toBeLessThanOrEqual(s * 0.8 + 1e-6)
      expect(r.high * scale).toBeGreaterThanOrEqual(s * 1.25 - 1e-6)
    }
  })

  it('treats nonsense as zero, with the smallest step', () => {
    expect(formatEstimateRange(Number.NaN, -3)).toEqual({ unit: 'seconds', low: 5, high: 5 })
  })
})

describe('formatEstimateValue', () => {
  it('rounds to the nearest step', () => {
    expect(formatEstimateValue(42)).toEqual({ unit: 'seconds', low: 40, high: 40 })
    expect(formatEstimateValue(80)).toEqual({ unit: 'minutes', low: 1.5, high: 1.5 })
    expect(formatEstimateValue(0)).toEqual({ unit: 'seconds', low: 5, high: 5 })
  })
})

describe('emptyPhases', () => {
  it('starts at zero for every phase', () => {
    expect(totalSeconds(emptyPhases())).toBe(0)
  })
})
