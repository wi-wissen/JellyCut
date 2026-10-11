import type { PipelineInfo } from '../../core/record/diagnostics'
import { FRAME_INTERVAL_MS, FrameGate, captureSize, sameSize, type CaptureSize } from '../../core/record/capture'
import type { TickIn } from './tick.worker'

/**
 * Why screen capture is re-drawn onto a canvas instead of recording the share directly: Firefox delivers display
 * frames only when the shared content changes, so a still window yields no frames at all and MediaRecorder never
 * produces data. A canvas stream with one requestFrame() per tick has a constant frame rate for any content.
 */

export interface ScreenPipeline {
  /** The canvas video track only; the recorder adds the (mixed) audio. */
  stream: MediaStream
  info(): PipelineInfo
  /** Draws one frame right now (used before the recorder is flushed so even a still picture has a frame). */
  drawNow(): void
  pause(): void
  resume(): void
  /** Stops ticking and releases the helper video and the canvas tracks. The share's own tracks are not touched. */
  stop(): void
}

type FrameTrack = MediaStreamTrack & { requestFrame?: () => void }

/** Ticks from a worker; falls back to setInterval where workers are unavailable (it is throttled in background tabs). */
export function startTicker(onTick: () => void, intervalMs = FRAME_INTERVAL_MS): { stop: () => void; kind: 'worker' | 'interval' } {
  if (typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = onTick
      const start: TickIn = { type: 'start', intervalMs }
      worker.postMessage(start)
      return {
        kind: 'worker',
        stop: () => {
          worker.onmessage = null
          worker.terminate()
        }
      }
    } catch {
      // fall through to the page timer
    }
  }
  const timer = setInterval(onTick, intervalMs)
  return { kind: 'interval', stop: () => clearInterval(timer) }
}

export function canCreateScreenPipeline(): boolean {
  if (typeof document === 'undefined') return false
  return typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

export function createScreenPipeline(display: MediaStream): ScreenPipeline | null {
  if (!canCreateScreenPipeline()) return null
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return null

  const settings = display.getVideoTracks()[0]?.getSettings()
  let size: CaptureSize = captureSize(settings?.width ?? 0, settings?.height ?? 0)
  canvas.width = size.width
  canvas.height = size.height
  context.fillStyle = '#000'
  context.fillRect(0, 0, size.width, size.height)

  const canvasStream = canvas.captureStream(0)
  const canvasTrack = canvasStream.getVideoTracks()[0] as FrameTrack | undefined
  if (!canvasTrack) return null
  // Without requestFrame the stream captures on every canvas change, which the per-tick draw provides as well.
  const manual = typeof canvasTrack.requestFrame === 'function'
  const stream = new MediaStream([canvasTrack])

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream(display.getVideoTracks())
  void video.play().catch(() => undefined)

  // Counts the pictures the share really delivered, to tell "no frames from the browser" from "no data from the recorder".
  const startedAt = performance.now()
  const seen: number[] = []
  let seenTotal = 0
  let seenFirstSecond = 0
  const frameApi = typeof video.requestVideoFrameCallback === 'function'
  const watchFrames = (): void => {
    if (!frameApi) return
    video.requestVideoFrameCallback(() => {
      const now = performance.now()
      seenTotal++
      if (now - startedAt < 1000) seenFirstSecond++
      seen.push(now)
      if (seen.length > 200) seen.shift()
      if (running) watchFrames()
    })
  }
  let framesDrawn = 0

  const gate = new FrameGate()
  let running = true
  let paused = false

  const draw = (): void => {
    if (!running) return
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const next = captureSize(video.videoWidth, video.videoHeight)
      if (!sameSize(next, size)) {
        size = next
        canvas.width = size.width
        canvas.height = size.height
      }
      context.drawImage(video, 0, 0, size.width, size.height)
    }
    framesDrawn++
    if (manual) canvasTrack.requestFrame?.()
  }

  watchFrames()
  const ticker = startTicker(() => {
    if (!paused && gate.due(performance.now())) draw()
  })
  draw()

  return {
    stream,
    info: () => ({
      ticker: ticker.kind,
      canvasWidth: size.width,
      canvasHeight: size.height,
      framesDrawn,
      videoFrames: frameApi
        ? { total: seenTotal, firstSecond: seenFirstSecond, lastSecond: seen.filter((t) => t > performance.now() - 1000).length }
        : null
    }),
    drawNow: draw,
    pause() {
      paused = true
    },
    resume() {
      gate.reset()
      paused = false
    },
    stop() {
      running = false
      ticker.stop()
      video.pause()
      video.srcObject = null
      canvasStream.getTracks().forEach((track) => track.stop())
    }
  }
}
