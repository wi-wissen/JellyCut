import { describe, expect, it } from 'vitest'
import { allMessages } from '../../ui/i18n'
import { ANIMATED_STICKERS, DEFAULT_ANIMATED_LOOPS, animatedFrameIndex, animatedSticker, itemLoopMicros, loopCount, sheetCell } from './stickerAnimations'
import { STICKER_IMAGES } from './stickerImages'
import type { OverlayItem } from '../project/types'

type Messages = { [key: string]: Messages | string }
const lookup = (node: Messages, path: string): unknown => path.split('.').reduce<unknown>((n, k) => (n as Messages | undefined)?.[k], node)
const sheetFiles = Object.keys(import.meta.glob('../../assets/stickers-animated/*.webp')).map((p) => p.replace(/^.*\//, ''))
const stillFiles = new Set(Object.keys(import.meta.glob('../../assets/stickers/*.webp')).map((p) => p.replace(/^.*\/(.+)\.webp$/, '$1')))

describe('animatedFrameIndex', () => {
  const LOOP = 3_000_000
  it('starts at the first cell and advances in equal steps through the loop', () => {
    expect(animatedFrameIndex(0, LOOP, 30)).toBe(0)
    expect(animatedFrameIndex(99_999, LOOP, 30)).toBe(0)
    expect(animatedFrameIndex(100_000, LOOP, 30)).toBe(1)
    expect(animatedFrameIndex(1_500_000, LOOP, 30)).toBe(15)
    expect(animatedFrameIndex(LOOP - 1, LOOP, 30)).toBe(29)
  })

  it('wraps at every whole loop, so the picture at t and t + loop is the same cell', () => {
    for (const t of [0, 1, 123_456, 2_999_999]) {
      expect(animatedFrameIndex(t + LOOP, LOOP, 30)).toBe(animatedFrameIndex(t, LOOP, 30))
      expect(animatedFrameIndex(t + 3 * LOOP, LOOP, 30)).toBe(animatedFrameIndex(t, LOOP, 30))
    }
  })

  it('never leaves the sheet and tolerates odd input', () => {
    expect(animatedFrameIndex(-1, LOOP, 30)).toBe(29)
    expect(animatedFrameIndex(5, 0, 30)).toBe(0)
    expect(animatedFrameIndex(5, LOOP, 0)).toBe(0)
    for (let t = 0; t < 2 * LOOP; t += 7_777) {
      const index = animatedFrameIndex(t, LOOP, 37)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(37)
    }
  })

  it('maps a cell to its column and row', () => {
    expect(sheetCell({ cols: 7 }, 0)).toEqual({ col: 0, row: 0 })
    expect(sheetCell({ cols: 7 }, 8)).toEqual({ col: 1, row: 1 })
    expect(sheetCell({ cols: 7 }, 47)).toEqual({ col: 5, row: 6 })
  })
})

describe('animated sticker catalogue', () => {
  it('has a sheet file for every entry and no file without an entry', () => {
    expect(sheetFiles.sort()).toEqual(ANIMATED_STICKERS.map((s) => s.sheet).sort())
    for (const s of ANIMATED_STICKERS) expect(s.sheet, s.id).toBe(`sticker-anim-${s.id}.webp`)
  })

  it('belongs to picture stickers: every animated id has a still picture as fallback', () => {
    const known = new Set(STICKER_IMAGES.map((s) => s.id))
    for (const s of ANIMATED_STICKERS) {
      expect(known.has(s.id), `${s.id} is in the sticker catalogue`).toBe(true)
      expect(stillFiles.has(s.id), `${s.id} has a still file`).toBe(true)
    }
    expect(new Set(ANIMATED_STICKERS.map((s) => s.id)).size).toBe(ANIMATED_STICKERS.length)
  })

  it('has labels in German and English for every animated sticker', () => {
    const all = allMessages()
    for (const locale of ['de', 'en'] as const) {
      for (const s of ANIMATED_STICKERS) {
        const value = lookup(all[locale] as Messages, `stickers.image.${s.id}`)
        expect(typeof value === 'string' && value.trim().length > 0, `${locale} ${s.id}`).toBe(true)
      }
    }
  })

  it('describes each sheet consistently: whole microseconds, at most 48 cells, a grid that holds them', () => {
    for (const s of ANIMATED_STICKERS) {
      expect(Number.isInteger(s.loopMicros) && s.loopMicros > 0, `${s.id} loop`).toBe(true)
      expect(s.loopMicros % s.frames, `${s.id} loop = frames * frame length`).toBe(0)
      expect(s.frames, s.id).toBeGreaterThanOrEqual(2)
      expect(s.frames, s.id).toBeLessThanOrEqual(48)
      expect(s.cols * s.rows, s.id).toBeGreaterThanOrEqual(s.frames)
      expect((s.cols - 1) * s.rows, `${s.id} no empty column`).toBeLessThan(s.frames)
      expect(s.loopMicros, `${s.id} loop is short enough to show motion`).toBeLessThan(5_000_000)
      expect(s.loopMicros, s.id).toBeGreaterThan(900_000)
    }
  })

  it('keeps the sheets inside the size budget: 6 MB in total, about 100 kB each', () => {
    const total = ANIMATED_STICKERS.reduce((sum, s) => sum + s.bytes, 0)
    expect(total).toBeLessThanOrEqual(6_000_000)
    for (const s of ANIMATED_STICKERS) expect(s.bytes, s.id).toBeLessThan(300_000)
  })

  it('is ordered by popularity and only takes emoji from the top of the Unicode frequency list', () => {
    const ranks = ANIMATED_STICKERS.map((s) => s.rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(ANIMATED_STICKERS.length).toBeGreaterThanOrEqual(55)
    expect(Math.max(...ranks)).toBeLessThanOrEqual(120)
  })

  it('looks animations up by id and gives loop data only to animated stickers', () => {
    expect(animatedSticker('heart')).not.toBeNull()
    expect(animatedSticker('fox')).toBeNull()
    expect(animatedSticker(undefined)).toBeNull()
    const base = { id: 'x', start: 0, duration: 1, pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 }
    const sticker = (extra: object) => ({ ...base, kind: 'sticker', size: 0.1, ...extra }) as OverlayItem
    expect(itemLoopMicros(sticker({ imageId: 'heart', animated: true }))).toBe(animatedSticker('heart')!.loopMicros)
    expect(itemLoopMicros(sticker({ imageId: 'heart' }))).toBeUndefined()
    expect(itemLoopMicros(sticker({ imageId: 'fox', animated: true }))).toBeUndefined()
    expect(itemLoopMicros(sticker({ emoji: '⭐' }))).toBeUndefined()
  })

  it('counts loops and starts with three', () => {
    expect(DEFAULT_ANIMATED_LOOPS).toBe(3)
    expect(loopCount(3_000_000, 1_000_000)).toBe(3)
    expect(loopCount(10, 1_000_000)).toBe(1)
  })
})
