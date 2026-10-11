import { defineStore } from 'pinia'
import { withTimeout } from '../../core/async/timeout'
import { friendlyRecordError, type RecordKind, type RecordLocale } from '../../core/record/record'
import { Recorder, detectRecordCapabilities, RecordingError } from '../../engine/record/recorder'
import { useEditorStore } from './editor'
import { useMediaStore } from './media'

export type RecordPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing' | 'done' | 'error'

const TICK_MS = 250
const TIME_ANNOUNCE_MS = 10_000
/**
 * Upper bound for taking a finished recording into the library (probe 30 s and thumbnail 10 s have their own
 * limits). Whatever happens, the panel leaves 'finishing' and offers the raw file.
 */
export const IMPORT_TIMEOUT_MS = 60_000

// The recorder owns the stream and the MediaRecorder: they are not reactive state.
let recorder: Recorder | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let guardsInstalled = false
// The finished recording, kept outside reactive state until it is in the library, so a failed import never loses it.
let pendingFile: File | null = null

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const ACTIVE_PHASES: readonly RecordPhase[] = ['starting', 'recording', 'paused', 'finishing']
const LIVE_PHASES: readonly RecordPhase[] = ['starting', 'recording', 'paused']

/** Preview source for the panel; the panel binds it to a <video> and must not keep a copy. */
export function livePreviewStream(): MediaStream | null {
  return recorder?.liveStream ?? null
}

function currentLocale(): RecordLocale {
  return document.documentElement.lang === 'de' ? 'de' : 'en'
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

/**
 * Keeps the editor's shortcuts away from a running recording: Space would start playback and Ctrl+Z would
 * change the project while the student is talking. Buttons keep their own Space behaviour.
 */
function swallowShortcuts(event: KeyboardEvent): void {
  const store = useRecordStore()
  if (!ACTIVE_PHASES.includes(store.phase)) return
  const target = event.target
  if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'checkbox')) return
  if (target instanceof HTMLElement && target.isContentEditable) return
  const isSpace = event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey
  const isUndoRedo = (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())
  if (!isSpace && !isUndoRedo) return
  if (isSpace && target instanceof HTMLButtonElement) return
  event.stopPropagation()
}

function installGuards(): void {
  if (guardsInstalled) return
  guardsInstalled = true
  window.addEventListener('beforeunload', (event) => {
    if (!ACTIVE_PHASES.includes(useRecordStore().phase)) return
    event.preventDefault()
    event.returnValue = ''
  })
  window.addEventListener('keydown', swallowShortcuts, true)
}

