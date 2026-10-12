import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input, type InputVideoTrack, type WrappedCanvas } from 'mediabunny'
import { FRAME_LOOKUP_TOLERANCE, frameEnd, lookupTime, spanCovers } from '../../core/media/frameLookup'
import { isSparseGap, type ScanWant } from '../../core/media/scanPlan'
import { TimedCache } from '../../core/media/timedCache'
import { SparseReader, type CachedFrame, type ScanHint, type WarmOptions } from './sparseReader'
import type { Micros } from '../../core/time'

export { FRAME_LOOKUP_TOLERANCE }

export type DecodedFrame = HTMLCanvasElement | OffscreenCanvas | ImageBitmap

interface VideoSource {
  input: Input
  track: InputVideoTrack
  sink: CanvasSink
  packets: EncodedPacketSink
  /** Timestamp of the first frame; recordings can start late. */
  first: Micros
}
/** Budgets of the frame caches for files with few keyframes (all assets together). */
export const FULL_CACHE_BYTES = 96 * 1024 * 1024
export const THUMB_CACHE_BYTES = 40 * 1024 * 1024
/** Lane whose file handle probes for the sparse path (the fine cut's own lane, so no extra file handle is opened). */
const WARM_LANE = 'fine-view'
/** Lookups in the first stretch of a file are never slow, so they skip the keyframe probe. */
const SPARSE_PROBE_FROM: Micros = 1_000_000

export interface FrameCacheStats {
  fullBytes: number
  fullFrames: number
  thumbBytes: number
  thumbFrames: number
  /** Decoder positions kept across all sparse assets. */
  runs: number
  /** Frames decoded by the sparse readers and passes started on request. */
  decoded: number
  passes: number
}

interface VideoEntry extends VideoSource {
  kind: 'video'
  /** Set once a keyframe was seen to be far behind a lookup: the file is read through the sparse reader from then on. */
  sparse: boolean
  /** Last returned frame, reused while the requested time stays inside it. */
  last: { canvas: DecodedFrame; start: Micros; end: Micros } | null
}
interface ImageEntry {
  kind: 'image'
  bitmap: ImageBitmap
}
type Entry = VideoEntry | ImageEntry
interface Decoded {
  canvas: DecodedFrame
  start: Micros
  end: Micros
}

async function openVideo(file: File): Promise<VideoSource | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) {
      input.dispose()
      return null
    }
    const first = Math.round((await track.getFirstTimestamp()) * 1_000_000)
    return { input, track, sink: new CanvasSink(track), packets: new EncodedPacketSink(track), first }
  } catch (e) {
    input.dispose()
    throw e
  }
}

function closeVideo(entry: VideoEntry): void {
  entry.input.dispose()
}

/**
 * Frame-exact access to media files through WebCodecs (decodes from the previous keyframe).
 * Used for paused preview, single-frame stepping and export. Playback uses <video> elements instead.
 */
export class ExactFrameProvider {
  /**
   * How many lookups the demuxer's keyframe search could not serve and the keyframe list did (visible for tests
   * and diagnostics).
   */
  readonly rescues = { fromKeyframe: 0 }
  private entries = new Map<string, Promise<Entry | null>>()
  private files = new Map<string, { file: File; isImage: boolean }>()
  private readonly fullCache = new TimedCache<CachedFrame>(FULL_CACHE_BYTES)
  private readonly thumbCache = new TimedCache<CachedFrame>(THUMB_CACHE_BYTES)
  private readers = new Map<string, SparseReader>()
  /** What the next pass over an asset should keep; set before the first (asynchronous) step so no lookup beats it. */
  private hints = new Map<string, ScanHint>()

