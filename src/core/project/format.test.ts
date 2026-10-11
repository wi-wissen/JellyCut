import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from './schema'
import { formatForRatio, setAllFit, setBackground, setRatio } from './format'
import type { Clip, Project } from './types'

function clip(id: string, fit: 'fit' | 'fill' = 'fit'): Clip {
  return {
    id,
    track: 'video',
    assetId: 'a',
    srcIn: 0,
    srcOut: 1_000_000,
    start: 0,
    speed: 1,
    transform: { fit, scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null
  }
}

function fixture(): Project {
  const p = createProject('F')
  const asset = { id: 'a', kind: 'video' as const, name: 'a.mp4', relPath: 'media/a.mp4', size: 1, duration: 1_000_000, width: 1920, height: 1080, fps: 30 }
  return { ...p, assets: [asset], clips: [clip('c1'), clip('c2', 'fill')] }
}

describe('formatForRatio', () => {
  it('uses 1080 on the short side for every ratio', () => {
    expect(formatForRatio('16:9')).toEqual({ ratio: '16:9', width: 1920, height: 1080 })
    expect(formatForRatio('9:16')).toEqual({ ratio: '9:16', width: 1080, height: 1920 })
    expect(formatForRatio('1:1')).toEqual({ ratio: '1:1', width: 1080, height: 1080 })
    expect(formatForRatio('4:5')).toEqual({ ratio: '4:5', width: 1080, height: 1350 })
  })
})

describe('setRatio', () => {
  it('changes ratio and size and keeps fps and background', () => {
    const p = { ...fixture(), format: { ...fixture().format, background: { type: 'color' as const, color: '#112233' } } }
    const next = setRatio(p, '9:16')
    expect(next.format).toEqual({ ratio: '9:16', width: 1080, height: 1920, fps: 30, background: { type: 'color', color: '#112233' } })
    expect(validateProject(next).ok).toBe(true)
  })

  it('returns the same project when the ratio is already set', () => {
    const p = fixture()
    expect(setRatio(p, '16:9')).toBe(p)
  })

  it('refuses unknown ratios', () => {
    const p = fixture()
    expect(setRatio(p, '3:2' as never)).toBe(p)
  })
})

describe('setBackground', () => {
  it('sets a colour, lower-cased and validated', () => {
    const next = setBackground(fixture(), { type: 'color', color: '#FFAA00' })
    expect(next.format.background).toEqual({ type: 'color', color: '#ffaa00' })
    expect(validateProject(next).ok).toBe(true)
  })

  it('switches back to blur', () => {
    const colour = setBackground(fixture(), { type: 'color', color: '#000000' })
    expect(setBackground(colour, { type: 'blur' }).format.background).toEqual({ type: 'blur' })
  })

  it('returns the same project when nothing changes', () => {
    const p = fixture()
    expect(setBackground(p, { type: 'blur' })).toBe(p)
    const colour = setBackground(p, { type: 'color', color: '#abcdef' })
    expect(setBackground(colour, { type: 'color', color: '#ABCDEF' })).toBe(colour)
  })

  it('rejects colours that are not #RRGGBB', () => {
    const p = fixture()
    for (const color of ['red', '#fff', '#12345', '#GGGGGG', '123456', '#1234567']) {
      expect(setBackground(p, { type: 'color', color })).toBe(p)
    }
  })
})

describe('setAllFit', () => {
  it('sets every clip to the same mode and keeps the other transform fields', () => {
    const next = setAllFit(fixture(), 'fill')
    expect(next.clips.map((c) => c.transform.fit)).toEqual(['fill', 'fill'])
    expect(next.clips[0]!.transform).toEqual({ fit: 'fill', scale: 1, x: 0, y: 0, rotation: 0, flipX: false })
    expect(validateProject(next).ok).toBe(true)
  })

  it('returns the same project when every clip already has the mode, and for an empty project', () => {
    const p = fixture()
    expect(setAllFit(p, 'fit')).not.toBe(p)
    expect(setAllFit(setAllFit(p, 'fill'), 'fill')).toEqual(setAllFit(p, 'fill'))
    const done = setAllFit(p, 'fill')
    expect(setAllFit(done, 'fill')).toBe(done)
    expect(setAllFit({ ...p, clips: [] }, 'fill').clips).toEqual([])
  })

  it('refuses an unknown mode', () => {
    const p = fixture()
    expect(setAllFit(p, 'stretch' as never)).toBe(p)
  })
})
