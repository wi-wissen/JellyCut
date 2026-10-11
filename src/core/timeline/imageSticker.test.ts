import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import { addImageSticker, updateOverlay } from './overlayOps'

const S = 1_000_000

describe('picture stickers', () => {
  it('adds a sticker with an image id and refuses unknown or reused ids', () => {
    const p = addImageSticker(createProject('s'), 's1', 2 * S, 'heart', { x: 0.25, y: 0.75 })
    expect(p.overlays[0]).toMatchObject({ kind: 'sticker', imageId: 'heart', start: 2 * S, pos: { x: 0.25, y: 0.75 } })
    expect(p.overlays[0]).not.toHaveProperty('emoji')
    expect(p.overlays[0]).not.toHaveProperty('shape')
    expect(validateProject(p).ok).toBe(true)
    expect(addImageSticker(p, 's1', 0, 'star')).toBe(p)
    const empty = createProject('s')
    expect(addImageSticker(empty, 's2', 0, 'nope')).toEqual(empty)
  })

  it('moves and scales like any sticker but has no colour, outline or shape', () => {
    const p = addImageSticker(createProject('s'), 's1', 0, 'cool')
    expect(updateOverlay(p, 's1', { size: 0.3, rotation: 20, opacity: 0.5 }).overlays[0]).toMatchObject({ size: 0.3, rotation: 20, opacity: 0.5 })
    expect(updateOverlay(p, 's1', { color: '#ff0000' })).toBe(p)
    expect(updateOverlay(p, 's1', { outline: '#000000' })).toBe(p)
    expect(updateOverlay(p, 's1', { shape: 'star' })).toBe(p)
  })

  it('validates the field strictly and keeps old sticker kinds valid', () => {
    const base = addImageSticker(createProject('s'), 's1', 0, 'heart')
    const withItem = (patch: Record<string, unknown>) => ({ ...base, overlays: [{ ...base.overlays[0]!, ...patch }] })
    expect(validateProject(withItem({ imageId: 'nope' })).ok).toBe(false)
    expect(validateProject(withItem({ imageId: 3 })).ok).toBe(false)
    expect(validateProject(withItem({ emoji: '⭐' })).ok).toBe(false)
    const legacy = { ...base, overlays: [{ ...base.overlays[0]!, imageId: undefined, emoji: '⭐' }] }
    expect(validateProject(legacy).ok).toBe(true)
    const vector = { ...base, overlays: [{ ...base.overlays[0]!, imageId: undefined, shape: 'star', color: '#ff0000' }] }
    expect(validateProject(vector).ok).toBe(true)
  })
})
