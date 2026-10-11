import {
  DEFAULT_LIMIT_MS,
  extensionForMime,
  isEmptyRecording,
  mimeCandidates,
  pickMimeType,
  recordingFileName,
  type RecordCapabilities,
  type RecordKind,
  type RecordLocale
} from '../../core/record/record'
import { TimeoutError, withTimeout } from '../../core/async/timeout'
import {
  addDiagnosticEvent,
  emptyDiagnostics,
  type RecordDiagnostics,
  type TrackSettingsInfo
} from '../../core/record/diagnostics'
import { createAudioMix, type AudioMix } from './audioMix'
import { createScreenPipeline, type ScreenPipeline } from './screenPipeline'

/** Chunks are flushed once a second, so a crash loses at most that much. */
const TIMESLICE_MS = 1000
const LIMIT_CHECK_MS = 250
/**
 * How long stop() waits for the recorder's final data and 'stop' event. Chunks arrive every second anyway, so a
 * browser that never fires it (seen with screen capture) still yields the recording instead of hanging.
 * The tracks are stopped only afterwards: ending the capture first can lose the last chunk (Firefox).
 */
export const STOP_EVENT_TIMEOUT_MS = 4000
/** A recorder that already went inactive (its source ended) only needs a moment to deliver its last chunk. */
const INACTIVE_GRACE_MS = 300

const AUDIO_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true }

export interface RecorderOptions {
  locale?: RecordLocale
  limitMs?: number
  /** Level of the microphone signal, RMS in 0..1, sampled once per animation frame. Only for sources with audio. */
  onLevel?: (level: number) => void
  /**
   * The recorder finished by itself (the shared screen was stopped in the browser, or the limit was reached).
   * The recording is complete; the owner calls stop() to take the File.
   */
  onAutoStop?: (reason: 'ended' | 'limit') => void
  now?: () => number
  /** Screen only: also record the student's voice. If the microphone is refused the recording continues without it. */
  withMicrophone?: boolean
}

/** Errors carry the name the UI maps with friendlyRecordError(); browser errors keep their own DOMException name. */
export class RecordingError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

export function detectRecordCapabilities(): RecordCapabilities {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  return {
    userMedia: typeof devices?.getUserMedia === 'function',
    displayMedia: typeof devices?.getDisplayMedia === 'function',
    mediaRecorder: typeof MediaRecorder !== 'undefined'
  }
}

interface Acquired {
  stream: MediaStream
  microphone: MediaStream | null
  /** Error name when the microphone was wanted but could not be opened. */
  microphoneError: string | null
}

/**
 * Screen first, microphone second: the screen picker needs the click's user activation, which a long microphone
 * permission prompt would use up. The microphone call needs no activation.
 */
async function acquireWithMicrophone(kind: RecordKind, withMicrophone: boolean): Promise<Acquired> {
  const stream = await acquire(kind)
  if (kind !== 'screen' || !withMicrophone) return { stream, microphone: null, microphoneError: null }
  try {
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false })
    return { stream, microphone, microphoneError: null }
  } catch (e) {
    return { stream, microphone: null, microphoneError: e instanceof Error && e.name ? e.name : 'UnknownError' }
  }
}

async function acquire(kind: RecordKind): Promise<MediaStream> {
  const devices = navigator.mediaDevices
  if (!devices) throw new RecordingError('UnsupportedRecordingError', 'media devices are not available')
  if (kind === 'microphone') {
    return devices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false })
  }
  if (kind === 'camera') {
    return devices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
  }
  if (typeof devices.getDisplayMedia !== 'function') {
    throw new RecordingError('UnsupportedRecordingError', 'screen capture is not available')
  }
  // System audio is nice to have: browsers that refuse it still get the picture.
  try {
    return await devices.getDisplayMedia({ video: true, audio: true })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'NotAllowedError' || name === 'AbortError') throw e
    return devices.getDisplayMedia({ video: true, audio: false })
  }
}

