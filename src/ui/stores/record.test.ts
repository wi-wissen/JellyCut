import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The recorder and the media store are replaced: this tests how the panel's store behaves when they stall or fail.
const h = vi.hoisted(() => ({
  stopImpl: null as null | (() => Promise<File>),
  tracksStopped: 0,
  importImpl: null as null | (() => Promise<void>),
  assets: [] as { id: string; name: string }[],
  statusValue: 'ready'
}))

vi.mock('../../engine/record/recorder', () => ({
  RecordingError: class extends Error {},
  detectRecordCapabilities: () => ({ userMedia: true, displayMedia: true, mediaRecorder: true }),
  Recorder: class {
    liveStream = null
    async start() {}
    elapsedMs() {
      return 2000
    }
    stop() {
      return h.stopImpl!()
    }
    cancel() {}
  }
}))
vi.mock('./media', () => ({
  useMediaStore: () => ({
    importFiles: (list: File[]) => h.importImpl!().then(() => h.assets.push({ id: 'asset-1', name: list[0]!.name })),
    statusOf: () => h.statusValue
  })
}))
vi.mock('./editor', () => ({ useEditorStore: () => ({ project: { get assets() { return h.assets } } }) }))

import { IMPORT_TIMEOUT_MS, useRecordStore } from './record'

const file = () => new File([new Uint8Array(10)], 'Screen 2026-10-11 10-00-00.webm', { type: 'video/webm' })

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  h.assets = []
  h.statusValue = 'ready'
  h.stopImpl = async () => file()
  h.importImpl = async () => undefined
  vi.stubGlobal('document', { documentElement: { lang: 'de' } })
  vi.stubGlobal('window', { addEventListener: () => undefined })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function recordAndStop() {
  const store = useRecordStore()
  await store.start('screen')
  expect(store.phase).toBe('recording')
  const stopped = store.stop()
  return { store, stopped }
}

describe('record store: taking the recording into the library', () => {
  it('ends in done when the import works', async () => {
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.phase).toBe('done')
    expect(store.hasRawFile).toBe(false)
  })

  it('an import that never resolves ends in an error with the raw file kept, not in an endless finishing state', async () => {
    h.importImpl = () => new Promise<void>(() => undefined)
    const { store, stopped } = await recordAndStop()
    expect(store.phase).toBe('finishing')
    await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS)
    await stopped
    expect(store.phase).toBe('error')
    expect(store.errorKey).toBe('record.error.timeout')
    expect(store.hasRawFile).toBe(true)
  })

  it('an unsupported file is reported with the raw file kept', async () => {
    h.statusValue = 'unsupported'
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.phase).toBe('error')
    expect(store.errorKey).toBe('record.error.import')
    expect(store.hasRawFile).toBe(true)
  })

  it('a failing recorder has no file to offer', async () => {
    h.stopImpl = async () => {
      throw new Error('boom')
    }
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.phase).toBe('error')
    expect(store.hasRawFile).toBe(false)
  })

  it('importAgain succeeds once the library can take the file, and clears the kept file', async () => {
    h.statusValue = 'unsupported'
    const { store, stopped } = await recordAndStop()
    await stopped
    h.statusValue = 'ready'
    await store.importAgain()
    expect(store.phase).toBe('done')
    expect(store.hasRawFile).toBe(false)
  })

  it('saveRecording downloads the kept file', async () => {
    h.statusValue = 'unsupported'
    const { store, stopped } = await recordAndStop()
    await stopped
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { documentElement: { lang: 'de' }, createElement: () => link, body: { append: vi.fn() } })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    store.saveRecording()
    expect(link.click).toHaveBeenCalled()
    expect(link.download).toBe('Screen 2026-10-11 10-00-00.webm')
  })
})
