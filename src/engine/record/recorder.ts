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
import { NO_SIGNAL_LEVEL, QuietWatch, BLACK_LUMA, WARN_AFTER_MS, type RecordingCheck } from '../../core/record/signal'
import type { CaptureStrategy, VideoProblem } from '../../core/record/strategy'
import { createAudioMix, createRecordingContext, startLevelMeter, type AudioMix, type Meter, type RecordingContext } from './audioMix'
import { createDisplayMonitor, type DisplayMonitor } from './displayMonitor'
import { AUDIO_CONSTRAINTS, microphoneConstraints } from './micTest'
import { canCreateScreenPipeline, createScreenPipeline, type ScreenPipeline } from './screenPipeline'

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

/** How long a mix may take to start before the recorder gives up on it and records the voice alone. */
const MIX_START_WAIT_MS = 800
const HEALTH_CHECK_MS = 250

/** Live findings while recording: shown as calm warnings in the panel and cleared when the signal returns. */
export interface LiveWarning {
  kind: 'noMic' | 'black' | 'noFrames'
  active: boolean
}

/** What happened to the recording's sources; the store turns this into the next strategy and into notices. */
export interface RecordHealth {
  /** Screen only: the way the picture was recorded. */
  strategy: CaptureStrategy | null
  problem: VideoProblem | null
  /** A sound source was part of the recording. */
  expectedAudio: boolean
  /** The microphone meter stayed at digital silence for the whole recording. */
  micSilent: boolean
  /** The share's own sound could not be mixed in (the audio context did not start). */
  systemSoundDropped: boolean
}

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
  /** Screen only: the way the picture is recorded. Default 'raw'. */
  strategy?: CaptureStrategy
  strategyReason?: string
  /** Chosen microphone; when it is gone the default one is used. */
  microphoneDeviceId?: string | null
  onWarning?: (warning: LiveWarning) => void
  /** Called with the microphone devices count after the permission: for the diagnostics. */
  microphoneCount?: number
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
  /** The remembered microphone was unusable and the default one was opened instead. */
  deviceFellBack: boolean
}

const errorNameOf = (e: unknown): string => (e instanceof Error && e.name ? e.name : 'UnknownError')

/** Opens the chosen microphone; when that device is gone or refused, the default one. Throws the last error. */
async function openMicrophone(deviceId: string | null): Promise<{ stream: MediaStream; deviceFellBack: boolean }> {
  const devices = navigator.mediaDevices
  if (deviceId) {
    try {
      return { stream: await devices.getUserMedia({ audio: microphoneConstraints(deviceId), video: false }), deviceFellBack: false }
    } catch (e) {
      if (errorNameOf(e) === 'NotAllowedError') throw e
    }
    return { stream: await devices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false }), deviceFellBack: true }
  }
  return { stream: await devices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false }), deviceFellBack: false }
}

/** The camera with sound. Without a usable microphone the picture is still recorded and the reason is reported. */
async function openCamera(deviceId: string | null): Promise<Acquired> {
  const devices = navigator.mediaDevices
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } }
  let firstError: string | null = null
  let deviceFellBack = false
  if (deviceId) {
    try {
      const stream = await devices.getUserMedia({ audio: microphoneConstraints(deviceId), video })
      return { stream, microphone: null, microphoneError: null, deviceFellBack: false }
    } catch (e) {
      if (errorNameOf(e) !== 'NotAllowedError') deviceFellBack = true
      else firstError = 'NotAllowedError'
    }
  }
  if (firstError === null) {
    try {
      const stream = await devices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video })
      return { stream, microphone: null, microphoneError: null, deviceFellBack }
    } catch (e) {
      firstError = errorNameOf(e)
    }
  }
  // Camera alone: if that fails too the camera is the problem and its error is the one to show.
  const stream = await devices.getUserMedia({ audio: false, video })
  return { stream, microphone: null, microphoneError: firstError, deviceFellBack: false }
}

/**
 * Screen first, microphone second: the screen picker needs the click's user activation, which a long microphone
 * permission prompt would use up. The microphone call needs no activation.
 */
