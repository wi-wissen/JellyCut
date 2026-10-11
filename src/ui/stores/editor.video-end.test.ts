import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createProject } from '../../core/project/schema'
import type { OverlayItem, Project, TextItem } from '../../core/project/types'
import { secondsToMicros } from '../../core/time'
import { buildDemoProject, useEditorStore } from './editor'

const s = secondsToMicros

// Demo video: clip-intro 0-8 s, clip-beach 8-20 s, clip-interview 20-30 s. Its end is 30 s.

function sticker(id: string, start: number, duration: number): OverlayItem {
  return { id, kind: 'sticker', start: s(start), duration: s(duration), pos: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, emoji: '⭐', size: 0.12 }
}

function title(id: string, start: number, duration: number): TextItem {
  return {
    id,
    start: s(start),
    duration: s(duration),
    text: 'Hi',
    style: { font: 'Sora', size: 40, color: '#ffffff', outline: null },
    pos: { x: 0.5, y: 0.5 },
    animIn: null,
    animOut: null
  }
}

describe('overlays and texts on the video end (editor store)', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { search: '?demo=1' })
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Adds a sticker at the playhead time and returns its id. */
  function stickerAt(store: ReturnType<typeof useEditorStore>, seconds: number): string {
    store.setPlayhead(s(seconds))
    store.addStickerAtPlayhead('⭐')
    return store.project.overlays[store.project.overlays.length - 1]!.id
  }

  function overlay(store: ReturnType<typeof useEditorStore>, id: string): OverlayItem {
    return store.project.overlays.find((o) => o.id === id)!
  }

  it('a sticker added near the end ends at the end of the video', () => {
    const store = useEditorStore()
    const id = stickerAt(store, 29.8)
    expect(overlay(store, id)).toMatchObject({ start: s(29.5), duration: s(0.5) })
  })

  it('a title added at the playhead without clips keeps its default length', () => {
    const store = useEditorStore()
    store.replaceDocument(createProject('No clips'), { handle: null, name: null })
    store.setPlayhead(0)
    store.addTextAtPlayhead('title', 'Hi')
    expect(store.project.texts[0]).toMatchObject({ start: 0, duration: s(3) })
  })

  it('a move past the end stops flush and keeps the length', () => {
    const store = useEditorStore()
    const id = stickerAt(store, 1)
    store.moveOverlay(id, s(40))
    expect(overlay(store, id)).toMatchObject({ start: s(27), duration: s(3) })
  })

  it('a drag past the end stops flush during the gesture too', () => {
    const store = useEditorStore()
    const id = stickerAt(store, 1)
    store.beginGesture()
    store.moveOverlay(id, s(20))
    store.moveOverlay(id, s(35))
    store.endGesture()
    expect(overlay(store, id)).toMatchObject({ start: s(27), duration: s(3) })
  })

  it('trimming the end past the end stops at the end of the video', () => {
    const store = useEditorStore()
    const id = stickerAt(store, 1)
    store.trimOverlayEnd(id, s(45))
    expect(overlay(store, id)).toMatchObject({ start: s(1), duration: s(29) })
  })

  it('deleting the last clip moves the items to the new end, and undo restores their lengths', () => {
    const store = useEditorStore()
    const far = stickerAt(store, 25)
    const near = stickerAt(store, 18)
    store.select({ kind: 'clip', id: 'clip-interview' })
    store.deleteSelected()

    expect(store.videoEndMicros).toBe(s(20))
    expect(overlay(store, far)).toMatchObject({ start: s(17), duration: s(3) })
    expect(overlay(store, near)).toMatchObject({ start: s(18), duration: s(2) })

    store.undo()
    expect(store.project.clips.map((c) => c.id)).toContain('clip-interview')
    expect(overlay(store, far)).toMatchObject({ start: s(25), duration: s(3) })
    expect(overlay(store, near)).toMatchObject({ start: s(18), duration: s(3) })
  })

  it('a speed change that shortens the video moves the items that hang over the new end', () => {
    const store = useEditorStore()
    const id = stickerAt(store, 28)
    expect(store.setClipSpeed('clip-interview', 2)).toBe(true)
    expect(store.videoEndMicros).toBe(s(25))
    expect(overlay(store, id)).toMatchObject({ start: s(23), duration: s(2) })
  })

  it('trimming a clip shortens the video and moves the items that hang over the new end', () => {
    const store = useEditorStore()
    const id = stickerAt(store, 27)
    store.trimEnd('clip-interview', s(26))
    expect(store.videoEndMicros).toBe(s(26))
    expect(overlay(store, id)).toMatchObject({ start: s(23), duration: s(3) })
  })

  it('a loaded project with items over the end is fitted once, without an undo step or a dirty flag', () => {
    const store = useEditorStore()
    const project: Project = {
      ...buildDemoProject(),
      overlays: [sticker('over-1', 29, 5), sticker('over-2', 40, 2)],
      texts: [title('text-over', 29, 3)]
    }
    store.replaceDocument(project, { handle: null, name: 'loaded.json' })

    expect(store.project.overlays[0]).toMatchObject({ start: s(29), duration: s(1) })
    expect(store.project.overlays[1]).toMatchObject({ start: s(28), duration: s(2) })
    expect(store.project.texts[0]).toMatchObject({ start: s(29), duration: s(1) })
    expect(store.canUndo).toBe(false)
    expect(store.dirtySinceFileSave).toBe(false)
  })

  it('committing a project that is already fitted does not add an undo step', () => {
    const store = useEditorStore()
    store.replaceDocument({ ...buildDemoProject(), overlays: [sticker('o', 1, 2)] }, { handle: null, name: null })
    store.commitProject(store.project)
    expect(store.canUndo).toBe(false)
  })
})
