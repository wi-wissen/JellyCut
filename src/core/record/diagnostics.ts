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
  /** Video frames the hidden <video> presented (requestVideoFrameCallback); null where the browser has no such API. */
  videoFrames: { total: number; firstSecond: number; lastSecond: number } | null
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
    elapsedMs: 0
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
    lines.push(`Canvas: ${p.canvasWidth}x${p.canvasHeight}, timer=${p.ticker}, frames drawn=${p.framesDrawn}`)
    lines.push(
      p.videoFrames
        ? `Video frames seen: total=${p.videoFrames.total} first second=${p.videoFrames.firstSecond} last second=${p.videoFrames.lastSecond}`
        : 'Video frames seen: not measurable'
    )
  } else {
    lines.push('Canvas: not used (direct recording)')
  }
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
