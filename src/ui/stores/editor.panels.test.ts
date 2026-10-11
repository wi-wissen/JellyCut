import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { validateProject } from '../../core/project/schema'
import { secondsToMicros } from '../../core/time'
import { useEditorStore } from './editor'

const s = (seconds: number) => secondsToMicros(seconds)

describe('editor store: panel actions', () => {
  beforeEach(() => {
    // These tests use the demo project's clips, texts and music.
    vi.stubGlobal('location', { search: '?demo=1' })
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('adds a text at the playhead, selects it, and undoes it in one step', () => {
    const store = useEditorStore()
    store.setPlayhead(s(5))
    store.addTextAtPlayhead('neon', 'Hallo')
    const added = store.project.texts.at(-1)!
    expect(added).toMatchObject({ start: s(5), text: 'Hallo', style: { font: 'Fredoka' } })
    expect(store.selection).toEqual({ kind: 'text', id: added.id })
    expect(validateProject(store.project).ok).toBe(true)
    store.undo()
    expect(store.project.texts.some((t) => t.id === added.id)).toBe(false)
  })

  it('updates the selected text only, and coalesces a keyed burst into one undo step', () => {
    const store = useEditorStore()
    store.select({ kind: 'text', id: 'text-1' })
    const before = store.project
    for (const size of [30, 40, 50]) store.updateSelectedText({ style: { size } }, 'text-size:text-1')
    expect(store.project.texts[0]!.style.size).toBe(50)
    store.endGesture()
    store.undo()
    expect(store.project.texts[0]).toEqual(before.texts[0])
  })

  it('does nothing when the selection is not a text', () => {
    const store = useEditorStore()
    store.select({ kind: 'clip', id: 'clip-beach' })
    const before = store.project
    store.updateSelectedText({ text: 'x' })
    expect(store.project).toBe(before)
  })

  it('sets clip props on the selected clip and coalesces a keyed zoom drag', () => {
    const store = useEditorStore()
    store.select({ kind: 'clip', id: 'clip-beach' })
    for (const scale of [1.2, 1.5, 2]) store.setSelectedClipProps({ transform: { scale } }, 'clip-zoom:clip-beach')
    expect(store.selectedClip?.transform.scale).toBe(2)
    store.endGesture()
    store.undo()
    expect(store.project.clips.find((c) => c.id === 'clip-beach')!.transform.scale).toBe(1)
  })

  it('applies a transition to the selected clip after the first one and selects it', () => {
    const store = useEditorStore()
    store.select({ kind: 'clip', id: 'clip-interview' })
    store.applyTransition('wipeLeft', s(0.5))
    expect(store.project.clips.find((c) => c.id === 'clip-interview')!.transitionIn).toEqual({ type: 'wipeLeft', duration: s(0.5) })
    expect(store.selection).toEqual({ kind: 'clip', id: 'clip-interview' })
    expect(validateProject(store.project).ok).toBe(true)
  })

  it('falls back to the clip nearest the playhead when the first clip is selected', () => {
    const store = useEditorStore()
    store.setPlayhead(s(9))
    store.select({ kind: 'clip', id: 'clip-intro' })
    store.applyTransition('fade')
    expect(store.project.clips.find((c) => c.id === 'clip-intro')!.transitionIn).toBeNull()
    expect(store.project.clips.find((c) => c.id === 'clip-beach')!.transitionIn?.type).toBe('fade')
    expect(store.selection).toEqual({ kind: 'clip', id: 'clip-beach' })
  })

  it('uses the clip after the first one nearest the playhead when nothing is selected', () => {
    const store = useEditorStore()
    store.setPlayhead(0)
    store.select(null)
    store.applyTransition('fade')
    expect(store.project.clips.find((c) => c.id === 'clip-beach')!.transitionIn?.type).toBe('fade')
    expect(store.project.clips.find((c) => c.id === 'clip-intro')!.transitionIn).toBeNull()
  })

  it('removes the transition of the given clip or of the selected clip', () => {
    const store = useEditorStore()
    store.select({ kind: 'clip', id: 'clip-beach' })
    store.applyTransition('zoomIn', s(1))
    store.removeTransition('clip-interview')
    store.select({ kind: 'clip', id: 'clip-beach' })
    store.removeTransition()
    expect(store.project.clips.find((c) => c.id === 'clip-beach')!.transitionIn).toBeNull()
    expect(store.project.clips.find((c) => c.id === 'clip-interview')!.transitionIn).toBeNull()
  })

  it('sets the ratio and the background', () => {
    const store = useEditorStore()
    store.setRatio('9:16')
    expect(store.project.format).toMatchObject({ ratio: '9:16', width: 1080, height: 1920 })
    store.setBackground({ type: 'color', color: '#336699' }, 'bg')
    expect(store.project.format.background).toEqual({ type: 'color', color: '#336699' })
    expect(validateProject(store.project).ok).toBe(true)
  })

  it('sets fit for the whole project, whatever is selected', () => {
    const store = useEditorStore()
    store.select({ kind: 'clip', id: 'clip-beach' })
    store.setProjectFit('fill')
    expect(store.project.format.fit).toBe('fill')
    expect(store.project.clips.map((c) => c.transform.fit)).toEqual(['fill', 'fill', 'fill'])
    store.select(null)
    store.setProjectFit('fit')
    expect(store.project.format.fit).toBe('fit')
    expect(store.project.clips.map((c) => c.transform.fit)).toEqual(['fit', 'fit', 'fit'])
  })

  it('treats a selected text as "nothing selected" for fit', () => {
    const store = useEditorStore()
    store.select({ kind: 'text', id: 'text-1' })
    store.setProjectFit('fill')
    expect(store.project.clips.every((c) => c.transform.fit === 'fill')).toBe(true)
  })

  it('updates the selected music item and clamps its values', () => {
    const store = useEditorStore()
    store.select({ kind: 'music', id: 'music-1' })
    store.updateSelectedMusic({ volume: 9, fadeIn: s(9) }, 'music-volume:music-1')
    expect(store.project.music[0]).toMatchObject({ volume: 2, fadeIn: s(5) })
    store.select({ kind: 'clip', id: 'clip-beach' })
    const before = store.project
    store.updateSelectedMusic({ volume: 1 })
    expect(store.project).toBe(before)
  })
})

describe('editor store: design tabs', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { search: '?demo=1' })
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('leaving the draw tab ends drawing; the tabs of the design group start with text', () => {
    const store = useEditorStore()
    store.setActiveGroup('design', 'draw')
    store.setDrawing(true)
    expect(store.drawing).toBe(true)
    store.setActiveTab('region')
    expect(store.activeTab).toBe('region')
    expect(store.drawing).toBe(false)
    store.setActiveGroup('design', 'text')
    expect(store.activeTab).toBe('text')
  })

  it('a new blur or pixelate area takes the chosen shape and is selected', () => {
    const store = useEditorStore()
    store.setRegionShape('roundRect')
    store.setPlayhead(s(4))
    store.addRegionAtPlayhead('pixelate')
    const added = store.project.overlays.at(-1)!
    expect(added).toMatchObject({ kind: 'region', shape: 'roundRect', effect: 'pixelate' })
    expect(store.selection).toEqual({ kind: 'overlay', id: added.id })
  })

  it('a library video becomes a picture in the picture at the playhead and is selected', () => {
    const store = useEditorStore()
    store.setPlayhead(s(3))
    store.addMediaAtPlayhead('asset-beach')
    const added = store.project.overlays.at(-1)!
    expect(added).toMatchObject({ kind: 'media', assetId: 'asset-beach', start: s(3) })
    expect(store.selection).toEqual({ kind: 'overlay', id: added.id })
    expect(validateProject(store.project).ok).toBe(true)
  })

  it('arrow-key nudges of a selected overlay coalesce into one undo step', () => {
    const store = useEditorStore()
    store.addRegionAtPlayhead('blur')
    store.endGesture()
    const id = store.selection!.id
    const before = store.project.overlays.find((o) => o.id === id)!.pos.x
    store.editProject((base) => updateOverlayForTest(base, id, { pos: { x: before + 0.01 } }), `overlay-nudge:${id}`)
    store.editProject((base) => updateOverlayForTest(base, id, { pos: { x: before + 0.02 } }), `overlay-nudge:${id}`)
    expect(store.project.overlays.find((o) => o.id === id)!.pos.x).toBeCloseTo(before + 0.02)
    store.endGesture()
    store.undo()
    expect(store.project.overlays.find((o) => o.id === id)!.pos.x).toBeCloseTo(before)
  })
})

import { updateOverlay as updateOverlayForTest } from '../../core/timeline/overlayOps'
