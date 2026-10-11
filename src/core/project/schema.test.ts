import { describe, expect, it } from 'vitest'
import {
  CURRENT_VERSION,
  createProject,
  migrateProject,
  parseProjectJson,
  serializeProject,
  validateProject
} from './schema'
import type { Project } from './types'

function sample(): Project {
  const p = createProject('Summer trip')
  p.assets.push({ id: 'a1', kind: 'video', name: 'Beach.mp4', relPath: 'media/Beach.mp4', size: 10, duration: 16_000_000, width: 1920, height: 1080, fps: 30 })
  p.clips.push({
    id: 'c1', track: 'video', assetId: 'a1', srcIn: 0, srcOut: 5_000_000, start: 0, speed: 1,
    transform: { fit: 'fill', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1, muted: false, filter: null, transitionIn: null
  })
  return p
}

describe('createProject', () => {
  it('creates an empty 16:9 1080p30 project at the current version', () => {
    const p = createProject('X')
    expect(p.version).toBe(CURRENT_VERSION)
    expect(p.name).toBe('X')
    expect(p.format).toEqual({ ratio: '16:9', width: 1920, height: 1080, fps: 30, background: { type: 'blur' } })
    expect([p.assets, p.clips, p.texts, p.overlays, p.stickers, p.drawings, p.music].every((l) => l.length === 0)).toBe(true)
  })
  it('returns independent objects on every call', () => {
    const a = createProject('A')
    const b = createProject('B')
    a.assets.push(sample().assets[0]!)
    expect(b.assets).toHaveLength(0)
    expect(a.format).not.toBe(b.format)
  })
  it('output validates', () => {
    expect(validateProject(createProject('X')).ok).toBe(true)
  })
})

describe('validateProject', () => {
  it('accepts the project-wide fit when it is fit or fill, and when it is absent', () => {
    expect(validateProject(mutate((p) => (p.format.fit = 'fill'))).ok).toBe(true)
    expect(validateProject(mutate((p) => (p.format.fit = 'fit'))).ok).toBe(true)
    expect(validateProject(mutate((p) => delete p.format.fit)).ok).toBe(true)
  })
  it('accepts a valid project and returns it', () => {
    const p = sample()
    const r = validateProject(p)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.project).toEqual(p)
  })
  it('rejects non-objects', () => {
    for (const v of [null, undefined, 1, 'x', [], true]) expect(validateProject(v).ok).toBe(false)
  })
  const mutate = (fn: (p: any) => void): any => {
    const p: any = structuredClone(sample())
    fn(p)
    return p
  }
  const bad: [string, (p: any) => void][] = [
    ['fractional time', (p) => (p.clips[0].srcOut = 5_000_000.5)],
    ['NaN time', (p) => (p.clips[0].start = NaN)],
    ['negative start', (p) => (p.clips[0].start = -1)],
    ['srcOut <= srcIn', (p) => (p.clips[0].srcOut = 0)],
    ['speed zero', (p) => (p.clips[0].speed = 0)],
    ['speed negative', (p) => (p.clips[0].speed = -1)],
    ['unknown asset reference', (p) => (p.clips[0].assetId = 'nope')],
    ['duplicate clip ids', (p) => p.clips.push(structuredClone(p.clips[0]))],
    ['duplicate asset ids', (p) => p.assets.push(structuredClone(p.assets[0]))],
    ['fps zero', (p) => (p.format.fps = 0)],
    ['unknown ratio', (p) => (p.format.ratio = '3:2')],
    ['empty name type', (p) => (p.name = 5)],
    ['missing assets list', (p) => delete p.assets],
    ['volume out of range', (p) => (p.clips[0].volume = 7)],
    ['bad asset kind', (p) => (p.assets[0].kind = 'gif')],
    ['transition with negative duration', (p) => (p.clips[0].transitionIn = { type: 'wipe', duration: -5 })],
    ['unknown project fit', (p) => (p.format.fit = 'stretch' as never)],
    ['non-string project fit', (p) => (p.format.fit = 1 as never)]
  ]
  for (const [name, fn] of bad) {
    it(`rejects: ${name}`, () => {
      const r = validateProject(mutate(fn))
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.errors.length).toBeGreaterThan(0)
        expect(r.errors.every((e: string) => typeof e === 'string' && e.length > 0)).toBe(true)
      }
    })
  }
  it('reports every problem, not only the first', () => {
    const r = validateProject(mutate((p) => { p.clips[0].speed = 0; p.format.fps = 0 }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const text = r.errors.join('\n')
      expect(text).toContain('clips[0].speed')
      expect(text).toContain('format.fps')
    }
  })
  it('names the offending path in the error', () => {
    const r = validateProject(mutate((p) => (p.clips[0].speed = 0)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toContain('clips[0].speed')
  })
  it('does not mutate its input', () => {
    const p = sample()
    const copy = structuredClone(p)
    validateProject(p)
    expect(p).toEqual(copy)
  })
})

describe('migrateProject', () => {
  it('is the identity on a current project', () => {
    const p = sample()
    const r = migrateProject(structuredClone(p))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.project).toEqual(p)
  })
  it('upgrades a legacy project without version and without optional lists', () => {
    const legacy = { name: 'Old', format: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: { type: 'blur' } }, assets: [], clips: [] }
    const r = migrateProject(legacy)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.project.version).toBe(CURRENT_VERSION)
      expect(r.project.format.ratio).toBe('9:16')
      expect(r.project.texts).toEqual([])
      expect(r.project.music).toEqual([])
      expect(validateProject(r.project).ok).toBe(true)
    }
  })
  it('refuses projects from a newer version with a clear message', () => {
    const r = migrateProject({ ...sample(), version: CURRENT_VERSION + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ').toLowerCase()).toContain('version')
  })
  it('rejects garbage', () => {
    expect(migrateProject('nope').ok).toBe(false)
    expect(migrateProject(null).ok).toBe(false)
  })
  it('does not mutate its input', () => {
    const legacy: any = { name: 'Old', format: createProject('x').format, assets: [], clips: [] }
    const copy = structuredClone(legacy)
    migrateProject(legacy)
    expect(legacy).toEqual(copy)
  })
})

describe('JSON roundtrip', () => {
  it('serialize then parse returns an equal project', () => {
    const p = sample()
    const r = parseProjectJson(serializeProject(p))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.project).toEqual(p)
  })
  it('serialize is stable, pretty-printed JSON ending in a newline', () => {
    const s = serializeProject(sample())
    expect(s.endsWith('\n')).toBe(true)
    expect(s).toContain('\n  "version"')
    expect(serializeProject(sample())).toBe(s)
  })
  it('parse reports invalid JSON as an error instead of throwing', () => {
    const r = parseProjectJson('{not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toBeTruthy()
  })
  it('parse validates after migrating', () => {
    expect(parseProjectJson(JSON.stringify({ name: 1 })).ok).toBe(false)
  })
})