function describeTrack(track: MediaStreamTrack): TrackSettingsInfo {
  const settings = (typeof track.getSettings === 'function' ? track.getSettings() : {}) as MediaTrackSettings & {
    displaySurface?: string
    cursor?: string
  }
  return {
    kind: track.kind,
    readyState: track.readyState,
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    displaySurface: settings.displaySurface,
    cursor: settings.cursor
  }
}

type Phase = 'idle' | 'recording' | 'paused' | 'stopping' | 'done'

/**
 * Records one microphone, camera or screen source with MediaRecorder. One instance per recording.
 * All tracks are stopped when the recording ends, however it ends. The screen goes through a canvas
 * (see screenPipeline.ts) so a still picture still produces frames.
 */
export class Recorder {
  private phase: Phase = 'idle'
  private kind: RecordKind = 'microphone'
  private locale: RecordLocale = 'en'
  private limitMs = DEFAULT_LIMIT_MS
  private now: () => number = () => Date.now()
  private stream: MediaStream | null = null
  private media: MediaRecorder | null = null
  private pipeline: ScreenPipeline | null = null
  private microphone: MediaStream | null = null
  private mix: AudioMix | null = null
  private diag: RecordDiagnostics = emptyDiagnostics()
  private diagStart = 0
  private micError: string | null = null
  private mimeType = ''
  private chunks: Blob[] = []
  private startedAt = new Date()
  private accumulatedMs = 0
  private segmentStart = 0
  private finalizing: Promise<File> | null = null
  private limitTimer: ReturnType<typeof setInterval> | null = null
  private meter: { context: AudioContext; analyser: AnalyserNode; samples: Float32Array; frame: number } | null = null
  private options: RecorderOptions = {}

  /** Error name of a microphone that was asked for but could not be used (the recording went on without it); else null. */
  get microphoneError(): string | null {
    return this.micError
  }

  /** Technical facts about this recording, for the details box after a failure. */
  diagnostics(): RecordDiagnostics {
    return { ...this.diag, elapsedMs: this.accumulatedMs || this.elapsedMs() }
  }

  /** The live stream for the preview (camera and screen); null when not recording. */
  get liveStream(): MediaStream | null {
    return this.stream
  }

  async start(kind: RecordKind, options: RecorderOptions = {}): Promise<void> {
    if (this.phase !== 'idle') throw new RecordingError('InvalidStateError', 'recording already started')
    if (typeof MediaRecorder === 'undefined') {
      throw new RecordingError('UnsupportedRecordingError', 'MediaRecorder is not available')
    }
    const mimeType = pickMimeType(kind, (type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) throw new RecordingError('UnsupportedRecordingError', 'no container format is supported')

    this.options = options
    this.kind = kind
    this.locale = options.locale ?? 'en'
    this.limitMs = options.limitMs ?? DEFAULT_LIMIT_MS
    this.now = options.now ?? (() => Date.now())
    this.mimeType = mimeType
    this.micError = null
    this.diag = emptyDiagnostics()
    this.diagStart = this.now()
    this.diag.version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
    this.diag.userAgent = typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? '')
    this.diag.kind = kind
    this.diag.mimeType = mimeType
    for (const type of mimeCandidates(kind)) this.diag.mimeSupport[type] = MediaRecorder.isTypeSupported(type)

    const { stream, microphone, microphoneError } = await acquireWithMicrophone(kind, options.withMicrophone === true)
    this.micError = microphoneError
    this.microphone = microphone
    if (microphoneError) this.note(`microphone refused: ${microphoneError}`)
    try {
      this.diag.tracks = [...stream.getTracks(), ...(microphone?.getTracks() ?? [])].map(describeTrack)
      this.pipeline = kind === 'screen' ? createScreenPipeline(stream) : null
      let recorded: MediaStream = this.pipeline?.stream ?? stream
      if (kind === 'screen' && microphone) {
        // One audio track in the file: the voice, plus the share's own sound when the browser gives it.
        this.mix = createAudioMix(microphone, stream.getAudioTracks())
        const audio = this.mix ? [this.mix.track] : microphone.getAudioTracks().slice(0, 1)
        recorded = new MediaStream([...(this.pipeline ? this.pipeline.stream : stream).getVideoTracks(), ...audio])
      } else if (this.pipeline) {
        recorded = new MediaStream([...this.pipeline.stream.getVideoTracks(), ...stream.getAudioTracks()])
      }
      const media = new MediaRecorder(recorded, { mimeType })
      media.ondataavailable = (event) => {
        this.diag.chunkSizes.push(event.data.size)
        this.note(`data ${event.data.size} bytes`)
        if (event.data.size > 0) this.chunks.push(event.data)
      }
      media.onerror = (event) => this.noteError(event)
      this.stream = stream
      this.media = media
      for (const track of stream.getTracks()) track.addEventListener('ended', this.onTrackEnded)
      this.startMeter(microphone ?? stream)
      this.chunks = []
      this.startedAt = new Date()
      media.start(TIMESLICE_MS)
      this.note(`start, state=${media.state}`)
      this.accumulatedMs = 0
      this.segmentStart = this.now()
      this.phase = 'recording'
      this.limitTimer = setInterval(() => {
        if (this.elapsedMs() >= this.limitMs) this.autoStop('limit')
      }, LIMIT_CHECK_MS)
    } catch (e) {
      stream.getTracks().forEach((track) => track.stop())
      this.release()
      throw e
    }
  }

