// Technical details of one recording, collected by the recorder and shown after a failure so they can be pasted
// into a bug report. Only technical facts: no window titles, URLs or file names. No DOM.

export interface DiagnosticEvent {
  /** Milliseconds since the recording started. */
  t: number
  what: string
}

export interface TrackSettingsInfo {
  kind: string
  readyState?: string
  width?: number
  height?: number
  frameRate?: number
  displaySurface?: string
  cursor?: string
}

export interface PipelineInfo {
  ticker: 'worker' | 'interval'
  canvasWidth: number
  canvasHeight: number
  framesDrawn: number
  /** True when frames are pushed with requestFrame(); false when the canvas stream captures every change. */
  manualFrames: boolean
}

/** What the recorder measured while recording and what the finished file measured afterwards. */
export interface CaptureDiagnostics {
  /** 'raw' (display track recorded directly) or 'canvas' (re-drawn); '' for sources without a screen. */
  videoPath: string
  /** Why this path: 'default', 'remembered after black picture', ... */
  videoPathReason: string
  /** 'noFrames' | 'black' | '' as seen while recording. */
  videoProblem: string
  /** How the sound got into the file: none, camera, microphone (direct), system (direct) or mix (Web Audio). */
  audioPath: string
  /** AudioContext states with the time they were seen, e.g. "running@0". Empty when no context was used. */
  audioContext: string[]
  contextSampleRate: number | null
  micTrackSampleRate: number | null
  /** Microphone RMS while recording; null when the meter never ran. */
  micLevel: { min: number; max: number; samples: number } | null
  micSilentWarning: boolean
  micDevices: number | null
  micDeviceRemembered: boolean
  /** Mean luma (0..255) of the sampled display pictures while recording; null without samples. */
  luma: { min: number; max: number; samples: number } | null
  /** Pictures the display track delivered to the monitor video; null where the browser cannot count. */
  framesSeen: number | null
  /** Measured on the finished file; null when the check did not run. */
  post: { audioTrack: boolean; audioPeak: number; audioRms: number; audioSeconds: number; frameLuma: number[] } | null
}

export function emptyCapture(): CaptureDiagnostics {
  return {
    videoPath: '',
    videoPathReason: '',
    videoProblem: '',
    audioPath: 'none',
    audioContext: [],
    contextSampleRate: null,
    micTrackSampleRate: null,
    micLevel: null,
    micSilentWarning: false,
    micDevices: null,
    micDeviceRemembered: false,
    luma: null,
    framesSeen: null,
    post: null
  }
}

export interface RecordDiagnostics {
  version: string
  userAgent: string
  kind: string
  mimeType: string
  mimeSupport: Record<string, boolean>
  tracks: TrackSettingsInfo[]
  pipeline: PipelineInfo | null
  chunkSizes: number[]
  events: DiagnosticEvent[]
  errors: { name: string; message: string }[]
  tracksAtStop: TrackSettingsInfo[]
  tracksAtEnd: TrackSettingsInfo[]
  elapsedMs: number
  capture: CaptureDiagnostics
}

const MAX_EVENTS = 80
const MAX_CHUNKS_LISTED = 30

export function emptyDiagnostics(): RecordDiagnostics {
  return {
    version: '',
    userAgent: '',
    kind: '',
    mimeType: '',
    mimeSupport: {},
    tracks: [],
    pipeline: null,
    chunkSizes: [],
    events: [],
    errors: [],
    tracksAtStop: [],
    tracksAtEnd: [],
    elapsedMs: 0,
    capture: emptyCapture()
  }
}

/** Appends an event; the list is bounded so a long recording cannot grow it without limit. */
export function addDiagnosticEvent(d: RecordDiagnostics, t: number, what: string): void {
  if (d.events.length < MAX_EVENTS) d.events.push({ t: Math.round(t), what })
}

const optional = (value: unknown): string => (value === undefined || value === null || value === '' ? '-' : String(value))

