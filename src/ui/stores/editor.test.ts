import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { validateProject } from '../../core/project/schema'
import { buildDemoProject, projectDuration, useEditorStore } from './editor'

describe('demo project', () => {
  it('is valid and lasts 30 s', () => {
    const project = buildDemoProject()
    expect(validateProject(project).ok).toBe(true)
    expect(projectDuration(project)).toBe(30_000_000)
  })
})

describe('editor store', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { search: '?demo=1' })
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('places timeline spans as percentages of the total duration', () => {
    const store = useEditorStore()
    const [intro, beach, interview] = store.videoSpans
    expect(intro?.leftPct).toBeCloseTo(0)
    expect(intro?.widthPct).toBeCloseTo(26.67, 1)
    expect(beach?.leftPct).toBeCloseTo(26.67, 1)
    expect(beach?.widthPct).toBeCloseTo(40, 1)
    expect(interview?.leftPct).toBeCloseTo(66.67, 1)
    expect(interview?.widthPct).toBeCloseTo(33.33, 1)
  })

  it('formats the demo playhead as timecode', () => {
    const store = useEditorStore()
    expect(store.timecode).toBe('00:11:08')
  })

  it('computes the subtitle sample with the last word as accent', () => {
    const store = useEditorStore()
    expect(store.subtitle).toEqual({ lead: 'Ein Tag am', accent: 'Meer' })
  })
})
