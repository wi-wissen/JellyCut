import { FallbackLog, isNearlyBlack, type FallbackReason } from '../../core/media/blank'
import type { Micros } from '../../core/time'

/** Exact pictures are compared with the element only this often per asset while they stay black. */
const MAX_BLACK_CHECKS = 3
const PROBE_SIZE = 16
const METADATA_TIMEOUT_MS = 4000
const SEEK_TIMEOUT_MS = 3000
/** Firefox fires 'seeked' before the new picture can be drawn; the frame callback tells when it can. */
const PRESENT_TIMEOUT_MS = 300

let probe: CanvasRenderingContext2D | null | undefined

/** True when the picture is black. Anything that cannot be read counts as not black (no needless fallback). */
export function looksBlack(source: CanvasImageSource): boolean {
  try {
    if (probe === undefined) {
      const canvas = document.createElement('canvas')
      canvas.width = PROBE_SIZE
      canvas.height = PROBE_SIZE
      probe = canvas.getContext('2d', { willReadFrequently: true })
    }
    if (!probe) return false
    probe.clearRect(0, 0, PROBE_SIZE, PROBE_SIZE)
    probe.drawImage(source, 0, 0, PROBE_SIZE, PROBE_SIZE)
    return isNearlyBlack(probe.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data)
  } catch {
    return false
  }
}

function once(target: EventTarget, events: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (result: string | null): void => {
      clearTimeout(timer)
      for (const name of events) target.removeEventListener(name, onEvent)
      resolve(result)
    }
    const onEvent = (event: Event): void => finish(event.type)
    const timer = setTimeout(() => finish(null), timeoutMs)
    for (const name of events) target.addEventListener(name, onEvent)
  })
}

/** Seeks a media element and waits until the picture at `seconds` can be drawn. False when that did not happen. */
export async function showElementFrameAt(el: HTMLVideoElement, seconds: number): Promise<boolean> {
  if (el.readyState < 1) {
    const event = await once(el, ['loadedmetadata', 'error'], METADATA_TIMEOUT_MS)
    if (event !== 'loadedmetadata' && el.readyState < 1) return false
  }
  el.pause()
  const limit = Number.isFinite(el.duration) ? el.duration : Infinity
  const target = Math.max(0, Math.min(seconds, limit))
  if (!el.seeking && el.readyState >= 2 && Math.abs(el.currentTime - target) < 0.0005) return true
  const seeked = once(el, ['seeked', 'error'], SEEK_TIMEOUT_MS)
  el.currentTime = target
  if ((await seeked) !== 'seeked') return false
  // The callback is registered after 'seeked' so it cannot be satisfied by the picture from before the seek.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, PRESENT_TIMEOUT_MS)
    if (!('requestVideoFrameCallback' in el)) return
    el.requestVideoFrameCallback(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  return el.readyState >= 2
}

export interface FallbackOps {
  isBlack(source: CanvasImageSource): boolean
  showAt(el: HTMLVideoElement, seconds: number): Promise<boolean>
  warn(message: string): void
}

const DOM_OPS: FallbackOps = {
  isBlack: looksBlack,
  showAt: showElementFrameAt,
  warn: (message) => console.warn(message)
}

/**
 * Safety net for paused pictures. The exact path (WebCodecs) can come back with nothing, with an error, or with a
 * black picture for files with unusual structure; the <video> element, which plays the same file, then supplies the
 * picture so the preview is never black. Used once per asset in the console, and visible through `assets`.
 */
export class ElementFallback {
  readonly log = new FallbackLog()
  /** Assets whose exact pictures were seen to be fine: no more black checks for them. */
  private verified = new Set<string>()
  private blackChecks = new Map<string, number>()

  constructor(private ops: FallbackOps = DOM_OPS) {}

  get assets(): string[] {
    return this.log.assets
  }

  private async show(el: HTMLVideoElement, srcTime: Micros): Promise<boolean> {
    try {
      return await this.ops.showAt(el, srcTime / 1_000_000)
    } catch {
      return false
    }
  }

  /**
   * The picture to draw: `exact` when it is usable, else the element's frame at `srcTime`.
   * `exact` is null when the exact path found nothing and `failed` when it threw. `element` returns the media
   * element of the asset, a new one when the previous one broke.
   */
  async pick<T extends CanvasImageSource>(
    assetId: string,
    srcTime: Micros,
    exact: T | null,
    failed: boolean,
    element: () => HTMLVideoElement | null
  ): Promise<T | HTMLVideoElement | null> {
    if (exact && !failed) {
      if (this.verified.has(assetId)) return exact
      const checks = this.blackChecks.get(assetId) ?? 0
      if (checks >= MAX_BLACK_CHECKS) return exact
      if (!this.ops.isBlack(exact)) {
        this.verified.add(assetId)
        return exact
      }
      this.blackChecks.set(assetId, checks + 1)
    }
    let el = element()
    if (!el) return exact
    let shown = await this.show(el, srcTime)
    if (!shown && el.error) {
      // A failed seek (seen with MediaRecorder WebM) leaves the element dead; the owner of the element makes a new one.
      const fresh = element()
      if (fresh && fresh !== el) {
        el = fresh
        shown = await this.show(el, srcTime)
      }
    }
    if (!shown) return exact
    // Both black: the picture really is black (a fade, a title card), the exact one stays.
    if (exact && !failed && this.ops.isBlack(el)) return exact
    const reason: FallbackReason = failed ? 'error' : exact ? 'black' : 'missing'
    if (this.log.note(assetId, reason)) {
      this.ops.warn(`[jellycut] paused picture of asset ${assetId} comes from the video element (exact decoding: ${reason})`)
    }
    return el
  }
}
