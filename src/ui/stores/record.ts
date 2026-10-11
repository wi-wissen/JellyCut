import { defineStore } from 'pinia'
import { withTimeout } from '../../core/async/timeout'
import { formatDiagnostics } from '../../core/record/diagnostics'
import { chooseMicrophone, type MicOption } from '../../core/record/devices'
import { friendlyMicNotice, friendlyRecordError, type RecordKind, type RecordLocale } from '../../core/record/record'
import { NO_SIGNAL_LEVEL, QuietWatch, judgeRecording } from '../../core/record/signal'
import {
  DEFAULT_MEMORY,
  decideNextStrategy,
  parseStrategyMemory,
  serializeStrategyMemory,
  type StrategyMemory,
  type VideoProblem
} from '../../core/record/strategy'
import { Recorder, detectRecordCapabilities, RecordingError, type LiveWarning } from '../../engine/record/recorder'
import { listMicrophones, microphonePermissionGranted, startMicTest, type MicTest } from '../../engine/record/micTest'
import { checkRecording } from '../../engine/record/postCheck'
import { useEditorStore } from './editor'
import { useMediaStore } from './media'

export type RecordPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing' | 'done' | 'error'

const MIC_DEVICE_KEY = 'jellycut.record.microphoneDevice'
const STRATEGY_KEY = 'jellycut.record.strategy'

/** Storage can be blocked (private windows, site data off), so every access is guarded and optional. */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // not remembered; everything still works for this visit
  }
}

function loadStrategyMemory(): StrategyMemory {
  return parseStrategyMemory(readStorage(STRATEGY_KEY))
}

const TICK_MS = 250
const TIME_ANNOUNCE_MS = 10_000
/**
 * Upper bound for taking a finished recording into the library (probe 30 s and thumbnail 10 s have their own
 * limits). Whatever happens, the panel leaves 'finishing' and offers the raw file.
 */
export const IMPORT_TIMEOUT_MS = 60_000
/** Measuring the start of the finished file must never hold the panel back. */
const CHECK_TIMEOUT_MS = 8000

