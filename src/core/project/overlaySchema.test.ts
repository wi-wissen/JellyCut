import { describe, expect, it } from 'vitest'
import { createProject, migrateProject, validateProject } from './schema'
import type { Project } from './types'

const item = {
  id: 'overlay-1',
  kind: 'sticker',
  start: 0,
  duration: 1_000_000,
  pos: { x: 0.5, y: 0.5 },
  scale: 1,
  rotation: 0,
  emoji: '⭐',
  size: 0.12
}

function withOverlays(overlays: unknown[]): unknown {
  return { ...createProject('o'), overlays }
}

function errorsFor(overlays: unknown[]): string[] {
  const result = validateProject(withOverlays(overlays))
  return result.ok ? [] : result.errors
}

describe('overlay schema', () => {
  it('accepts a valid sticker, shape and stroke', () => {
    const shape = { ...item, id: 'overlay-2', kind: 'shape', shape: 'arrow', width: 0.3, height: 0.2, lineWidth: 0.008, color: '#ff5ca8' }
    const stroke = { ...item, id: 'overlay-3', kind: 'stroke', points: [[-0.1, 0], [0.1, 0.05]], lineWidth: 0.008, color: '#00ff00' }
    expect(errorsFor([item, shape, stroke])).toEqual([])
  })

  it('reports the path of each broken field', () => {
    const errors = errorsFor([{ ...item, kind: 'hologram', duration: 0 }])
    expect(errors).toContain('overlays[0].kind must be one of sticker, shape, stroke, region, media')
    expect(errors).toContain('overlays[0].duration must be a positive integer (microseconds)')
  })

  it('checks the fields of each kind', () => {
    expect(errorsFor([{ ...item, emoji: '' }])).toContain('overlays[0].emoji must be a string of 1 to 16 characters')
    expect(errorsFor([{ ...item, size: -1 }])).toContain('overlays[0].size must be a positive number')
    const shape = { ...item, id: 'o2', kind: 'shape', shape: 'star', width: 1, height: 1, lineWidth: 0.01, color: 'red' }
    const errors = errorsFor([shape])
    expect(errors).toContain('overlays[0].shape must be one of rect, ellipse, arrow')
    expect(errors).toContain('overlays[0].color must be #RRGGBB')
    const stroke = { ...item, id: 'o3', kind: 'stroke', points: [[0, 0]], lineWidth: 0.01, color: '#000000' }
    expect(errorsFor([stroke])).toContain('overlays[0].points must be a list of at least two [x, y] pairs')
    const badPoint = { ...stroke, points: [[0, 0], [1, Number.NaN]] }
    expect(errorsFor([badPoint])).toContain('overlays[0].points[1] must be a [x, y] pair of finite numbers')
  })

  it('accepts region and picture-in-picture items', () => {
    const region = { ...item, id: 'r', kind: 'region', shape: 'ellipse', effect: 'pixelate', strength: 0.5, width: 0.3, height: 0.2 }
    const media = { ...item, id: 'm', kind: 'media', assetId: 'clip-a', width: 0.5, height: 0.3, radius: 0.02, border: 0.004, borderColor: '#ffffff' }
    expect(errorsFor([region, media])).toEqual([])
  })

  it('checks the fields of regions and pictures', () => {
    const region = { ...item, id: 'r', kind: 'region', shape: 'arrow', effect: 'wobble', strength: 2, width: 0.3, height: 0.2 }
    const errors = errorsFor([region])
    expect(errors).toContain('overlays[0].shape must be one of rect, ellipse')
    expect(errors).toContain('overlays[0].effect must be one of blur, pixelate')
    expect(errors).toContain('overlays[0].strength must be a number from 0 to 1')
    const media = { ...item, id: 'm', kind: 'media', assetId: '', width: 0.5, height: 0.3, radius: -1, border: 0, borderColor: 'white' }
    const mediaErrors = errorsFor([media])
    expect(mediaErrors).toContain('overlays[0].assetId must be the id of an asset')
    expect(mediaErrors).toContain('overlays[0].radius must be a number of 0 or more')
    expect(mediaErrors).toContain('overlays[0].borderColor must be #RRGGBB')
  })

  it('checks opacity, entrance / exit animations and the loop of every kind', () => {
    expect(errorsFor([{ ...item, opacity: 0.5, animIn: 'pop', animOut: null, loop: 'wiggle' }])).toEqual([])
    expect(errorsFor([{ ...item, opacity: 1.5 }])).toContain('overlays[0].opacity must be a number from 0 to 1')
    expect(errorsFor([{ ...item, animIn: 'spin' }])).toContain('overlays[0].animIn must be one of fade, pop, slideUp')
    expect(errorsFor([{ ...item, animOut: 'slideDown' }])).toContain('overlays[0].animOut must be one of fade, pop, slideUp')
    expect(errorsFor([{ ...item, loop: 'bounce' }])).toContain('overlays[0].loop must be one of wiggle')
  })

  it('refuses duplicate overlay ids', () => {
    expect(errorsFor([item, { ...item }])).toContain('overlays[1].id duplicates id "overlay-1"')
  })

  it('migrates a version 0 file without overlays to empty overlays', () => {
    const legacy: Record<string, unknown> = { ...createProject('legacy') }
    delete legacy.version
    delete legacy.overlays
    const result = migrateProject(legacy)
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.project as Project).overlays).toEqual([])
  })
})
