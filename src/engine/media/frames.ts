import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny'
import type { Micros } from '../../core/time'

export type DecodedFrame = HTMLCanvasElement | OffscreenCanvas | ImageBitmap

interface VideoEntry {
  kind: 'video'
  input: Input
  track: InputVideoTrack
  sink: CanvasSink
  /** Last returned frame, reused while the requested time stays inside it. */
  last: { canvas: DecodedFrame; start: Micros; end: Micros } | null
}
interface ImageEntry {
  kind: 'image'
  bitmap: ImageBitmap
}
type Entry = VideoEntry | ImageEntry

/**
 * Containers quantise timestamps (WebM uses whole milliseconds), so a time computed on the project's
 * frame grid can fall a hair before the frame that is meant. Looking up slightly later fixes that and
 * stays far below half a frame for every realistic frame rate (up to ~300 fps).
 */
export const FRAME_LOOKUP_TOLERANCE: Micros = 1500

/**
 * Frame-exact access to media files through WebCodecs (decodes from the previous keyframe).
 * Used for paused preview, single-frame stepping and export. Playback uses <video> elements instead.
 */
export class ExactFrameProvider {
  private entries = new Map<string, Promise<Entry | null>>()
  private files = new Map<string, { file: File; isImage: boolean }>()

  setFile(assetId: string, file: File, isImage: boolean): void {
    this.files.set(assetId, { file, isImage })
    // A lookup made before the file existed cached "no decoder"; drop it so the next lookup decodes the file.
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${assetId}|`)) continue
      this.entries.delete(key)
      void entry.then((e) => (e?.kind === 'video' ? e.input.dispose() : undefined))
    }
  }

  hasFile(assetId: string): boolean {
    return this.files.has(assetId)
  }

  private open(assetId: string, lane: string): Promise<Entry | null> {
    const key = `${assetId}|${lane}`
    let entry = this.entries.get(key)
    if (!entry) {
      entry = this.create(assetId)
      this.entries.set(key, entry)
    }
    return entry
  }

  private async create(assetId: string): Promise<Entry | null> {
    const source = this.files.get(assetId)
    if (!source) return null
    if (source.isImage) {
      return { kind: 'image', bitmap: await createImageBitmap(source.file) }
    }
    const input = new Input({ source: new BlobSource(source.file), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) {
      input.dispose()
      return null
    }
    return { kind: 'video', input, track, sink: new CanvasSink(track), last: null }
  }

  /**
   * Returns the frame shown at `srcTime` of the asset, or null when it cannot be decoded.
   * Each `lane` has its own decoder, so two layers showing the same file (both sides of a transition)
   * do not keep pulling the decoder back and forth.
   */
  async getFrame(assetId: string, srcTime: Micros, lane = ''): Promise<DecodedFrame | null> {
    const entry = await this.open(assetId, lane)
    if (!entry) return null
    if (entry.kind === 'image') return entry.bitmap

    const lookup = srcTime + FRAME_LOOKUP_TOLERANCE
    const last = entry.last
    if (last && lookup >= last.start && lookup < last.end) return last.canvas

    const wrapped = await entry.sink.getCanvas(lookup / 1_000_000)
    if (!wrapped) return null
    const start = Math.round(wrapped.timestamp * 1_000_000)
    const end = start + Math.max(1, Math.round(wrapped.duration * 1_000_000))
    entry.last = { canvas: wrapped.canvas, start, end }
    return wrapped.canvas
  }

  /**
   * The real time span (microseconds in the source file) of the frame shown at `srcTime`.
   * Cuts must land on these, not on a computed frame grid, because container timestamps are quantised.
   * Images have no frames: they return null.
   */
  async getFrameInfo(assetId: string, srcTime: Micros, lane = ''): Promise<{ start: Micros; end: Micros } | null> {
    const entry = await this.open(assetId, lane)
    if (!entry || entry.kind === 'image') return null
    const frame = await this.getFrame(assetId, srcTime, lane)
    return frame && entry.last ? { start: entry.last.start, end: entry.last.end } : null
  }

  async dispose(): Promise<void> {
    const all = await Promise.all(this.entries.values())
    for (const entry of all) {
      if (entry?.kind === 'video') entry.input.dispose()
      if (entry?.kind === 'image') entry.bitmap.close()
    }
    this.entries.clear()
    this.files.clear()
  }
}