function formatTrack(track: TrackSettingsInfo): string {
  const size = track.width !== undefined || track.height !== undefined ? `${optional(track.width)}x${optional(track.height)}` : '-'
  const parts = [`${track.kind}`, `state=${optional(track.readyState)}`, `size=${size}`, `fps=${optional(track.frameRate)}`]
  if (track.displaySurface !== undefined) parts.push(`surface=${track.displaySurface}`)
  if (track.cursor !== undefined) parts.push(`cursor=${track.cursor}`)
  return parts.join(' ')
}

/** Plain text, one fact per line, for the "Technical details" box. */
export function formatDiagnostics(d: RecordDiagnostics): string {
  const lines: string[] = []
  lines.push(`Jelly Cut ${d.version || 'dev'}`)
  lines.push(`Browser: ${d.userAgent || '-'}`)
  lines.push(`Source: ${d.kind || '-'}, recorded ${Math.round(d.elapsedMs)} ms`)
  lines.push(`Format: ${d.mimeType || '-'}`)
  const support = Object.entries(d.mimeSupport).map(([type, ok]) => `${type}=${ok ? 'yes' : 'no'}`)
  lines.push(`Supported: ${support.length > 0 ? support.join(' ') : '-'}`)
  for (const track of d.tracks) lines.push(`Track: ${formatTrack(track)}`)
  if (d.pipeline) {
    const p = d.pipeline
    lines.push(`Canvas: ${p.canvasWidth}x${p.canvasHeight}, timer=${p.ticker}, frames drawn=${p.framesDrawn}, requestFrame=${p.manualFrames ? 'yes' : 'no'}`)
  } else {
    lines.push('Canvas: not used (direct recording)')
  }
  lines.push(...formatCapture(d.capture))
  const total = d.chunkSizes.reduce((sum, size) => sum + size, 0)
  const listed = d.chunkSizes.slice(0, MAX_CHUNKS_LISTED).join(',')
  const more = d.chunkSizes.length > MAX_CHUNKS_LISTED ? ',...' : ''
  lines.push(`Chunks: ${d.chunkSizes.length}, ${total} bytes [${listed}${more}]`)
  for (const track of d.tracksAtStop) lines.push(`At stop: ${formatTrack(track)}`)
  for (const track of d.tracksAtEnd) lines.push(`At end: ${formatTrack(track)}`)
  for (const error of d.errors) lines.push(`Error: ${error.name}: ${error.message}`)
  if (d.events.length > 0) {
    lines.push('Events:')
    for (const event of d.events) lines.push(`  ${event.t} ms ${event.what}`)
  }
  return lines.join('\n')
}

const fixed = (value: number, digits = 4): string => value.toFixed(digits)

function formatCapture(c: CaptureDiagnostics): string[] {
  const lines: string[] = []
  if (c.videoPath) {
    const problem = c.videoProblem || 'none'
    lines.push(`Video path: ${c.videoPath} (${c.videoPathReason || '-'}), problem=${problem}, frames seen=${c.framesSeen ?? 'n/a'}`)
    lines.push(c.luma ? `Picture luma: min=${fixed(c.luma.min, 1)} max=${fixed(c.luma.max, 1)} samples=${c.luma.samples}` : 'Picture luma: not sampled')
  }
  lines.push(`Audio path: ${c.audioPath}`)
  if (c.audioContext.length > 0) {
    lines.push(`AudioContext: ${c.audioContext.join(' ')} rate=${c.contextSampleRate ?? '-'} micTrackRate=${c.micTrackSampleRate ?? '-'}`)
  }
  if (c.micDevices !== null) lines.push(`Microphones: ${c.micDevices}, remembered choice used=${c.micDeviceRemembered ? 'yes' : 'no'}`)
  if (c.micLevel) {
    lines.push(`Mic level: min=${fixed(c.micLevel.min)} max=${fixed(c.micLevel.max)} samples=${c.micLevel.samples} no-signal warning=${c.micSilentWarning ? 'yes' : 'no'}`)
  }
  if (c.post) {
    const p = c.post
    lines.push(
      `File check: audio track=${p.audioTrack ? 'yes' : 'no'} peak=${fixed(p.audioPeak)} rms=${fixed(p.audioRms)} over ${fixed(p.audioSeconds, 1)} s, frame luma=[${p.frameLuma.map((v) => fixed(v, 1)).join(',')}]`
    )
  }
  return lines
}