  /** Recorded time without paused stretches. */
  elapsedMs(): number {
    if (this.phase === 'idle' || this.phase === 'done') return 0
    const live = this.phase === 'recording' ? this.now() - this.segmentStart : 0
    return Math.floor(this.accumulatedMs + live)
  }

  pause(): void {
    if (this.phase !== 'recording' || !this.media) return
    this.media.pause()
    this.pipeline?.pause()
    this.note('pause')
    this.accumulatedMs += this.now() - this.segmentStart
    this.phase = 'paused'
  }

  resume(): void {
    if (this.phase !== 'paused' || !this.media) return
    this.media.resume()
    this.pipeline?.resume()
    this.mix?.resume()
    this.note('resume')
    this.segmentStart = this.now()
    this.phase = 'recording'
  }

  /** Ends the recording and returns it as a File. Repeated calls return the same result. */
  stop(): Promise<File> {
    this.finalizing ??= this.finalize()
    return this.finalizing
  }

  /** Discards the recording. Not possible while stop() is finishing. */
  cancel(): void {
    if (this.phase === 'stopping') return
    const media = this.media
    if (media) {
      media.ondataavailable = null
      media.onstop = null
      media.onerror = null
      if (media.state !== 'inactive') media.stop()
    }
    this.chunks = []
    this.phase = 'done'
    this.release()
  }

