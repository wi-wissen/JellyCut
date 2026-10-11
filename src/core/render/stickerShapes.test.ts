import { describe, expect, it } from 'vitest'
import { STICKER_SHAPES, STICKER_SHAPE_IDS, stickerShape } from './stickerShapes'

describe('vector sticker set', () => {
  it('has about two dozen shapes with unique ids', () => {
    expect(STICKER_SHAPES.length).toBeGreaterThanOrEqual(24)
    expect(new Set(STICKER_SHAPE_IDS).size).toBe(STICKER_SHAPES.length)
  })

  it('contains the requested basics, arrows, speech and thought bubbles and badges 1-3', () => {
    for (const id of ['star', 'heart', 'check', 'cross', 'arrowRight', 'arrowUp', 'speech', 'thought', 'exclamation', 'question', 'lightbulb', 'thumbsUp', 'smile', 'sun', 'cloud', 'lightning', 'flag', 'music', 'camera', 'play', 'crown', 'sparkles', 'badge1', 'badge2', 'badge3']) {
      expect(stickerShape(id), id).not.toBeNull()
    }
  })

  it('has path data that starts with a moveto, and only fills or lines use cut-outs', () => {
    for (const shape of STICKER_SHAPES) {
      expect(shape.d.startsWith('M'), shape.id).toBe(true)
      expect(shape.d).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s-]/)
      if (shape.cut) expect(shape.kind, shape.id).toBe('fill')
    }
  })

  it('returns null for unknown ids, so an emoji name is never mistaken for a shape', () => {
    expect(stickerShape('star-emoji')).toBeNull()
    expect(stickerShape('⭐')).toBeNull()
  })
})
