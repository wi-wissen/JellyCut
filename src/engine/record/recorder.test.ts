import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Recorder, RecordingError, STOP_EVENT_TIMEOUT_MS } from './recorder'

// Fakes for the browser media APIs: enough to drive the recorder's state machine without devices.
class FakeTrack {
  readyState: 'live' | 'ended' = 'live'
  private listeners = new Map<string, () => void>()
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, fn)
  }
  removeEventListener(type: string) {
    this.listeners.delete(type)
  }
  stop() {
    this.readyState = 'ended'
  }
  /** What the browser does when the source ends (shared screen stopped, device unplugged). */
  end() {
    this.readyState = 'ended'
    this.listeners.get('ended')?.()
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks
  }
  getAudioTracks() {
    return this.tracks.slice(0, 1)
  }
  getVideoTracks() {
    return this.tracks.slice(1)
  }
}

class FakeMediaRecorder {
  static supported = new Set(['audio/webm;codecs=opus', 'video/webm;codecs=vp9,opus'])
  static instances: FakeMediaRecorder[] = []
  /** A browser that delivers the last chunk but never fires 'stop'. */
  static silentStop = false
  static deliverNothing = false
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type)
  }
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  constructor(
    readonly stream: FakeStream,
    readonly options: { mimeType: string }
  ) {
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    if (!FakeMediaRecorder.deliverNothing) this.ondataavailable?.({ data: new Blob([new Uint8Array(512)]) })
    if (!FakeMediaRecorder.silentStop) this.onstop?.()
  }
}

let clock = 0
const tick = (ms: number) => {
  clock += ms
  vi.advanceTimersByTime(ms)
}

let getUserMedia: ReturnType<typeof vi.fn>
let getDisplayMedia: ReturnType<typeof vi.fn>
let tracks: FakeTrack[][]

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
  tracks = []
  FakeMediaRecorder.instances = []
  FakeMediaRecorder.silentStop = false
  FakeMediaRecorder.deliverNothing = false
  const mediaStream = (count: number) => {
    const list = Array.from({ length: count }, () => new FakeTrack())
    tracks.push(list)
    return new FakeStream(list)
  }
  getUserMedia = vi.fn(async (constraints: { video?: unknown }) => mediaStream(constraints.video ? 2 : 1))
  getDisplayMedia = vi.fn(async () => mediaStream(2))
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, getDisplayMedia } })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const options = (extra: Record<string, unknown> = {}) => ({ locale: 'de' as const, now: () => clock, ...extra })

