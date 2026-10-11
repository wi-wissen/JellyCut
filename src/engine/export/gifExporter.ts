import { buildPalette } from '../../core/gif/quantize'
import { GifWriter } from '../../core/gif/writer'
import { gifOutputSize, gifTooLarge, totalFrames, type GifOptions } from '../../core/export/presets'
import type { Project } from '../../core/project/types'
import { planTimeline } from '../../core/render/scene'
import { frameStart } from '../../core/time'
import { ExportEta } from '../../core/export/eta'
import { Compositor } from '../render/compositor'
import { ExportCancelled, ExportUnsupported, createFrameProvider, drawFrame, projectDuration, type ExportControl, type ExportProgress } from './exporter'

export interface GifExportRequest {
  kind: 'gif'
  project: Project
  /** Files by asset id, as for the MP4 export. */
  files: Record<string, File>
  options: GifOptions
}

export interface GifResult {
  blob: Blob
  mimeType: 'image/gif'
  extension: 'gif'
  frames: number
  width: number
  height: number
  elapsedMs: number
}

/** The export is refused before it starts: too long or too large (see gifTooLarge). */
export class GifTooLarge extends Error {
  constructor() {
    super('GIFs get huge: please pick a shorter section or a lower size')
    this.name = 'GifTooLarge'
  }
}

/** Frames rendered before the encoding starts, spread over the whole length, for one palette for all frames. */
const PALETTE_SAMPLES = 12

/** Evenly spaced frame numbers across the export, the middle of each part of the length. */
export function paletteSampleFrames(frames: number, count = PALETTE_SAMPLES): number[] {
  const n = Math.min(frames, count)
  return Array.from({ length: n }, (_, k) => Math.floor(((k + 0.5) * frames) / n))
}

/**
 * Renders the project as an animated GIF at the chosen width and frame rate. Same planner, scene and
 * compositor as the MP4 export; the frames are read back from the canvas and encoded with GifWriter.
 */
export async function runGifExport(
  request: GifExportRequest,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  control: ExportControl = { hidden: false }
): Promise<GifResult> {
  const started = performance.now()
  const { project, options } = request
  const planned = planTimeline(project)
  const duration = projectDuration(project, planned)
  if (duration <= 0) throw new ExportUnsupported('The project is empty.')

  const { width, height } = gifOutputSize(project.format.ratio, options.width)
  const fps = options.fps
  if (gifTooLarge(duration, width, height, fps)) throw new GifTooLarge()
  const frames = totalFrames(duration, fps)
  const samples = paletteSampleFrames(frames)
  const total = samples.length + frames

  const provider = createFrameProvider(project, request.files)
  const canvas = new OffscreenCanvas(width, height)
  const compositor = new Compositor(canvas)
  compositor.resize(width, height)
  const readback = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (!readback) throw new Error('A 2D canvas is not available')

  let done = 0
  const eta = new ExportEta(null, total)
  const report = (): void => {
    const elapsedMs = performance.now() - started
    onProgress({
      frame: done,
      totalFrames: total,
      fraction: done / total,
      elapsedMs,
      etaMs: eta.update(elapsedMs, done, control.hidden)
    })
  }
  // WebGL output is read through a 2D canvas: getImageData gives the unpremultiplied RGBA of the frame.
  const capture = async (index: number): Promise<Uint8ClampedArray> => {
    if (signal.aborted) throw new ExportCancelled()
    await drawFrame(compositor, provider, project, planned, frameStart(index, fps))
    readback.drawImage(canvas, 0, 0)
    return readback.getImageData(0, 0, width, height).data
  }

  try {
    const sampled: Uint8ClampedArray[] = []
    for (const index of samples) {
      sampled.push(await capture(index))
      done++
      report()
    }
    const palette = buildPalette(sampled, 255)
    sampled.length = 0

    const writer = new GifWriter({ width, height, palette, frameRate: fps, loop: options.loop, differencing: true })
    const chunks: Uint8Array[] = [writer.header()]
    for (let i = 0; i < frames; i++) {
      chunks.push(writer.addFrame(await capture(i)))
      done++
      report()
    }
    chunks.push(writer.finish())
    if (signal.aborted) throw new ExportCancelled()

    return {
      blob: new Blob(chunks as BlobPart[], { type: 'image/gif' }),
      mimeType: 'image/gif',
      extension: 'gif',
      frames,
      width,
      height,
      elapsedMs: performance.now() - started
    }
  } finally {
    compositor.dispose()
    await provider.dispose()
  }
}

/** The GIF request is the one whose options are GIF options; the MP4 request keeps its shape. */
export function isGifRequest(request: { options: { format: string } }): request is GifExportRequest {
  return request.options.format === 'gif'
}
