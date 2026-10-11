import { meanLuma } from '../../core/record/signal'

/**
 * Watches a display video track while it is recorded: counts the pictures it delivers and samples how bright they are,
 * so a share that delivers nothing or only black can be reported. The helper <video> is attached to the page (a
 * 2 px, almost transparent corner): detached or display:none elements are the first thing browsers stop decoding.
 * The canvas fallback draws from the same element.
 */
export interface DisplayMonitor {
  video: HTMLVideoElement
  /** Resolves when the first picture is presented, or after a short bounded wait (never rejects). */
  ready: Promise<void>
  /** Pictures presented so far; null where the browser has no requestVideoFrameCallback. */
  framesSeen(): number | null
  /** True once the element has a picture size, i.e. the share delivered at least one picture. */
  hasPicture(): boolean
  /** Mean luma of the latest samples; samples are taken about once per second. */
  onLuma(listener: (timeMs: number, luma: number) => void): void
  stop(): void
}

const SAMPLE_MS = 1000
const READY_WAIT_MS = 1500
const SAMPLE_SIZE = 8

export function createDisplayMonitor(track: MediaStreamTrack): DisplayMonitor | null {
  if (typeof document === 'undefined' || !document.body) return null
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('aria-hidden', 'true')
  video.tabIndex = -1
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none'
  video.srcObject = new MediaStream([track])
  document.body.append(video)
  void video.play().catch(() => undefined)

  const scratch = document.createElement('canvas')
  scratch.width = SAMPLE_SIZE
  scratch.height = SAMPLE_SIZE
  const context = scratch.getContext('2d', { willReadFrequently: true })

  let running = true
  let frames: number | null = null
  const frameApi = typeof video.requestVideoFrameCallback === 'function'
  let onFirst: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    onFirst = resolve
    setTimeout(resolve, READY_WAIT_MS)
  })
  if (frameApi) {
    frames = 0
    const watch = (): void => {
      video.requestVideoFrameCallback(() => {
        frames = (frames ?? 0) + 1
        onFirst()
        if (running) watch()
      })
    }
    watch()
  } else {
    video.addEventListener('loadeddata', () => onFirst(), { once: true })
  }

  const listeners: Array<(timeMs: number, luma: number) => void> = []
  const startedAt = performance.now()
  const timer = setInterval(() => {
    if (!running || !context || video.readyState < 2 || video.videoWidth === 0) return
    try {
      context.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const luma = meanLuma(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data)
      const now = performance.now() - startedAt
      for (const listener of listeners) listener(now, luma)
    } catch {
      // a frame that cannot be read is simply not sampled
    }
  }, SAMPLE_MS)

  return {
    video,
    ready,
    framesSeen: () => frames,
    hasPicture: () => video.videoWidth > 0 && video.readyState >= 2,
    onLuma: (listener) => {
      listeners.push(listener)
    },
    stop() {
      running = false
      clearInterval(timer)
      video.pause()
      video.srcObject = null
      video.remove()
    }
  }
}
