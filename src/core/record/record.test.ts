import { describe, expect, it } from 'vitest'
import {
  canRecordKind,
  extensionForMime,
  formatRecordTime,
  friendlyRecordError,
  isEmptyRecording,
  pickMimeType,
  recordingFileName
} from './record'

describe('recordingFileName', () => {
  const date = new Date(2026, 9, 11, 14, 3, 22)

  it('builds the German name with local date and time', () => {
    expect(recordingFileName('microphone', date, 'de', 'webm')).toBe('Mikrofon 2026-10-11 14-03-22.webm')
    expect(recordingFileName('camera', date, 'de', 'mp4')).toBe('Kamera 2026-10-11 14-03-22.mp4')
    expect(recordingFileName('screen', date, 'de')).toBe('Bildschirm 2026-10-11 14-03-22.webm')
  })

  it('uses English kind names for the English locale', () => {
    expect(recordingFileName('microphone', date, 'en')).toBe('Microphone 2026-10-11 14-03-22.webm')
    expect(recordingFileName('screen', date, 'en')).toBe('Screen 2026-10-11 14-03-22.webm')
  })

  it('zero-pads single digit fields', () => {
    expect(recordingFileName('camera', new Date(2026, 0, 2, 9, 5, 7), 'en')).toBe('Camera 2026-01-02 09-05-07.webm')
  })
})

describe('formatRecordTime', () => {
  it('formats m:ss and drops fractions', () => {
    expect(formatRecordTime(7000)).toBe('0:07')
    expect(formatRecordTime(7999)).toBe('0:07')
    expect(formatRecordTime(65_000)).toBe('1:05')
    expect(formatRecordTime(0)).toBe('0:00')
  })

  it('keeps counting past an hour in minutes', () => {
    expect(formatRecordTime(61 * 60_000 + 1000)).toBe('61:01')
  })

  it('clamps negative and invalid input to zero', () => {
    expect(formatRecordTime(-500)).toBe('0:00')
    expect(formatRecordTime(Number.NaN)).toBe('0:00')
  })
})

describe('pickMimeType', () => {
  const only = (...types: string[]) => (type: string) => types.includes(type)

  it('prefers opus audio in webm for microphones', () => {
    expect(pickMimeType('microphone', () => true)).toBe('audio/webm;codecs=opus')
    expect(pickMimeType('microphone', only('audio/webm', 'audio/mp4'))).toBe('audio/webm')
    expect(pickMimeType('microphone', only('audio/mp4'))).toBe('audio/mp4')
  })

  it('prefers vp9 then vp8 then plain webm, then mp4, for camera and screen', () => {
    expect(pickMimeType('camera', () => true)).toBe('video/webm;codecs=vp9,opus')
    expect(pickMimeType('screen', only('video/webm;codecs=vp8,opus', 'video/mp4'))).toBe('video/webm;codecs=vp8,opus')
    expect(pickMimeType('camera', only('video/webm', 'video/mp4'))).toBe('video/webm')
    expect(pickMimeType('camera', only('video/mp4'))).toBe('video/mp4')
  })

  it('never offers a video type for the microphone', () => {
    expect(pickMimeType('microphone', only('video/webm', 'video/mp4'))).toBeNull()
  })

  it('returns null when nothing is supported', () => {
    expect(pickMimeType('camera', () => false)).toBeNull()
  })
})

describe('extensionForMime', () => {
  it('returns the container without codec parameters', () => {
    expect(extensionForMime('video/webm;codecs=vp9,opus')).toBe('webm')
    expect(extensionForMime('audio/mp4')).toBe('mp4')
    expect(extensionForMime('audio/ogg;codecs=opus')).toBe('ogg')
  })

  it('falls back to webm for unknown types', () => {
    expect(extensionForMime('')).toBe('webm')
    expect(extensionForMime('video/x-matroska')).toBe('webm')
  })
})

describe('friendlyRecordError', () => {
  it('maps the browser error names to specific messages', () => {
    expect(friendlyRecordError('NotAllowedError')).toBe('record.error.permission')
    expect(friendlyRecordError('NotFoundError')).toBe('record.error.noDevice')
    expect(friendlyRecordError('NotReadableError')).toBe('record.error.busy')
    expect(friendlyRecordError('TrackStartError')).toBe('record.error.busy')
    expect(friendlyRecordError('AbortError')).toBe('record.error.aborted')
  })

  it('maps recorder errors', () => {
    expect(friendlyRecordError('EmptyRecordingError')).toBe('record.error.empty')
    expect(friendlyRecordError('UnsupportedRecordingError')).toBe('record.error.unsupported')
    expect(friendlyRecordError('TimeoutError')).toBe('record.error.timeout')
  })

  it('falls back to the generic message for security errors and anything else', () => {
    expect(friendlyRecordError('SecurityError')).toBe('record.error.generic')
    expect(friendlyRecordError('NotAllowedError ')).toBe('record.error.generic')
    expect(friendlyRecordError('')).toBe('record.error.generic')
  })
})

describe('canRecordKind', () => {
  const full = { userMedia: true, displayMedia: true, mediaRecorder: true }

  it('offers all kinds on a desktop browser', () => {
    expect(canRecordKind('microphone', full)).toBe(true)
    expect(canRecordKind('camera', full)).toBe(true)
    expect(canRecordKind('screen', full)).toBe(true)
  })

  it('hides screen capture when getDisplayMedia is missing, keeping the others', () => {
    const ipad = { ...full, displayMedia: false }
    expect(canRecordKind('screen', ipad)).toBe(false)
    expect(canRecordKind('camera', ipad)).toBe(true)
    expect(canRecordKind('microphone', ipad)).toBe(true)
  })

  it('hides everything without MediaRecorder or without getUserMedia', () => {
    expect(canRecordKind('camera', { ...full, mediaRecorder: false })).toBe(false)
    expect(canRecordKind('microphone', { ...full, userMedia: false })).toBe(false)
  })
})

describe('isEmptyRecording', () => {
  it('is empty without bytes or without active time', () => {
    expect(isEmptyRecording(0, 5000)).toBe(true)
    expect(isEmptyRecording(4096, 0)).toBe(true)
    expect(isEmptyRecording(4096, 99)).toBe(true)
  })

  it('accepts a recording with bytes and at least 100 ms', () => {
    expect(isEmptyRecording(4096, 100)).toBe(false)
  })
})