async function acquireSources(kind: RecordKind, deviceId: string | null): Promise<Acquired> {
  const devices = navigator.mediaDevices
  if (!devices) throw new RecordingError('UnsupportedRecordingError', 'media devices are not available')
  if (kind === 'microphone') {
    const { stream, deviceFellBack } = await openMicrophone(deviceId)
    return { stream, microphone: null, microphoneError: null, deviceFellBack }
  }
  if (kind === 'camera') return openCamera(deviceId)
  const stream = await acquireDisplay()
  try {
    const { stream: microphone, deviceFellBack } = await openMicrophone(deviceId)
    return { stream, microphone, microphoneError: null, deviceFellBack }
  } catch (e) {
    return { stream, microphone: null, microphoneError: errorNameOf(e), deviceFellBack: false }
  }
}

async function acquireDisplay(): Promise<MediaStream> {
  const devices = navigator.mediaDevices
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
 * All tracks are stopped when the recording ends, however it ends.
 *
 * Design (see docs/decisions.md): the tracks the browser hands out are recorded as they are. The screen picture
 * is the display track itself (a canvas re-draw is only the fallback when a recording showed that the direct way
 * delivers nothing); the sound is the microphone track itself. Web Audio mixes only when two sound sources exist
 * (voice + the share's own sound), and falls back to the voice alone when its context does not run.
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
  private monitor: DisplayMonitor | null = null
  private microphone: MediaStream | null = null
  private mix: AudioMix | null = null
  private audioContext: RecordingContext | null = null
  private meter: Meter | null = null
  private micWatch = new QuietWatch(NO_SIGNAL_LEVEL)
  private lumaWatch = new QuietWatch(BLACK_LUMA)
  private micWarned = false
  private blackWarned = false
  private noFramesWarned = false
  private systemSoundDropped = false
  private usedStrategy: CaptureStrategy | null = null
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
  private released = false
  private options: RecorderOptions = {}

  /** Error name of a microphone that was asked for but could not be used (the recording went on without it); else null. */
  get microphoneError(): string | null {
    return this.micError
  }

  /** Technical facts about this recording, for the details box. */
  diagnostics(): RecordDiagnostics {
    this.refreshCapture()
    return { ...this.diag, capture: { ...this.diag.capture }, elapsedMs: this.accumulatedMs || this.elapsedMs() }
  }

  /** The live stream for the preview (camera and screen); null when not recording. */
  get liveStream(): MediaStream | null {
    return this.stream
  }

  /** Findings about the sources so far; final after stop(). */
  health(): RecordHealth {
    return {
      strategy: this.usedStrategy,
      problem: this.videoProblem(),
      expectedAudio: this.diag.capture.audioPath !== 'none',
      micSilent: this.micSilentOverall(),
      systemSoundDropped: this.systemSoundDropped
    }
  }

  /** The measurement of the finished file (see postCheck.ts), kept with the other details. */
  setFileCheck(check: RecordingCheck | null): void {
    this.diag.capture.post = check
      ? {
          audioTrack: check.hasAudioTrack,
          audioPeak: check.audioPeak,
          audioRms: check.audioRms,
          audioSeconds: check.audioSeconds,
          frameLuma: check.frameLuma
        }
      : null
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
    this.diag.capture.micDevices = options.microphoneCount ?? null
    for (const type of mimeCandidates(kind)) this.diag.mimeSupport[type] = MediaRecorder.isTypeSupported(type)

    // Everything up to here is synchronous, so the click that started the recording still counts as the user
    // gesture: an AudioContext created now starts running; one created after the permission prompts may stay suspended.
    this.audioContext = kind === 'screen' || options.onLevel ? createRecordingContext(this.now) : null

    const acquired = await acquireSources(kind, options.microphoneDeviceId ?? null)
    const { stream, microphone } = acquired
    this.micError = acquired.microphoneError
    this.microphone = microphone
    this.diag.capture.micDeviceRemembered = (options.microphoneDeviceId ?? null) !== null && !acquired.deviceFellBack
    if (acquired.deviceFellBack) this.note('chosen microphone unavailable, default used')
    if (acquired.microphoneError) this.note(`microphone refused: ${acquired.microphoneError}`)
    try {
      this.diag.tracks = [...stream.getTracks(), ...(microphone?.getTracks() ?? [])].map(describeTrack)
      const recorded = await this.compose(kind, stream, microphone, options)
      const hasAudio = recorded.getAudioTracks().length > 0
      if (kind !== 'microphone' && !hasAudio) {
        this.mimeType = pickMimeType(kind, (type) => MediaRecorder.isTypeSupported(type), false) ?? this.mimeType
        this.diag.mimeType = this.mimeType
      }
      const media = new MediaRecorder(recorded, { mimeType: this.mimeType })
      media.ondataavailable = (event) => {
        this.diag.chunkSizes.push(event.data.size)
        this.note(`data ${event.data.size} bytes`)
        if (event.data.size > 0) this.chunks.push(event.data)
      }
      media.onerror = (event) => this.noteError(event)
      this.stream = stream
      this.media = media
      for (const track of stream.getTracks()) track.addEventListener('ended', this.onTrackEnded)
      this.chunks = []
      this.startedAt = new Date()
      media.start(TIMESLICE_MS)
      this.note(`start, state=${media.state}`)
      this.accumulatedMs = 0
      this.segmentStart = this.now()
      this.phase = 'recording'
      this.limitTimer = setInterval(() => {
        if (this.elapsedMs() >= this.limitMs) this.autoStop('limit')
        this.checkHealth()
      }, HEALTH_CHECK_MS)
    } catch (e) {
      stream.getTracks().forEach((track) => track.stop())
      this.release()
      throw e
    }
  }

  /** Builds the stream that is recorded: the picture track and at most one sound track, as direct as possible. */
  private async compose(kind: RecordKind, stream: MediaStream, microphone: MediaStream | null, options: RecorderOptions): Promise<MediaStream> {
    if (kind === 'microphone') {
      this.setAudioPath('microphone')
      this.startMeter(stream.getAudioTracks()[0])
      return stream
    }
    if (kind === 'camera') {
      if (stream.getAudioTracks().length > 0) this.setAudioPath('camera')
      this.startMeter(stream.getAudioTracks()[0])
      return stream
    }

    const displayVideo = stream.getVideoTracks()[0]
    let video: MediaStreamTrack | undefined = displayVideo
    if (displayVideo) {
      this.monitor = createDisplayMonitor(displayVideo)
      if (this.monitor) {
        this.monitor.onLuma((t, luma) => this.lumaWatch.push(t, luma))
        await this.monitor.ready
      }
    }
    const wanted: CaptureStrategy = options.strategy ?? 'raw'
    this.usedStrategy = 'raw'
    this.diag.capture.videoPathReason = options.strategyReason ?? 'default'
    if (wanted === 'canvas') {
      if (this.monitor && displayVideo && canCreateScreenPipeline()) {
        this.pipeline = createScreenPipeline(this.monitor.video, displayVideo)
      }
      if (this.pipeline) {
        this.usedStrategy = 'canvas'
        video = this.pipeline.stream.getVideoTracks()[0]
      } else {
        this.diag.capture.videoPathReason += ', canvas unavailable'
      }
    }
    this.diag.capture.videoPath = this.usedStrategy

    const voice = microphone?.getAudioTracks()[0] ?? null
    const system = stream.getAudioTracks()
    let audio: MediaStreamTrack | null = null
    if (voice && system.length > 0 && this.audioContext) {
      const mix = createAudioMix(this.audioContext.context, voice, system)
      if (mix && (await this.audioContext.whenRunning(MIX_START_WAIT_MS))) {
        this.mix = mix
        audio = mix.track
        this.setAudioPath('mix')
      } else {
        mix?.close()
        this.systemSoundDropped = true
        this.note('audio context did not start: recording the voice without the share sound')
      }
    }
    if (!audio && voice) {
      audio = voice
      this.setAudioPath('microphone')
    } else if (!audio && system.length > 0) {
      audio = system[0]!
      this.setAudioPath('system')
    }
    if (voice) this.startMeter(voice)
    return new MediaStream([...(video ? [video] : []), ...(audio ? [audio] : [])])
  }

  private setAudioPath(path: string): void {
    this.diag.capture.audioPath = path
    if (path !== 'none') this.note(`audio path ${path}`)
  }

  /** Elapsed recording time without paused stretches. */
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

  private startMeter(track: MediaStreamTrack | undefined): void {
    const onLevel = this.options.onLevel
    if (!track) return
    this.diag.capture.micTrackSampleRate = (typeof track.getSettings === 'function' ? track.getSettings().sampleRate : undefined) ?? null
    if (!onLevel || !this.audioContext) return
    const context = this.audioContext
    this.diag.capture.contextSampleRate = context.context.sampleRate
    this.meter = startLevelMeter(context.context, track, (level) => {
      onLevel(level)
      // A suspended context reads as silence; that says nothing about the microphone, so it is not counted.
      if (context.context.state === 'running' && this.phase === 'recording') this.micWatch.push(this.now() - this.diagStart, level)
    })
  }

  private micSilentOverall(): boolean {
    const range = this.micWatch.range()
    return !!range && range.samples >= 20 && range.max < NO_SIGNAL_LEVEL
  }

  private videoProblem(): VideoProblem | null {
    if (this.kind !== 'screen') return null
    if (this.released) return (this.diag.capture.videoProblem as VideoProblem | '') || null
    const frames = this.monitor?.framesSeen() ?? null
    const elapsed = this.accumulatedMs || this.elapsedMs()
    if (this.monitor && elapsed >= WARN_AFTER_MS && !this.monitor.hasPicture() && (frames === null || frames === 0)) return 'noFrames'
    const luma = this.lumaWatch.range()
    if (luma && luma.samples >= 3 && luma.max < BLACK_LUMA) return 'black'
    return null
  }

  /** Raises or clears the calm warnings; runs every 250 ms while recording. */
  private checkHealth(): void {
    if (this.phase !== 'recording') return
    const warn = this.options.onWarning
    if (!warn) return
    const micQuiet = this.audioContext?.context.state === 'running' && this.micWatch.isQuiet()
    if (micQuiet !== this.micWarned) {
      this.micWarned = micQuiet
      if (micQuiet) this.diag.capture.micSilentWarning = true
      warn({ kind: 'noMic', active: micQuiet })
    }
    const black = this.lumaWatch.isQuiet()
    if (black !== this.blackWarned) {
      this.blackWarned = black
      warn({ kind: 'black', active: black })
    }
    const noFrames = this.monitor !== null && this.elapsedMs() >= WARN_AFTER_MS && !this.monitor.hasPicture()
    if (noFrames !== this.noFramesWarned) {
      this.noFramesWarned = noFrames
      warn({ kind: 'noFrames', active: noFrames })
    }
  }

  /** Copies the measured values into the diagnostics. Cheap; called before the sources go away. */
  private refreshCapture(): void {
    if (this.released) return
    const c = this.diag.capture
    c.audioContext = [...(this.audioContext?.states ?? [])]
    c.micLevel = this.micWatch.range()
    c.luma = this.lumaWatch.range()
    c.framesSeen = this.monitor?.framesSeen() ?? null
    c.videoProblem = this.videoProblem() ?? ''
  }

  private clearTimers(): void {
    if (this.limitTimer !== null) clearInterval(this.limitTimer)
    this.limitTimer = null
    this.meter?.stop()
    this.meter = null
  }

  /** Stops the screen pipeline, every track (the browser's sharing indicator goes off) and the meter. Safe to call more than once. */
  private stopTracks(): void {
    this.clearTimers()
    this.refreshCapture()
    this.released = true
    if (this.pipeline && !this.diag.pipeline) this.diag.pipeline = this.pipeline.info()
    this.pipeline?.stop()
    this.pipeline = null
    this.monitor?.stop()
    this.monitor = null
    this.mix?.close()
    this.mix = null
    this.audioContext?.close()
    this.audioContext = null
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
