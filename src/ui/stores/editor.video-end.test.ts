import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createProject } from '../../core/project/schema'
import type { MusicItem, OverlayItem, Project, TextItem } from '../../core/project/types'
import { addMusic } from '../../core/timeline/insert'
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

describe('music on the video end (editor store)', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { search: '?demo=1' })
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Adds a music item of the demo's music file (30 s) with the given timeline start and length. */
  function musicAt(store: ReturnType<typeof useEditorStore>, id: string, start: number, length: number, srcIn = 0): void {
    const item: MusicItem = { id, assetId: 'asset-music', start: s(start), srcIn: s(srcIn), srcOut: s(srcIn + length), volume: 1, fadeIn: 0, fadeOut: 0 }
    store.commitProject({ ...store.project, music: [...store.project.music, item] })
  }

  function music(store: ReturnType<typeof useEditorStore>, id: string): MusicItem {
    return store.project.music.find((m) => m.id === id)!
  }

  it('music added at the playhead near the end ends at the end of the video', () => {
    const store = useEditorStore()
    store.setPlayhead(s(29.8))
    store.commitProject(addMusic(store.project, 'asset-music', 'music-near', store.playheadMicros))
    expect(music(store, 'music-near')).toMatchObject({ start: s(29.5), srcIn: 0, srcOut: s(0.5) })
  })

  it('a drag past the end stops flush and keeps the length', () => {
    const store = useEditorStore()
    musicAt(store, 'music-b', 5, 10)
    store.beginGesture()
    store.moveMusic('music-b', s(20))
    store.moveMusic('music-b', s(40))
    store.endGesture()
    expect(music(store, 'music-b')).toMatchObject({ start: s(20), srcOut: s(10) })
  })

  it('trimming the end past the end stops at the end of the video', () => {
    const store = useEditorStore()
    musicAt(store, 'music-b', 5, 10)
    store.trimMusicEnd('music-b', s(45))
    expect(music(store, 'music-b')).toMatchObject({ start: s(5), srcIn: 0, srcOut: s(25) })
  })

  it('deleting the last clip shortens the music at the end, keeps the rest, and undo restores it', () => {
    const store = useEditorStore()
    musicAt(store, 'music-late', 18, 10)
    musicAt(store, 'music-mid', 5, 10)
    const count = store.project.music.length
    store.select({ kind: 'clip', id: 'clip-interview' })
    store.deleteSelected()

    expect(store.videoEndMicros).toBe(s(20))
    expect(store.project.music).toHaveLength(count)
    expect(music(store, 'music-1')).toMatchObject({ srcIn: 0, srcOut: s(20) })
    expect(music(store, 'music-late')).toMatchObject({ start: s(18), srcOut: s(2) })
    expect(music(store, 'music-mid')).toMatchObject({ start: s(5), srcOut: s(10) })

    store.undo()
    expect(music(store, 'music-1')).toMatchObject({ srcOut: s(30) })
    expect(music(store, 'music-late')).toMatchObject({ start: s(18), srcOut: s(10) })
  })

  it('a speed change that shortens the video shortens the music', () => {
    const store = useEditorStore()
    expect(store.setClipSpeed('clip-interview', 2)).toBe(true)
    expect(store.videoEndMicros).toBe(s(25))
    expect(music(store, 'music-1')).toMatchObject({ srcIn: 0, srcOut: s(25) })
  })

  it('trimming the last clip shortens the music too', () => {
    const store = useEditorStore()
    store.trimEnd('clip-interview', s(26))
    expect(music(store, 'music-1')).toMatchObject({ srcOut: s(26) })
  })

  it('a project without clips does not clamp its music', () => {
    const store = useEditorStore()
    const asset = { id: 'asset-music', kind: 'audio' as const, name: 'bed.mp3', relPath: 'media/bed.mp3', size: 1, duration: s(30) }
    const item: MusicItem = { id: 'mu', assetId: 'asset-music', start: s(40), srcIn: 0, srcOut: s(10), volume: 1, fadeIn: 0, fadeOut: 0 }
    store.replaceDocument({ ...createProject('No clips'), assets: [asset], music: [item] }, { handle: null, name: null })
    expect(music(store, 'mu')).toMatchObject({ start: s(40), srcOut: s(10) })
  })

  it('a loaded project with music past the end is fitted once, without an undo step or a dirty flag', () => {
    const store = useEditorStore()
    store.replaceDocument({ ...buildDemoProject(), music: [{ ...buildDemoProject().music[0]!, id: 'music-over', start: s(25), srcOut: s(10) }] }, { handle: null, name: 'loaded.json' })
    expect(music(store, 'music-over')).toMatchObject({ start: s(25), srcOut: s(5) })
    expect(store.canUndo).toBe(false)
    expect(store.dirtySinceFileSave).toBe(false)
  })
})
