import type { PipelineInfo } from '../../core/record/diagnostics'
import { FRAME_INTERVAL_MS, FrameGate, captureSize, sameSize, type CaptureSize } from '../../core/record/capture'
import type { TickIn } from './tick.worker'

/**
 * The fallback way for a screen share: the picture is re-drawn onto a canvas at a constant 30 fps and the canvas
 * stream is recorded. Slower and heavier than recording the display track itself (see recorder.ts), so it is only
 * used after a recording showed that the direct way delivers no pictures or only black ones.
 */

export interface ScreenPipeline {
  /** The canvas video track only; the recorder adds the audio. */
  stream: MediaStream
  info(): PipelineInfo
  /** Draws one frame right now (used before the recorder is flushed so even a still picture has a frame). */
  drawNow(): void
  pause(): void
  resume(): void
  /** Stops ticking and releases the canvas tracks. The share's own tracks and the source video are not touched. */
  stop(): void
}

/** Firefox has requestFrame() on the stream only, Chromium on the track only. */
type FrameTrack = MediaStreamTrack & { requestFrame?: () => void }
type FrameStream = MediaStream & { requestFrame?: () => void }

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

/** `video` plays the display track and stays owned by the caller. */
export function createScreenPipeline(video: HTMLVideoElement, displayTrack: MediaStreamTrack): ScreenPipeline | null {
  if (!canCreateScreenPipeline()) return null
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return null

  const settings = displayTrack.getSettings()
  let size: CaptureSize = captureSize(video.videoWidth || settings.width || 0, video.videoHeight || settings.height || 0)
  canvas.width = size.width
  canvas.height = size.height
  context.fillStyle = '#000'
  context.fillRect(0, 0, size.width, size.height)

  // Manual capture (frame rate 0 + requestFrame) when this browser offers requestFrame on the track or the stream.
  // Without it a frame-rate-0 stream would never capture anything, so the stream captures every canvas change instead.
  let canvasStream = canvas.captureStream(0) as FrameStream
  let canvasTrack = canvasStream.getVideoTracks()[0] as FrameTrack | undefined
  if (!canvasTrack) return null
  let requestFrame: (() => void) | null =
    typeof canvasTrack.requestFrame === 'function'
      ? () => (canvasTrack as FrameTrack).requestFrame?.()
      : typeof canvasStream.requestFrame === 'function'
        ? () => (canvasStream as FrameStream).requestFrame?.()
        : null
  if (!requestFrame) {
    canvasTrack.stop()
    canvasStream = canvas.captureStream() as FrameStream
    canvasTrack = canvasStream.getVideoTracks()[0] as FrameTrack | undefined
    if (!canvasTrack) return null
    requestFrame = null
  }
  const stream = new MediaStream([canvasTrack])

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
    requestFrame?.()
  }

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
      manualFrames: requestFrame !== null
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
      canvasStream.getTracks().forEach((track) => track.stop())
    }
  }
}
