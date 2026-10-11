import { describe, expect, it } from 'vitest'
import { addDiagnosticEvent, emptyDiagnostics, formatDiagnostics } from './diagnostics'

describe('formatDiagnostics', () => {
  it('lists the facts needed to understand a recording without data', () => {
    const d = emptyDiagnostics()
    d.version = 'abc1234'
    d.userAgent = 'Firefox/130'
    d.kind = 'screen'
    d.mimeType = 'video/webm;codecs=vp8,opus'
    d.mimeSupport = { 'video/webm;codecs=vp9,opus': false, 'video/webm;codecs=vp8,opus': true }
    d.tracks = [{ kind: 'video', readyState: 'live', width: 1280, height: 720, frameRate: 30, displaySurface: 'window', cursor: 'never' }]
    d.pipeline = { ticker: 'worker', canvasWidth: 1280, canvasHeight: 720, framesDrawn: 1200, manualFrames: true }
    d.chunkSizes = [0, 1200]
    d.errors = [{ name: 'UnknownError', message: 'boom' }]
    d.elapsedMs = 41000
    addDiagnosticEvent(d, 12.4, 'start')
    const text = formatDiagnostics(d)
    expect(text).toContain('Jelly Cut abc1234')
    expect(text).toContain('video/webm;codecs=vp9,opus=no')
    expect(text).toContain('surface=window cursor=never')
    expect(text).toContain('timer=worker, frames drawn=1200')
    expect(text).toContain('requestFrame=yes')
    expect(text).toContain('Chunks: 2, 1200 bytes [0,1200]')
    expect(text).toContain('Error: UnknownError: boom')
    expect(text).toContain('  12 ms start')
  })

  it('handles an empty record and a missing pipeline', () => {
    const text = formatDiagnostics(emptyDiagnostics())
    expect(text).toContain('Jelly Cut dev')
    expect(text).toContain('Canvas: not used')
    expect(text).toContain('Chunks: 0, 0 bytes []')
  })

  it('bounds the number of events', () => {
    const d = emptyDiagnostics()
    for (let i = 0; i < 500; i++) addDiagnosticEvent(d, i, 'x')
    expect(d.events.length).toBeLessThanOrEqual(100)
  })

  it('reports the measured capture values, including the file check', () => {
    const d = emptyDiagnostics()
    d.capture = {
      ...d.capture,
      videoPath: 'raw',
      videoPathReason: 'default',
      videoProblem: 'black',
      audioPath: 'mix',
      audioContext: ['suspended@0', 'running@120'],
      contextSampleRate: 48000,
      micTrackSampleRate: 44100,
      micLevel: { min: 0, max: 0.2, samples: 90 },
      luma: { min: 0.5, max: 1.5, samples: 4 },
      framesSeen: 12,
      micDevices: 3,
      post: { audioTrack: true, audioPeak: 0.001, audioRms: 0.0004, audioSeconds: 4.2, frameLuma: [0.3, 0.4] }
    }
    const text = formatDiagnostics(d)
    expect(text).toContain('Video path: raw (default), problem=black, frames seen=12')
    expect(text).toContain('Picture luma: min=0.5 max=1.5 samples=4')
    expect(text).toContain('Audio path: mix')
    expect(text).toContain('AudioContext: suspended@0 running@120 rate=48000 micTrackRate=44100')
    expect(text).toContain('Mic level: min=0.0000 max=0.2000 samples=90')
    expect(text).toContain('File check: audio track=yes peak=0.0010 rms=0.0004 over 4.2 s, frame luma=[0.3,0.4]')
  })
})