export const useRecordStore = defineStore('record', {
  state: () => ({
    phase: 'idle' as RecordPhase,
    kind: null as RecordKind | null,
    elapsedMs: 0,
    level: 0,
    /** Count of completed 10 s blocks for the polite time announcement (0 means none yet). */
    announcedTens: 0,
    /** i18n key of the short status line, announced through the status region. */
    statusKey: '' as string,
    errorKey: null as string | null,
    fileName: null as string | null,
    assetId: null as string | null,
    /** An error happened after the recording was complete: it can be saved as a file or imported again. */
    hasRawFile: false,
    capabilities: detectRecordCapabilities()
  }),
  getters: {
    active: (state): boolean => ACTIVE_PHASES.includes(state.phase),
    live: (state): boolean => LIVE_PHASES.includes(state.phase)
  },
  actions: {
    /** Asks for the device (the browser shows its own prompt), then records until stop(). */
    async start(kind: RecordKind): Promise<void> {
      if (this.active) return
      installGuards()
      this.kind = kind
      this.phase = 'starting'
      this.elapsedMs = 0
      this.level = 0
      this.announcedTens = 0
      this.errorKey = null
      this.fileName = null
      this.assetId = null
      this.hasRawFile = false
      pendingFile = null
      const next = new Recorder()
      recorder = next
      try {
        await next.start(kind, {
          locale: currentLocale(),
          onLevel: (level) => {
            this.level = level
          },
          onAutoStop: () => {
            void this.stop()
          }
        })
      } catch (e) {
        recorder = null
        this.fail(e)
        return
      }
      this.phase = 'recording'
      this.statusKey = 'record.status.started'
      this.startTicker()
    },

    pause(): void {
      if (this.phase !== 'recording' || !recorder) return
      recorder.pause()
      this.phase = 'paused'
      this.statusKey = 'record.status.paused'
      this.tick()
    },

    resume(): void {
      if (this.phase !== 'paused' || !recorder) return
      recorder.resume()
      this.phase = 'recording'
      this.statusKey = 'record.status.resumed'
    },

    /** Finishes the recording, then puts it into the media library. Also used when the recorder stops itself. */
    async stop(): Promise<void> {
      if (!recorder || !this.live) return
      const finished = recorder
      this.tick()
      this.phase = 'finishing'
      this.stopTicker()
      try {
        pendingFile = await finished.stop()
        await this.importRecording(pendingFile)
      } catch (e) {
        this.fail(e)
      } finally {
        if (recorder === finished) recorder = null
        this.level = 0
      }
    },

    /** Discards the recording: no asset is added. */
    cancel(): void {
      if (!recorder || !this.live) return
      recorder.cancel()
      recorder = null
      this.stopTicker()
      this.phase = 'idle'
      this.kind = null
      this.elapsedMs = 0
      this.level = 0
      this.statusKey = 'record.status.cancelled'
    },

    addToTimeline(): void {
      if (this.phase !== 'done' || !this.assetId) return
      useMediaStore().addToTimeline(this.assetId)
    },

    /** Back to the buttons, for "Record again" and after an error. */
    reset(): void {
      if (this.active) return
      this.phase = 'idle'
      this.kind = null
      this.errorKey = null
      this.fileName = null
      this.assetId = null
      this.hasRawFile = false
      pendingFile = null
      this.statusKey = ''
    },

    /** Starts again with the same source after an error. */
    retry(): void {
      const kind = this.kind
      if (!kind) return this.reset()
      void this.start(kind)
    },

    /** Puts the file into the library. Ends in 'done' or 'error'; never stays pending longer than IMPORT_TIMEOUT_MS. */
    async importRecording(file: File): Promise<void> {
      const media = useMediaStore()
      const editor = useEditorStore()
      // The recorder's clock backs up containers without a length (MediaRecorder output has none).
      const durationHintSeconds = this.elapsedMs > 0 ? this.elapsedMs / 1000 : undefined
      await withTimeout(media.importFiles([file], [], { durationHintSeconds }), IMPORT_TIMEOUT_MS, 'import')
      const asset = [...editor.project.assets].reverse().find((a) => a.name === file.name)
      if (!asset || media.statusOf(asset.id) !== 'ready') {
        this.fail(new Error('import failed'))
        this.errorKey = 'record.error.import'
        return
      }
      pendingFile = null
      this.hasRawFile = false
      this.assetId = asset.id
      this.fileName = file.name
      this.phase = 'done'
      this.statusKey = 'record.status.stopped'
    },

    /** Offers the recorded file as a download, for when the library could not take it. */
    saveRecording(): void {
      if (pendingFile) downloadFile(pendingFile)
    },

    /** Tries to take the kept recording into the library again. */
    async importAgain(): Promise<void> {
      const file = pendingFile
      if (!file || this.phase !== 'error') return
      this.phase = 'finishing'
      this.errorKey = null
      try {
        await this.importRecording(file)
      } catch (e) {
        this.fail(e)
      }
    },

    fail(error: unknown): void {
      const name = error instanceof RecordingError ? error.name : errorName(error)
      this.errorKey = friendlyRecordError(name)
      this.hasRawFile = pendingFile !== null
      this.phase = 'error'
      this.statusKey = ''
    },

    startTicker(): void {
      this.stopTicker()
      ticker = setInterval(() => this.tick(), TICK_MS)
    },

    stopTicker(): void {
      if (ticker !== null) clearInterval(ticker)
      ticker = null
    },

    /** Called by the timer and after pause/stop; reads the recorder's clock, which excludes paused time. */
    tick(): void {
      if (!recorder) return
      const ms = recorder.elapsedMs()
      this.elapsedMs = ms
      const tens = Math.floor(ms / TIME_ANNOUNCE_MS)
      if (tens > this.announcedTens) this.announcedTens = tens
    }
  }
})
