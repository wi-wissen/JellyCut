import { describe, expect, it } from 'vitest'
import { allMessages } from '../../ui/i18n'
import { BASIC_STICKER_IDS } from '../timeline/overlayCatalog'
import { STICKER_IMAGES, STICKER_IMAGE_CATEGORIES, isStickerImageId } from './stickerImages'

type Messages = { [key: string]: Messages | string }
const files = Object.keys(import.meta.glob('../../assets/stickers/*.webp')).map((p) => p.replace(/^.*\/(.+)\.webp$/, '$1'))
const lookup = (node: Messages, path: string): unknown => path.split('.').reduce<unknown>((n, k) => (n as Messages | undefined)?.[k], node)

describe('picture sticker catalog', () => {
  it('has unique ids, a known category for each and some stickers in every category', () => {
    expect(new Set(STICKER_IMAGES.map((s) => s.id)).size).toBe(STICKER_IMAGES.length)
    for (const category of STICKER_IMAGE_CATEGORIES) expect(STICKER_IMAGES.some((s) => s.category === category), category).toBe(true)
    for (const s of STICKER_IMAGES) expect(STICKER_IMAGE_CATEGORIES, s.id).toContain(s.category)
    expect(STICKER_IMAGES.length).toBeGreaterThanOrEqual(60)
  })

  it('has a vendored file for every id and no file without an id', () => {
    expect(files.sort()).toEqual(STICKER_IMAGES.map((s) => s.id).sort())
  })

  it('has a German and an English label for every sticker, category and basic shape', () => {
    const all = allMessages()
    for (const locale of ['de', 'en'] as const) {
      const keys = [
        ...STICKER_IMAGES.map((s) => `stickers.image.${s.id}`),
        ...STICKER_IMAGE_CATEGORIES.map((c) => `stickers.categories.${c}`),
        'stickers.categories.basics',
        ...BASIC_STICKER_IDS.map((id) => `overlays3.sticker.${id}`)
      ]
      for (const key of keys) {
        const value = lookup(all[locale] as Messages, key)
        expect(typeof value === 'string' && value.trim().length > 0, `${locale} ${key}`).toBe(true)
      }
    }
  })

  it('recognises ids and nothing else', () => {
    expect(isStickerImageId('heart')).toBe(true)
    expect(isStickerImageId('nope')).toBe(false)
    expect(isStickerImageId(3)).toBe(false)
  })
})
