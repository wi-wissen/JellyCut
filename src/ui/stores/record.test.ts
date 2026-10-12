import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The recorder and the media store are replaced: this tests how the panel's store behaves when they stall or fail.
const h = vi.hoisted(() => ({
  stopImpl: null as null | (() => Promise<File>),
  tracksStopped: 0,
  importImpl: null as null | (() => Promise<void>),
  assets: [] as { id: string; name: string }[],
  statusValue: 'ready',
  persistResult: 'stored' as string,
  persisted: [] as string[],
  check: null as null | object,
  optimizeImpl: null as null | ((file: File, options: { signal?: AbortSignal; onProgress?: (f: number) => void }) => Promise<{ file: File | null; reason: string }>),
  replaced: [] as { id: string; file: File; previous: File }[],
  replaceResult: true,
  health: { strategy: 'raw', problem: null as null | string, expectedAudio: true, micSilent: false, systemSoundDropped: false }
}))

vi.mock('../../engine/record/recorder', () => ({
  RecordingError: class extends Error {},
  detectRecordCapabilities: () => ({ userMedia: true, displayMedia: true, mediaRecorder: true }),
  Recorder: class {
    liveStream = null
    microphoneError = null
    diagnostics() {
      return {
        version: '', userAgent: '', kind: '', mimeType: '', mimeSupport: {}, tracks: [], pipeline: null, chunkSizes: [], events: [], errors: [], tracksAtStop: [], tracksAtEnd: [], elapsedMs: 0,
        capture: { videoPath: '', videoPathReason: '', videoProblem: '', audioPath: 'none', audioContext: [], contextSampleRate: null, micTrackSampleRate: null, micLevel: null, micSilentWarning: false, micDevices: null, micDeviceRemembered: false, luma: null, framesSeen: null, post: null }
      }
    }
    health() {
      return h.health
    }
    setFileCheck() {}
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
vi.mock('../../engine/record/optimize', () => ({ optimizeRecording: (f: File, o: object) => h.optimizeImpl!(f, o) }))
vi.mock('../../engine/record/postCheck', () => ({ checkRecording: async () => h.check }))
vi.mock('./media', () => ({
  useMediaStore: () => ({
    importFiles: (list: File[]) => h.importImpl!().then(() => h.assets.push({ id: 'asset-1', name: list[0]!.name })),
    statusOf: () => h.statusValue,
    replaceFile: async (id: string, file: File, previous: File) => {
      h.replaced.push({ id, file, previous })
      return h.replaceResult
    },
    persistAsset: async (id: string) => {
      h.persisted.push(id)
      return h.persistResult
    }
  }),
  getAssetFile: () => new File([new Uint8Array(10)], 'Screen 2026-10-11 10-00-00.webm', { type: 'video/webm' })
}))
vi.mock('./editor', () => ({ useEditorStore: () => ({ project: { get assets() { return h.assets } } }) }))

import { IMPORT_TIMEOUT_MS, useRecordStore } from './record'

const stored = new Map<string, string>()
const file = () => new File([new Uint8Array(10)], 'Screen 2026-10-11 10-00-00.webm', { type: 'video/webm' })

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  h.assets = []
  h.statusValue = 'ready'
  h.persistResult = 'stored'
  h.persisted = []
  h.replaced = []
  h.replaceResult = true
  h.optimizeImpl = async () => ({ file: null, reason: 'noEncoder' })
  h.stopImpl = async () => file()
  h.importImpl = async () => undefined
  vi.stubGlobal('document', { documentElement: { lang: 'de' } })
  vi.stubGlobal('window', { addEventListener: () => undefined })
  h.check = null
  h.health = { strategy: 'raw', problem: null, expectedAudio: true, micSilent: false, systemSoundDropped: false }
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k)
  })
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

describe('record store: optimising the finished recording in the background', () => {
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  it('the clip is usable at once; the optimised file replaces the raw one under the same asset id', async () => {
    const better = new File([new Uint8Array(20)], 'Screen 2026-10-11 10-00-00.webm', { type: 'video/webm' })
    let finish: (value: { file: File | null; reason: string }) => void = () => undefined
    h.optimizeImpl = (_f, o) => {
      o.onProgress?.(0.4)
      return new Promise((resolve) => (finish = resolve))
    }
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.phase).toBe('done')
    expect(store.optimizeFraction).toBe(0.4)
    finish({ file: better, reason: 'optimized' })
    await settle()
    expect(h.replaced).toHaveLength(1)
    expect(h.replaced[0]!.id).toBe('asset-1')
    expect(h.replaced[0]!.file).toBe(better)
    expect(store.optimizeFraction).toBeNull()
    expect(store.statusKey).toBe('record.status.optimized')
  })

  it('Skip cancels the work and keeps the raw file', async () => {
    let signal: AbortSignal | undefined
    h.optimizeImpl = (_f, o) => {
      signal = o.signal
      return new Promise((resolve) => o.signal!.addEventListener('abort', () => resolve({ file: null, reason: 'canceled' })))
    }
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.optimizeFraction).toBe(0)
    store.skipOptimize()
    await settle()
    expect(signal?.aborted).toBe(true)
    expect(h.replaced).toHaveLength(0)
    expect(store.optimizeFraction).toBeNull()
  })

  it('a result that arrives after Skip is not used', async () => {
    const better = new File([new Uint8Array(20)], 'x.webm')
    let finish: (value: { file: File | null; reason: string }) => void = () => undefined
    h.optimizeImpl = () => new Promise((resolve) => (finish = resolve))
    const { store, stopped } = await recordAndStop()
    await stopped
    store.skipOptimize()
    finish({ file: better, reason: 'optimized' })
    await settle()
    expect(h.replaced).toHaveLength(0)
  })

  it('a file that is not better leaves the raw file in place', async () => {
    h.optimizeImpl = async () => ({ file: null, reason: 'mismatch' })
    const { store, stopped } = await recordAndStop()
    await stopped
    await settle()
    expect(h.replaced).toHaveLength(0)
    expect(store.optimizeFraction).toBeNull()
  })

  it('Save a copy still gives the recording as the browser delivered it', async () => {
    const better = new File([new Uint8Array(20)], 'Screen 2026-10-11 10-00-00.webm')
    h.optimizeImpl = async () => ({ file: better, reason: 'optimized' })
    const saved: File[] = []
    const link = { click: () => undefined, remove: () => undefined, href: '', download: '' }
    vi.stubGlobal('document', { documentElement: { lang: 'de' }, createElement: () => link, body: { append: () => undefined } })
    vi.stubGlobal('URL', { createObjectURL: (f: File) => (saved.push(f), 'blob:x'), revokeObjectURL: () => undefined })
    const { store, stopped } = await recordAndStop()
    await stopped
    await settle()
    store.saveRecording()
    expect(saved).toHaveLength(1)
    expect(saved[0]!.size).toBe(10)
  })
})