  setFile(assetId: string, file: File, isImage: boolean): void {
    this.files.set(assetId, { file, isImage })
    // A lookup made before the file existed cached "no decoder"; drop it so the next lookup decodes the file.
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${assetId}|`)) continue
      this.entries.delete(key)
      void entry.then((e) => (e?.kind === 'video' ? closeVideo(e) : undefined))
    }
    this.readers.get(assetId)?.dispose()
    this.readers.delete(assetId)
    this.hints.delete(assetId)
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
    const video = await openVideo(source.file)
    return video ? { kind: 'video', sparse: false, last: null, ...video } : null
  }

  /**
   * Whether the keyframe before `lookup` is so far back that every lookup would decode a long stretch. Also true when
   * the demuxer finds no keyframe at all: in a WebM without cues whose later clusters hold no keyframe (MediaRecorder
   * output) a lookup after such a cluster was seen starts the search inside it and reports "no keyframe". Such files
   * are read forward from the keyframe list by the sparse reader, which also caches what it decodes on the way.
   */
  private async isSparse(entry: VideoEntry, lookup: Micros): Promise<boolean> {
    if (entry.sparse) return true
    if (lookup - entry.first <= SPARSE_PROBE_FROM) return false
    let keyTime: Micros | null = null
    try {
      const packet = await entry.packets.getKeyPacket(lookup / 1_000_000, { metadataOnly: true })
      keyTime = packet ? Math.round(packet.timestamp * 1_000_000) : null
    } catch {
      keyTime = null
    }
    entry.sparse = isSparseGap(lookup, keyTime)
    return entry.sparse
  }

  private reader(assetId: string, entry: VideoEntry): SparseReader {
    let reader = this.readers.get(assetId)
    if (!reader) {
      reader = new SparseReader(assetId, entry.track, entry.packets, { full: this.fullCache, thumbs: this.thumbCache }, () => this.hints.get(assetId) ?? null)
      this.readers.set(assetId, reader)
    }
    return reader
  }

  private async decode(assetId: string, entry: VideoEntry, lookup: Micros): Promise<Decoded | null> {
    if (await this.isSparse(entry, lookup)) return this.decodeSparse(assetId, entry, lookup)
    let failure: unknown = null
    try {
      const wrapped = await entry.sink.getCanvas(lookup / 1_000_000)
      if (wrapped) return await this.span(entry, wrapped)
    } catch (e) {
      failure = e
    }
    try {
      entry.sparse = true
      const frame = await this.decodeSparse(assetId, entry, lookup)
      if (frame) return frame
    } catch (e) {
      failure ??= e
    }
    if (failure) throw failure
    return null
  }

  private async decodeSparse(assetId: string, entry: VideoEntry, lookup: Micros): Promise<Decoded | null> {
    const hit = await this.reader(assetId, entry).frameAt(lookup)
    if (!hit) return null
    this.rescues.fromKeyframe++
    return { canvas: hit.value, start: hit.start, end: hit.end }
  }

  private async span(entry: VideoEntry, wrapped: WrappedCanvas): Promise<Decoded> {
    const start = Math.round(wrapped.timestamp * 1_000_000)
    const duration = Math.round(wrapped.duration * 1_000_000)
    const next = duration > 0 ? null : await this.nextFrameStart(entry, start)
    return { canvas: wrapped.canvas, start, end: frameEnd(start, duration, next) }
  }

  /** Start of the first frame after `start`; null at the end of the file. */
  private async nextFrameStart(entry: VideoEntry, start: Micros): Promise<Micros | null> {
    let packet = await entry.packets.getPacket(start / 1_000_000, { metadataOnly: true })
    // Some recordings repeat a timestamp, so look a few packets ahead.
    for (let i = 0; packet && i < 4; i++) {
      packet = await entry.packets.getNextPacket(packet, { metadataOnly: true })
      const t = packet ? Math.round(packet.timestamp * 1_000_000) : null
      if (t !== null && t > start) return t
    }
    return null
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

    const lookup = lookupTime(srcTime, entry.first)
    if (spanCovers(entry.last, lookup)) return entry.last!.canvas

    const cached = this.fullCache.at(assetId, lookup)
    if (cached) {
      entry.last = { canvas: cached.value, start: cached.start, end: cached.end }
      return cached.value
    }
    const frame = await this.decode(assetId, entry, lookup)
    if (!frame) return null
    entry.last = frame
    return frame.canvas
  }

  /**
   * Prepares the frames of a window of a file with few keyframes in one forward pass: thumbnails of every frame in the
   * window and a few full-size frames, so the strip and the two big pictures of the fine cut are cache hits. Resolves
   * true for such files and false, without doing anything, for files with ordinary keyframes (random access is cheap).
   */
  async warm(assetId: string, want: ScanWant, options: WarmOptions = {}): Promise<boolean> {
    this.hints.set(assetId, { want, options })
    const entry = await this.open(assetId, WARM_LANE)
    if (!entry || entry.kind !== 'video') return false
    if (!(await this.isSparse(entry, Math.max(want.thumbTo, want.fullTo)))) return false
    return this.reader(assetId, entry).warm(want, options)
  }

  clearHint(assetId: string): void {
    this.hints.delete(assetId)
  }

  /** True once the file was seen to be read through the sparse reader. */
  isSparseAsset(assetId: string): boolean {
    return this.readers.has(assetId)
  }

  /** A small picture of the frame at `srcTime` if one is in the cache. Never decodes. */
  getThumb(assetId: string, srcTime: Micros): CachedFrame | null {
    const lookup = srcTime + FRAME_LOOKUP_TOLERANCE
    return this.thumbCache.at(assetId, lookup)?.value ?? this.fullCache.at(assetId, lookup)?.value ?? null
  }

  /** The best picture available without decoding: the exact one, or else a thumbnail of that frame. */
  peekFrame(assetId: string, srcTime: Micros): { frame: CachedFrame; exact: boolean } | null {
    const lookup = srcTime + FRAME_LOOKUP_TOLERANCE
    const full = this.fullCache.at(assetId, lookup)
    if (full) return { frame: full.value, exact: true }
    const thumb = this.thumbCache.at(assetId, lookup)
    return thumb ? { frame: thumb.value, exact: false } : null
  }

  cacheStats(): FrameCacheStats {
    let runs = 0
    let decoded = 0
    let passes = 0
    for (const reader of this.readers.values()) {
      runs += reader.runCount
      decoded += reader.decoded
      passes += reader.passes
    }
    return {
      fullBytes: this.fullCache.bytes,
      fullFrames: this.fullCache.size,
      thumbBytes: this.thumbCache.bytes,
      thumbFrames: this.thumbCache.size,
      runs,
      decoded,
      passes
    }
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
      if (entry?.kind === 'video') closeVideo(entry)
      if (entry?.kind === 'image') entry.bitmap.close()
    }
    this.entries.clear()
    this.files.clear()
    for (const reader of this.readers.values()) reader.dispose()
    this.readers.clear()
    this.fullCache.clear()
    this.thumbCache.clear()
  }
}
