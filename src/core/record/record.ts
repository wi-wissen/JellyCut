// Pure helpers for the Record tab: file names, time labels, codec choice and error mapping. No DOM.

export type RecordKind = 'microphone' | 'camera' | 'screen'
export type RecordLocale = 'de' | 'en'

export const RECORD_KINDS: readonly RecordKind[] = ['microphone', 'camera', 'screen']

export interface RecordCapabilities {
  userMedia: boolean
  displayMedia: boolean
  mediaRecorder: boolean
}

/** Recordings are capped at two hours; the recorder stops by itself at the limit. */
export const DEFAULT_LIMIT_MS = 2 * 60 * 60 * 1000

/** Shorter recordings are treated as empty: a stop right after the start produces no usable file. */
export const MIN_RECORDING_MS = 100

const KIND_NAMES: Record<RecordLocale, Record<RecordKind, string>> = {
  de: { microphone: 'Mikrofon', camera: 'Kamera', screen: 'Bildschirm' },
  en: { microphone: 'Microphone', camera: 'Camera', screen: 'Screen' }
}

const MIME_PREFERENCES: Record<'audio' | 'video', readonly string[]> = {
  audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
  video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
}

const KNOWN_EXTENSIONS = new Set(['webm', 'mp4', 'ogg'])

const pad = (value: number): string => String(value).padStart(2, '0')

/** "Mikrofon 2026-10-11 14-03-22.webm": local time, so the name matches what the student saw on the clock. */
export function recordingFileName(kind: RecordKind, date: Date, locale: RecordLocale, extension = 'webm'): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `${KIND_NAMES[locale][kind]} ${day} ${time}.${extension}`
}

/** Elapsed time as m:ss ("0:07", "12:05"). Fractions are dropped, negative or invalid input shows 0:00. */
export function formatRecordTime(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  return `${Math.floor(totalSeconds / 60)}:${pad(totalSeconds % 60)}`
}

/** First supported container and codec for the kind, or null when the browser can record none of them. */
export function pickMimeType(kind: RecordKind, isTypeSupported: (type: string) => boolean): string | null {
  const candidates = MIME_PREFERENCES[kind === 'microphone' ? 'audio' : 'video']
  return candidates.find((type) => isTypeSupported(type)) ?? null
}

/** File extension for a recorded MIME type; codec parameters are ignored. Unknown types fall back to webm. */
export function extensionForMime(mime: string): string {
  const subtype = mime.split(';')[0]!.trim().split('/')[1]?.toLowerCase() ?? ''
  return KNOWN_EXTENSIONS.has(subtype) ? subtype : 'webm'
}

/** Error names come from the browser (DOMException) or from the recorder itself. */
export type RecordErrorKey =
  | 'record.error.permission'
  | 'record.error.noDevice'
  | 'record.error.busy'
  | 'record.error.aborted'
  | 'record.error.empty'
  | 'record.error.unsupported'
  | 'record.error.generic'

export function friendlyRecordError(errorName: string): RecordErrorKey {
  switch (errorName) {
    case 'NotAllowedError':
      return 'record.error.permission'
    case 'NotFoundError':
      return 'record.error.noDevice'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'record.error.busy'
    case 'AbortError':
      return 'record.error.aborted'
    case 'EmptyRecordingError':
      return 'record.error.empty'
    case 'UnsupportedRecordingError':
      return 'record.error.unsupported'
    default:
      return 'record.error.generic'
  }
}

/** Screen capture is missing on iPads and phones; the button is hidden there instead of failing later. */
export function canRecordKind(kind: RecordKind, caps: RecordCapabilities): boolean {
  if (!caps.mediaRecorder) return false
  return kind === 'screen' ? caps.displayMedia : caps.userMedia
}

export function isEmptyRecording(sizeBytes: number, activeMs: number): boolean {
  return sizeBytes <= 0 || activeMs < MIN_RECORDING_MS
}
