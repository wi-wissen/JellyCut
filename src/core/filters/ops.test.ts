import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import type { Clip, Project } from '../project/types'
import { applyGradeToAll, clipGrade, gradeTargetClipId, setClipGrade } from './ops'

const S = 1_000_000

function clip(id: string, start: number, extra: Partial<Clip> = {}): Clip {
  return {
    id, track: 'video', assetId: 'a', srcIn: 0, srcOut: 4 * S, start, speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1, muted: false, filter: null, transitionIn: null, ...extra
  }
}

function project(clips: Clip[]): Project {
  const p = createProject('t')
  p.assets.push({ id: 'a', kind: 'video', name: 'a.webm', relPath: 'a.webm', size: 1, duration: 10 * S })
  p.clips = clips
  return p
}

describe('setClipGrade', () => {
  it('sets the filter and leaves other clips alone', () => {
    const p = project([clip('c1', 0), clip('c2', 4 * S)])
    const next = setClipGrade(p, 'c1', { filter: 'sepia' })
    expect(next.clips[0]!.filter).toBe('sepia')
    expect(next.clips[1]).toBe(p.clips[1])
    expect(p.clips[0]!.filter).toBeNull()
  })

  it("stores 'none' as null", () => {
    const p = project([clip('c1', 0, { filter: 'sepia' })])
    expect(setClipGrade(p, 'c1', { filter: 'none' }).clips[0]!.filter).toBeNull()
  })

  it('rejects unknown filter ids by returning the same project', () => {
    const p = project([clip('c1', 0)])
    expect(setClipGrade(p, 'c1', { filter: 'polaroid' })).toBe(p)
  })

  it('clamps amount and adjustments and merges adjustments field by field', () => {
    let p = project([clip('c1', 0)])
    p = setClipGrade(p, 'c1', { filterAmount: 7, adjust: { brightness: 0.4 } })
    expect(p.clips[0]!.filterAmount).toBe(1)
    expect(p.clips[0]!.adjust).toEqual({ brightness: 0.4, contrast: 0, saturation: 0 })
    p = setClipGrade(p, 'c1', { adjust: { contrast: -2 } })
    expect(p.clips[0]!.adjust).toEqual({ brightness: 0.4, contrast: -1, saturation: 0 })
  })

  it('returns the same project when nothing changes or the clip is missing', () => {
    const p = project([clip('c1', 0, { filter: 'warm' })])
    expect(setClipGrade(p, 'c1', { filter: 'warm' })).toBe(p)
    expect(setClipGrade(p, 'c1', { filterAmount: 1 })).toBe(p)
    expect(setClipGrade(p, 'missing', { filter: 'warm' })).toBe(p)
  })

  it('does not mutate the input project', () => {
    const p = project([clip('c1', 0)])
    const copy = structuredClone(p)
    setClipGrade(p, 'c1', { filter: 'vivid', filterAmount: 0.5, adjust: { saturation: 1 } })
    expect(p).toEqual(copy)
  })
})

describe('clipGrade', () => {
  it('is null for an ungraded clip and a grade otherwise', () => {
    expect(clipGrade(clip('c1', 0))).toBeNull()
    expect(clipGrade(clip('c1', 0, { filter: 'sepia' }))).not.toBeNull()
    expect(clipGrade(clip('c1', 0, { filter: 'sepia', filterAmount: 0 }))).toBeNull()
    expect(clipGrade(clip('c1', 0, { adjust: { brightness: 0, contrast: 0, saturation: 0 } }))).toBeNull()
  })
})

describe('applyGradeToAll', () => {
  it('copies filter, amount and adjustments to every clip', () => {
    const p = project([clip('c1', 0, { filter: 'noir', filterAmount: 0.5, adjust: { brightness: 0.2, contrast: 0, saturation: -0.3 } }), clip('c2', 4 * S), clip('c3', 8 * S, { filter: 'warm' })])
    const next = applyGradeToAll(p, 'c1')
    for (const c of next.clips) {
      expect(c.filter).toBe('noir')
      expect(c.filterAmount).toBe(0.5)
      expect(c.adjust).toEqual({ brightness: 0.2, contrast: 0, saturation: -0.3 })
    }
    expect(next.clips[0]!.adjust).not.toBe(next.clips[1]!.adjust)
  })

  it('returns the project unchanged for an unknown clip', () => {
    const p = project([clip('c1', 0)])
    expect(applyGradeToAll(p, 'nope')).toBe(p)
  })
})

describe('gradeTargetClipId', () => {
  const p = project([clip('c1', 0), clip('c2', 4 * S)])

  it('prefers the selected clip', () => {
    expect(gradeTargetClipId(p, { kind: 'clip', id: 'c1' }, 5 * S)).toBe('c1')
  })

  it('falls back to the clip under the playhead', () => {
    expect(gradeTargetClipId(p, null, 5 * S)).toBe('c2')
    expect(gradeTargetClipId(p, { kind: 'text', id: 'x' }, 1 * S)).toBe('c1')
  })

  it('takes the later clip exactly at a cut', () => {
    expect(gradeTargetClipId(p, null, 4 * S)).toBe('c2')
  })

  it('is null when no clip is selected or under the playhead', () => {
    expect(gradeTargetClipId(p, null, 100 * S)).toBeNull()
    expect(gradeTargetClipId(project([]), null, 0)).toBeNull()
  })
})