describe('Recorder', () => {
  it('records the microphone and returns a named webm file, then stops every track', async () => {
    const recorder = new Recorder()
    await recorder.start('microphone', options())
    tick(1000)
    const file = await recorder.stop()
    expect(file.name).toMatch(/^Mikrofon \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.webm$/)
    expect(file.type).toBe('audio/webm')
    expect(file.size).toBeGreaterThan(0)
    expect(file.lastModified).toBeGreaterThan(0)
    expect(tracks[0]!.every((t) => t.readyState === 'ended')).toBe(true)
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: false }))
  })

  it('asks for picture and sound for the camera, with echo cancellation for the microphone', async () => {
    const recorder = new Recorder()
    await recorder.start('camera', options())
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }
    })
    expect(FakeMediaRecorder.instances[0]!.options.mimeType).toBe('video/webm;codecs=vp9,opus')
    recorder.cancel()
  })

  it('counts only the time while recording', async () => {
    const recorder = new Recorder()
    await recorder.start('microphone', options())
    tick(1000)
    recorder.pause()
    tick(5000)
    expect(recorder.elapsedMs()).toBe(1000)
    recorder.resume()
    tick(500)
    expect(recorder.elapsedMs()).toBe(1500)
    recorder.cancel()
  })

  it('discards on cancel: no file, tracks stopped, stop() then fails', async () => {
    const recorder = new Recorder()
    await recorder.start('microphone', options())
    tick(800)
    recorder.cancel()
    expect(tracks[0]!.every((t) => t.readyState === 'ended')).toBe(true)
    await expect(recorder.stop()).rejects.toThrow()
  })

  it('rejects an empty recording with a named error and still stops the tracks', async () => {
    const recorder = new Recorder()
    await recorder.start('microphone', options())
    const result = recorder.stop()
    await expect(result).rejects.toMatchObject({ name: 'EmptyRecordingError' })
    expect(tracks[0]!.every((t) => t.readyState === 'ended')).toBe(true)
  })

  it('finishes by itself at the safety limit and keeps the recording for stop()', async () => {
    const onAutoStop = vi.fn()
    const recorder = new Recorder()
    await recorder.start('microphone', options({ limitMs: 1000, onAutoStop }))
    for (let i = 0; i < 5; i++) tick(250)
    expect(onAutoStop).toHaveBeenCalledWith('limit')
    const file = await recorder.stop()
    expect(file.size).toBeGreaterThan(0)
    expect(tracks[0]!.every((t) => t.readyState === 'ended')).toBe(true)
  })

  it('finishes normally when the shared screen is stopped in the browser', async () => {
    const onAutoStop = vi.fn()
    const recorder = new Recorder()
    await recorder.start('screen', options({ onAutoStop }))
    tick(500)
    tracks[0]![1]!.end()
    expect(onAutoStop).toHaveBeenCalledWith('ended')
    const file = await recorder.stop()
    expect(file.name).toMatch(/^Bildschirm .*\.webm$/)
    expect(tracks[0]!.every((t) => t.readyState === 'ended')).toBe(true)
  })

  it('retries the screen without system audio when the browser refuses it', async () => {
    getDisplayMedia.mockImplementationOnce(async () => {
      throw new TypeError('audio not supported')
    })
    const recorder = new Recorder()
    await recorder.start('screen', options())
    expect(getDisplayMedia).toHaveBeenCalledTimes(2)
    expect(getDisplayMedia.mock.calls[1]![0]).toEqual({ video: true, audio: false })
    recorder.cancel()
  })

  it('passes a denied permission through with its browser name', async () => {
    getUserMedia.mockImplementationOnce(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    const recorder = new Recorder()
    await expect(recorder.start('camera', options())).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it('reports unsupported formats before asking for a device', async () => {
    FakeMediaRecorder.supported = new Set()
    try {
      const recorder = new Recorder()
      const started = recorder.start('microphone', options())
      await expect(started).rejects.toBeInstanceOf(RecordingError)
      await expect(started).rejects.toMatchObject({ name: 'UnsupportedRecordingError' })
      expect(getUserMedia).not.toHaveBeenCalled()
    } finally {
      FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus', 'video/webm;codecs=vp9,opus'])
    }
  })

  it('stops the tracks the moment stop() is called, before the recorder has answered', async () => {
    FakeMediaRecorder.silentStop = true
    const recorder = new Recorder()
    await recorder.start('screen', options())
    tick(1000)
    const result = recorder.stop()
    expect(tracks[0]!.every((t) => t.readyState === 'ended')).toBe(true)
    await vi.advanceTimersByTimeAsync(STOP_EVENT_TIMEOUT_MS)
    await result
  })

  it('does not hang when the recorder never fires stop: the recording is returned after the time limit', async () => {
    FakeMediaRecorder.silentStop = true
    const recorder = new Recorder()
    await recorder.start('screen', options())
    tick(1000)
    const result = recorder.stop()
    await vi.advanceTimersByTimeAsync(STOP_EVENT_TIMEOUT_MS)
    const file = await result
    expect(file.size).toBeGreaterThan(0)
  })

  it('reports an empty recording (not a hang) when no data ever arrives, and ends the share', async () => {
    FakeMediaRecorder.silentStop = true
    FakeMediaRecorder.deliverNothing = true
    const recorder = new Recorder()
    await recorder.start('screen', options())
    tick(1000)
    const result = recorder.stop()
    const assertion = expect(result).rejects.toMatchObject({ name: 'EmptyRecordingError' })
    await vi.advanceTimersByTimeAsync(STOP_EVENT_TIMEOUT_MS)
    await assertion
    expect(tracks[0]!.every((t) => t.readyState === 'ended')).toBe(true)
  })
})
