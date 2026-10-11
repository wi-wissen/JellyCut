import {
  DEFAULT_LIMIT_MS,
  extensionForMime,
  isEmptyRecording,
  pickMimeType,
  recordingFileName,
  type RecordCapabilities,
  type RecordKind,
  type RecordLocale
} from '../../core/record/record'

/** Chunks are flushed once a second, so a crash loses at most that much. */
const TIMESLICE_MS = 1000
const LIMIT_CHECK_MS = 250

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

type Phase = 'idle' | 'recording' | 'paused' | 'stopping' | 'done'

/**
 * Records one microphone, camera or screen source with MediaRecorder. One instance per recording.
 * All tracks are stopped when the recording ends, however it ends.
 */
export class Recorder {
  private phase: Phase = 'idle'
  private kind: RecordKind = 'microphone'
  private locale: RecordLocale = 'en'
  private limitMs = DEFAULT_LIMIT_MS
  private now: () => number = () => Date.now()
  private stream: MediaStream | null = null
  private media: MediaRecorder | null = null
  private mimeType = ''
  private chunks: Blob[] = []
  private startedAt = new Date()
  private accumulatedMs = 0
  private segmentStart = 0
  private finalizing: Promise<File> | null = null
  private limitTimer: ReturnType<typeof setInterval> | null = null
  private meter: { context: AudioContext; analyser: AnalyserNode; samples: Float32Array; frame: number } | null = null
  private options: RecorderOptions = {}

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

    const stream = await acquire(kind)
    try {
      const media = new MediaRecorder(stream, { mimeType })
      media.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data)
      }
      this.stream = stream
      this.media = media
      for (const track of stream.getTracks()) track.addEventListener('ended', this.onTrackEnded)
      this.startMeter(stream)
      this.chunks = []
      this.startedAt = new Date()
      media.start(TIMESLICE_MS)
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
    this.accumulatedMs += this.now() - this.segmentStart
    this.phase = 'paused'
  }

  resume(): void {
    if (this.phase !== 'paused' || !this.media) return
    this.media.resume()
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
      await new Promise<void>((resolve, reject) => {
        media.onstop = () => resolve()
        media.onerror = (event) => {
          const name = (event as Event & { error?: { name?: string } }).error?.name ?? 'UnknownError'
          reject(new RecordingError(name, 'recorder failed'))
        }
        if (media.state === 'inactive') resolve()
        else media.stop()
      })
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

  /** Stops every track and the meter. Safe to call more than once. */
  private release(): void {
    this.clearTimers()
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this.onTrackEnded)
        track.stop()
      }
    }
    this.stream = null
    this.media = null
  }
}
