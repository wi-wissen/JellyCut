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

describe('clip colour grade fields', () => {
  it('accepts a valid filter amount and adjustments, and projects without them', () => {
    const p = sample()
    p.clips[0] = { ...p.clips[0]!, filter: 'sepia', filterAmount: 0.5, adjust: { brightness: -1, contrast: 0, saturation: 1 } }
    expect(validateProject(p).ok).toBe(true)
    expect(validateProject(sample()).ok).toBe(true)
  })
  it('rejects amounts outside 0..1 and adjustments outside -1..1', () => {
    const p = sample()
    p.clips[0] = { ...p.clips[0]!, filterAmount: 1.5 }
    expect(validateProject(p)).toMatchObject({ ok: false, errors: [expect.stringContaining('filterAmount')] })
    const q = sample()
    q.clips[0] = { ...q.clips[0]!, adjust: { brightness: 0, contrast: 2, saturation: 0 } }
    expect(validateProject(q)).toMatchObject({ ok: false, errors: [expect.stringContaining('adjust.contrast')] })
  })
  it('rejects non-finite values and a non-object adjust', () => {
    const p = sample()
    p.clips[0] = { ...p.clips[0]!, filterAmount: NaN }
    expect(validateProject(p).ok).toBe(false)
    const q = sample()
    q.clips[0] = { ...q.clips[0]!, adjust: 'bright' as unknown as Project['clips'][number]['adjust'] }
    expect(validateProject(q).ok).toBe(false)
  })
})

describe('asset credits (optional)', () => {
  const withCredit = (credit: unknown): unknown => {
    const p: any = structuredClone(sample())
    p.assets[0].credit = credit
    return p
  }
  it('projects without credit stay valid', () => {
    expect(validateProject(sample()).ok).toBe(true)
  })
  it('accepts a complete credit and empty optional fields', () => {
    expect(validateProject(withCredit({ title: 'Beach', author: 'Jane', source: 'Pixabay', url: 'https://pixabay.com', license: 'pixabay' })).ok).toBe(true)
    expect(validateProject(withCredit({})).ok).toBe(true)
    expect(validateProject(withCredit({ url: 'http://example.org/x' })).ok).toBe(true)
  })
  it('rejects a credit that is not an object or has non-string fields', () => {
    expect(validateProject(withCredit('Jane')).ok).toBe(false)
    expect(validateProject(withCredit(null)).ok).toBe(false)
    expect(validateProject(withCredit({ author: 3 })).ok).toBe(false)
  })
  it('rejects fields longer than 300 characters and accepts exactly 300', () => {
    expect(validateProject(withCredit({ title: 'x'.repeat(300) })).ok).toBe(true)
    const r = validateProject(withCredit({ title: 'x'.repeat(301) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain('assets[0].credit.title')
  })
  it('requires http or https links', () => {
    for (const url of ['javascript:alert(1)', 'ftp://x.org', 'www.pixabay.com', 'https://', 42]) {
      expect(validateProject(withCredit({ url })).ok).toBe(false)
    }
  })
  it('keeps credits through a JSON roundtrip', () => {
    const p = withCredit({ title: 'Beach', license: 'cc-by-4.0' })
    const r = parseProjectJson(serializeProject(p as any))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.project.assets[0]?.credit).toEqual({ title: 'Beach', license: 'cc-by-4.0' })
  })
})
