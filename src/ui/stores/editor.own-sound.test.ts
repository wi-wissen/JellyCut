import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { validateProject } from '../../core/project/schema'
import { secondsToMicros } from '../../core/time'
import { useEditorStore } from './editor'
import { useSpeedDialogStore } from './speedDialog'

const s = (seconds: number) => secondsToMicros(seconds)

/** A demo session with one own sound item of 10 s, added at 4 s (the recorded voice sound). */
function storeWithOwnSound() {
  vi.stubGlobal('location', { search: '?demo=1' })
  setActivePinia(createPinia())
  const store = useEditorStore()
  store.commitProject({
    ...store.project,
    assets: [...store.project.assets, { id: 'asset-voice', kind: 'audio', name: 'Aufnahme.webm', relPath: 'media/voice.webm', size: 1, duration: s(10) }],
    music: [
      ...store.project.music,
      { id: 'music-voice', assetId: 'asset-voice', start: s(4), srcIn: 0, srcOut: s(10), volume: 1, fadeIn: 0, fadeOut: 0 }
    ]
  })
  store.select({ kind: 'music', id: 'music-voice' })
  return store
}

describe('own sound on the timeline', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('a drag moves it in time and one undo step puts it back', () => {
    const store = storeWithOwnSound()
    store.beginGesture()
    store.moveMusic('music-voice', s(9))
    store.moveMusic('music-voice', s(12))
    store.endGesture()
    expect(store.project.music.find((m) => m.id === 'music-voice')?.start).toBe(s(12))
    store.undo()
    expect(store.project.music.find((m) => m.id === 'music-voice')?.start).toBe(s(4))
  })

  it('trims both ends and the project stays valid', () => {
    const store = storeWithOwnSound()
    store.beginGesture()
    store.trimMusicStart('music-voice', s(6))
    store.endGesture()
    expect(store.project.music.find((m) => m.id === 'music-voice')).toMatchObject({ start: s(6), srcIn: s(2) })
    store.trimMusicEnd('music-voice', s(20))
    expect(store.project.music.find((m) => m.id === 'music-voice')?.srcOut).toBe(s(10))
    expect(validateProject(store.project).ok).toBe(true)
  })

  it('split at the playhead, duplicate, mute and delete work on the selected own sound', () => {
    const store = storeWithOwnSound()
    // The demo project already has a music bed, so counts are compared with the start.
    const base = store.project.music.length
    store.setPlayhead(s(8))
    store.splitSelectedMusic()
    expect(store.project.music).toHaveLength(base + 1)
    store.undo()
    expect(store.project.music).toHaveLength(base)

    store.duplicateSelected()
    expect(store.project.music).toHaveLength(base + 1)
    expect(store.selection?.kind).toBe('music')

    store.toggleMuteSelected()
    expect(store.selectedMusic?.muted).toBe(true)
    store.toggleMuteSelected()
    expect(store.selectedMusic?.muted).toBe(false)

    store.deleteSelected()
    expect(store.project.music).toHaveLength(base)
  })
})

describe('clip tempo', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('sets any speed in range by id, is one undo step, and refuses a value out of range', () => {
    vi.stubGlobal('location', { search: '?demo=1' })
    setActivePinia(createPinia())
    const store = useEditorStore()
    const clipId = 'clip-beach'
    const before = store.project.clips.find((c) => c.id === clipId)!
    expect(store.setClipSpeed(clipId, 20)).toBe(true)
    expect(store.project.clips.find((c) => c.id === clipId)?.speed).toBe(20)
    store.undo()
    expect(store.project.clips.find((c) => c.id === clipId)?.speed).toBe(before.speed)
    expect(store.setClipSpeed(clipId, 150)).toBe(false)
    expect(store.setClipSpeed(clipId, 0.1)).toBe(true)
  })

  it('the speed dialog is bound to the clip it was opened for', () => {
    vi.stubGlobal('location', { search: '?demo=1' })
    setActivePinia(createPinia())
    const dialog = useSpeedDialogStore()
    dialog.openFor('clip-intro')
    useEditorStore().select({ kind: 'clip', id: 'clip-beach' })
    expect(dialog.clipId).toBe('clip-intro')
    dialog.close()
    expect(dialog.isOpen).toBe(false)
  })
})
