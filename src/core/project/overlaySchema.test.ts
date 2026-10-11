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
    expect(errors).toContain('overlays[0].kind must be one of sticker, shape, stroke')
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
