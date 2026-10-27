/**
 * Some browsers (Firefox) give WebGL the unrotated pixels of a <video> whose file says "rotate by 90 degrees"
 * (phone recordings) while videoWidth and drawImage() already include the rotation: the picture then plays on its
 * side and squeezed. Such an element is drawn through a 2D canvas, which has the rotation right everywhere.
 * Each element is checked once by comparing what WebGL would get (createImageBitmap) with what drawImage shows.
 */
type Verdict = 'ok' | 'turned'

const SAMPLE = 16
/** A picture with less contrast than this (black first frames) cannot tell the orientations apart. */
const MIN_CONTRAST = 24
const MAX_MEAN_DIFF = 28
const RETRY_MS = 400

const verdicts = new WeakMap<HTMLVideoElement, Verdict>()
const checking = new WeakMap<HTMLVideoElement, number>()
const staging = new WeakMap<HTMLVideoElement, HTMLCanvasElement>()

function lumaOf(source: CanvasImageSource): Uint8Array | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, SAMPLE, SAMPLE)
  const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
  const luma = new Uint8Array(SAMPLE * SAMPLE)
  for (let i = 0; i < luma.length; i++) luma[i] = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!)
  return luma
}

async function judge(el: HTMLVideoElement): Promise<Verdict | null> {
  const bitmap = await createImageBitmap(el)
  try {
    if (el.videoWidth !== el.videoHeight && bitmap.width === el.videoHeight && bitmap.height === el.videoWidth) return 'turned'
    const shown = lumaOf(el)
    const raw = lumaOf(bitmap)
    if (!shown || !raw) return 'ok'
    if (Math.max(...shown) - Math.min(...shown) < MIN_CONTRAST) return null
    let diff = 0
    for (let i = 0; i < shown.length; i++) diff += Math.abs(shown[i]! - raw[i]!)
    return diff / shown.length > MAX_MEAN_DIFF ? 'turned' : 'ok'
  } finally {
    bitmap.close()
  }
}

function check(el: HTMLVideoElement): void {
  const now = performance.now()
  if (now - (checking.get(el) ?? -Infinity) < RETRY_MS) return
  checking.set(el, now)
  judge(el).then(
    (verdict) => {
      if (verdict) verdicts.set(el, verdict)
    },
    () => verdicts.set(el, 'ok')
  )
}

/** The source to hand to WebGL: the element itself when its pixels are right, otherwise a canvas copy of the frame. */
export function glSource<T extends CanvasImageSource>(source: T): T | HTMLCanvasElement {
  if (typeof HTMLVideoElement === 'undefined' || !(source instanceof HTMLVideoElement)) return source
  if (verdicts.get(source) === 'ok') return source
  if (!verdicts.has(source)) check(source)
  const w = source.videoWidth
  const h = source.videoHeight
  if (!(w > 0 && h > 0)) return source
  let canvas = staging.get(source)
  if (!canvas) {
    canvas = document.createElement('canvas')
    staging.set(source, canvas)
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  canvas.getContext('2d')?.drawImage(source, 0, 0, w, h)
  return canvas
}