  private async finalize(): Promise<File> {
    const media = this.media
    if (this.phase === 'idle' || this.phase === 'done' || !media) {
      throw new RecordingError('InvalidStateError', 'no recording to stop')
    }
    this.accumulatedMs = this.elapsedMs()
    this.phase = 'stopping'
    this.clearTimers()
    try {
      const stopped = new Promise<void>((resolve, reject) => {
        media.onstop = () => {
          this.note('stop event')
          resolve()
        }
        media.onerror = (event) => {
          const name = this.noteError(event)
          reject(new RecordingError(name, 'recorder failed'))
        }
      })
      const wasInactive = media.state === 'inactive'
      this.note(`stop requested, state=${media.state}`)
      this.diag.tracksAtStop = this.describeAll()
      if (!wasInactive) {
        // One last frame, then flush explicitly: some browsers deliver the final chunk only on request.
        this.pipeline?.drawNow()
        try {
          media.requestData()
          this.note('requestData')
        } catch {
          // already stopping; stop() below still delivers the data
        }
        media.stop()
      }
      try {
        await withTimeout(stopped, wasInactive ? INACTIVE_GRACE_MS : STOP_EVENT_TIMEOUT_MS, 'recorder stop')
      } catch (e) {
        if (!(e instanceof TimeoutError)) throw e
        this.note('no stop event within the time limit')
      }
      this.diag.tracksAtEnd = this.describeAll()
      if (this.pipeline) this.diag.pipeline = this.pipeline.info()
      const size = this.chunks.reduce((total, chunk) => total + chunk.size, 0)
      if (isEmptyRecording(size, this.accumulatedMs)) {
        throw new RecordingError('EmptyRecordingError', 'the recording is empty')
      }
      const blob = new Blob(this.chunks, { type: this.baseMime() })
      const name = recordingFileName(this.kind, this.startedAt, this.locale, extensionForMime(this.mimeType))
      return new File([blob], name, { type: this.baseMime(), lastModified: Date.now() })
    } finally {
      this.chunks = []
      this.phase = 'done'
      this.release()
    }
  }

  private note(what: string): void {
    addDiagnosticEvent(this.diag, this.now() - this.diagStart, what)
  }

  private noteError(event: Event): string {
    const error = (event as Event & { error?: { name?: string; message?: string } }).error
    const name = error?.name ?? 'UnknownError'
    this.diag.errors.push({ name, message: error?.message ?? '' })
    this.note(`error ${name}`)
    return name
  }

  private describeAll(): TrackSettingsInfo[] {
    return [...(this.stream?.getTracks() ?? []), ...(this.microphone?.getTracks() ?? [])].map(describeTrack)
  }

  private baseMime(): string {
    return this.mimeType.split(';')[0]!.trim()
  }

  private readonly onTrackEnded = (): void => {
    this.autoStop('ended')
  }

  private autoStop(reason: 'ended' | 'limit'): void {
    if (this.phase !== 'recording' && this.phase !== 'paused') return
    // The owner takes the File through stop(); a failure surfaces there, so it is not handled twice here.
    this.stop().catch(() => undefined)
    this.options.onAutoStop?.(reason)
  }

  private startMeter(stream: MediaStream): void {
    const onLevel = this.options.onLevel
    if (!onLevel || stream.getAudioTracks().length === 0 || typeof AudioContext === 'undefined') return
    try {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      context.createMediaStreamSource(stream).connect(analyser)
      void context.resume().catch(() => undefined)
      const samples = new Float32Array(analyser.fftSize)
      this.meter = { context, analyser, samples, frame: 0 }
      const sample = (): void => {
        if (!this.meter) return
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const value of samples) sum += value * value
        onLevel(Math.min(1, Math.sqrt(sum / samples.length)))
        this.meter.frame = requestAnimationFrame(sample)
      }
      this.meter.frame = requestAnimationFrame(sample)
    } catch {
      this.meter = null
    }
  }

  private clearTimers(): void {
    if (this.limitTimer !== null) clearInterval(this.limitTimer)
    this.limitTimer = null
    if (this.meter) {
      cancelAnimationFrame(this.meter.frame)
      this.meter.context.close().catch(() => undefined)
      this.meter = null
    }
  }

  /** Stops the screen pipeline, every track (the browser's sharing indicator goes off) and the meter. Safe to call more than once. */
  private stopTracks(): void {
    this.clearTimers()
    if (this.pipeline && !this.diag.pipeline) this.diag.pipeline = this.pipeline.info()
    this.pipeline?.stop()
    this.pipeline = null
    this.mix?.close()
    this.mix = null
    this.microphone?.getTracks().forEach((track) => track.stop())
    if (!this.stream) return
    for (const track of this.stream.getTracks()) {
      track.removeEventListener('ended', this.onTrackEnded)
      track.stop()
    }
  }

  private release(): void {
    this.stopTracks()
    this.stream = null
    this.microphone = null
    this.media = null
  }
}