describe('record store: taking the recording into the library', () => {
  it('ends in done when the import works', async () => {
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.phase).toBe('done')
    expect(store.hasRawFile).toBe(false)
  })

  it('afterImport keeps a copy of the recording and shows no storage problem', async () => {
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(h.persisted).toEqual(['asset-1'])
    expect(store.storageProblemKey).toBeNull()
  })

  it('a full storage keeps the recording in memory, says so, and the file can still be saved', async () => {
    h.persistResult = 'quota'
    const clicks: string[] = []
    const link = { click: () => clicks.push('click'), remove: () => undefined, href: '', download: '' }
    vi.stubGlobal('document', { documentElement: { lang: 'de' }, createElement: () => link, body: { append: () => undefined } })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.phase).toBe('done')
    expect(store.storageProblemKey).toBe('record.storage.quota')
    store.saveRecording()
    expect(clicks).toEqual(['click'])
  })

  it('storage that is not available gets its own message', async () => {
    h.persistResult = 'unavailable'
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.storageProblemKey).toBe('record.storage.unavailable')
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

  it('a silent file raises the "no sound" finding and keeps the details for the owner', async () => {
    h.check = { hasAudioTrack: true, audioPeak: 0, audioRms: 0, audioSeconds: 3, hasVideoTrack: true, frameLuma: [80] }
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.phase).toBe('done')
    expect(store.checkKeys).toEqual(['record.check.silentAudio'])
  })

  it('a black picture switches the next screen recording to the canvas way, once, and tells the user', async () => {
    h.check = { hasAudioTrack: true, audioPeak: 0.3, audioRms: 0.1, audioSeconds: 3, hasVideoTrack: true, frameLuma: [0, 0.2] }
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.checkKeys).toEqual(['record.check.blackPicture'])
    expect(JSON.parse(stored.get('jellycut.record.strategy')!)).toEqual({ strategy: 'canvas', lastProblem: 'black' })
    expect(store.extraNoticeKeys).toContain('record.notice.otherWay')
  })

  it('a healthy recording keeps the way and clears the problem', async () => {
    stored.set('jellycut.record.strategy', JSON.stringify({ strategy: 'canvas', lastProblem: 'black' }))
    h.health = { ...h.health, strategy: 'canvas' }
    h.check = { hasAudioTrack: true, audioPeak: 0.3, audioRms: 0.1, audioSeconds: 3, hasVideoTrack: true, frameLuma: [90] }
    const { store, stopped } = await recordAndStop()
    await stopped
    expect(store.checkKeys).toEqual([])
    expect(JSON.parse(stored.get('jellycut.record.strategy')!)).toEqual({ strategy: 'canvas', lastProblem: null })
  })

  it('live warnings come and go by kind', () => {
    const store = useRecordStore()
    store.applyWarning({ kind: 'noMic', active: true })
    store.applyWarning({ kind: 'black', active: true })
    expect(store.warningKeys).toEqual(['record.warn.noMic', 'record.warn.black'])
    store.applyWarning({ kind: 'noMic', active: false })
    expect(store.warningKeys).toEqual(['record.warn.black'])
  })
})
