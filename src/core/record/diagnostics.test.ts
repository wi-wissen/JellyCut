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
    d.pipeline = { ticker: 'worker', canvasWidth: 1280, canvasHeight: 720, framesDrawn: 1200, videoFrames: { total: 1, firstSecond: 1, lastSecond: 0 } }
    d.chunkSizes = [0, 1200]
    d.errors = [{ name: 'UnknownError', message: 'boom' }]
    d.elapsedMs = 41000
    addDiagnosticEvent(d, 12.4, 'start')
    const text = formatDiagnostics(d)
    expect(text).toContain('Jelly Cut abc1234')
    expect(text).toContain('video/webm;codecs=vp9,opus=no')
    expect(text).toContain('surface=window cursor=never')
    expect(text).toContain('timer=worker, frames drawn=1200')
    expect(text).toContain('total=1 first second=1 last second=0')
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
})