// The recorder owns the stream and the MediaRecorder: they are not reactive state.
let recorder: Recorder | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let guardsInstalled = false
// The finished recording, kept outside reactive state until it is in the library, so a failed import never loses it.
let pendingFile: File | null = null
// The microphone test owns a stream of its own; it is closed before any recording opens the device.
let micTestHandle: MicTest | null = null

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
    capabilities: detectRecordCapabilities(),
    /** Input devices for the picker; labels are empty until the permission was granted. */
    micDevices: [] as MicOption[],
    /** Chosen microphone id; null when there is no device list yet. */
    micDeviceId: null as string | null,
    /** Microphone test before recording: 'on' shows the live level, 'denied' and 'failed' explain themselves. */
    micTest: 'off' as 'off' | 'starting' | 'on' | 'denied' | 'failed',
    testLevel: 0,
    /** The test has seen no signal for a few seconds. */
    testSilent: false,
    /** i18n key of a non-blocking notice (microphone could not be added); null when there is none. */
    noticeKey: null as string | null,
    /** Other calm notices (way of recording switched, share sound dropped), i18n keys. */
    extraNoticeKeys: [] as string[],
    /** Live warnings while recording (no microphone signal, black picture), i18n keys. */
    warningKeys: [] as string[],
    /** Findings about the finished file (silent sound, black picture), i18n keys; they stay until the next recording. */
    checkKeys: [] as string[],
    /** Technical details of the last recording, shown after a failure. */
    diagnosticsText: ''
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
      this.noticeKey = null
      this.extraNoticeKeys = []
      this.warningKeys = []
      this.checkKeys = []
      this.diagnosticsText = ''
      pendingFile = null
      // Closing the test is synchronous and must stay so: the recorder's first step needs the click's user activation.
      this.stopMicTest()
      const memory = loadStrategyMemory()
      const next = new Recorder()
      recorder = next
      try {
        await next.start(kind, {
          locale: currentLocale(),
          strategy: memory.strategy,
          strategyReason: memory.lastProblem ? `remembered after ${memory.lastProblem}` : 'default',
          microphoneDeviceId: this.micDeviceId,
          microphoneCount: this.micDevices.length,
          onLevel: (level) => {
            this.level = level
          },
          onWarning: (warning) => this.applyWarning(warning),
          onAutoStop: () => {
            void this.stop()
          }
        })
      } catch (e) {
        this.diagnosticsText = formatDiagnostics(next.diagnostics())
        recorder = null
        this.fail(e)
        return
      }
      void this.refreshDevices()
      const micError = next.microphoneError
      this.noticeKey = micError ? friendlyMicNotice(micError) : null
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
        await this.importRecording(pendingFile, finished)
      } catch (e) {
        // A share that produced no data at all counts as "no pictures": the next recording tries the other way.
        if (e instanceof RecordingError && e.name === 'EmptyRecordingError') this.rememberWay(finished, 'noFrames')
        this.fail(e)
      } finally {
        this.diagnosticsText = formatDiagnostics(finished.diagnostics())
        if (recorder === finished) recorder = null
        this.level = 0
        this.warningKeys = []
      }
    },

    applyWarning(warning: LiveWarning): void {
      const key = { noMic: 'record.warn.noMic', black: 'record.warn.black', noFrames: 'record.warn.noFrames' }[warning.kind]
      const rest = this.warningKeys.filter((k) => k !== key)
      this.warningKeys = warning.active ? [...rest, key] : rest
    },

    /** Reads the devices (labels appear after a permission); keeps the choice when it is still plugged in. */
    async refreshDevices(): Promise<void> {
      const options = await listMicrophones()
      this.micDevices = options
      this.micDeviceId = chooseMicrophone(options, this.micDeviceId ?? readStorage(MIC_DEVICE_KEY))
    },

    /** Picker change: remembered, and a running test follows the new device. */
    selectMicrophone(id: string): void {
      this.micDeviceId = id
      writeStorage(MIC_DEVICE_KEY, id)
      if (this.micTest === 'on' || this.micTest === 'failed' || this.micTest === 'denied') void this.startMicTest()
    },

    /** Panel opened: list the devices, and start the level display at once when the permission is already there. */
    async openMicPicker(): Promise<void> {
      if (this.active) return
      await this.refreshDevices()
      if (this.micTest === 'off' && !this.active && (await microphonePermissionGranted())) await this.startMicTest()
    },

    /** Shows the live microphone level before recording. Needs a click (or an existing permission). */
    async startMicTest(): Promise<void> {
      if (this.active) return
      this.stopMicTest()
      this.micTest = 'starting'
      this.testLevel = 0
      const watch = new QuietWatch(NO_SIGNAL_LEVEL)
      try {
        micTestHandle = await startMicTest({
          deviceId: this.micDeviceId,
          onLevel: (level) => {
            this.testLevel = level
            if (micTestHandle && !micTestHandle.running()) return
            watch.push(performance.now(), level)
            this.testSilent = watch.isQuiet()
          },
          onEnded: () => this.stopMicTest()
        })
        if (this.active) {
          this.stopMicTest()
          return
        }
        this.micTest = 'on'
        await this.refreshDevices()
      } catch (e) {
        micTestHandle = null
        this.micTest = errorName(e) === 'NotAllowedError' ? 'denied' : 'failed'
      }
    },

    stopMicTest(): void {
      micTestHandle?.stop()
      micTestHandle = null
      this.micTest = 'off'
      this.testLevel = 0
      this.testSilent = false
    },

    /** Remembers which way of recording the screen to use next, from what this recording showed. */
    rememberWay(finished: Recorder, extra: VideoProblem | null = null, black = false): void {
      const health = finished.health()
      if (health.strategy === null) return
      const problem = health.problem ?? extra ?? (black ? 'black' : null)
      const decision = decideNextStrategy(loadStrategyMemory(), health.strategy, problem)
      writeStorage(STRATEGY_KEY, serializeStrategyMemory(decision.memory))
      if (decision.switched) this.extraNoticeKeys = [...this.extraNoticeKeys.filter((k) => k !== 'record.notice.otherWay'), 'record.notice.otherWay']
    },

    /** Measures the finished file and turns the result into warnings and the next way of recording. */
    async checkFile(file: File, finished: Recorder | undefined): Promise<void> {
      const check = await withTimeout(checkRecording(file), CHECK_TIMEOUT_MS, 'check').catch(() => null)
      finished?.setFileCheck(check)
      const health = finished?.health()
      const verdict = judgeRecording(check, health?.expectedAudio ?? true)
      const keys: string[] = []
      if (verdict.silentAudio) keys.push('record.check.silentAudio')
      if (verdict.blackPicture) keys.push('record.check.blackPicture')
      this.checkKeys = keys
      if (health?.systemSoundDropped) this.extraNoticeKeys = [...this.extraNoticeKeys, 'record.notice.systemSound']
      if (finished) this.rememberWay(finished, null, verdict.blackPicture)
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
      this.noticeKey = null
      this.extraNoticeKeys = []
      this.warningKeys = []
      this.checkKeys = []
      this.diagnosticsText = ''
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
    async importRecording(file: File, finished?: Recorder): Promise<void> {
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
      await this.checkFile(file, finished)
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
