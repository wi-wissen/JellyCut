import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input, type InputVideoTrack, type WrappedCanvas } from 'mediabunny'
import { FRAME_LOOKUP_TOLERANCE, frameEnd, lookupTime, spanCovers } from '../../core/media/frameLookup'
import { keyAtOrBefore } from '../../core/media/keyList'
import { readKeyTimes } from './keyframes'
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
/** Forward decoding from one keyframe, kept so stepping through a long keyframe-less stretch decodes each frame once. */
interface Run {
  key: Micros
  iterator: AsyncGenerator<WrappedCanvas, void, undefined>
  current: WrappedCanvas | null
  ahead: WrappedCanvas | null
}
interface VideoEntry extends VideoSource {
  kind: 'video'
  /** Keyframe times, read once and only when the demuxer's own keyframe search failed. */
  keys: Promise<Micros[]> | null
  run: Run | null
  /** Last returned frame, reused while the requested time stays inside it. */
  last: { canvas: DecodedFrame; start: Micros; end: Micros } | null
}
interface ImageEntry {
  kind: 'image'
  bitmap: ImageBitmap
}
type Entry = VideoEntry | ImageEntry

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
  void entry.run?.iterator.return().catch(() => undefined)
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

  setFile(assetId: string, file: File, isImage: boolean): void {
    this.files.set(assetId, { file, isImage })
    // A lookup made before the file existed cached "no decoder"; drop it so the next lookup decodes the file.
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${assetId}|`)) continue
      this.entries.delete(key)
      void entry.then((e) => (e?.kind === 'video' ? closeVideo(e) : undefined))
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
    const video = await openVideo(source.file)
    return video ? { kind: 'video', keys: null, run: null, last: null, ...video } : null
  }

  /**
   * Fallback for files whose keyframes the demuxer cannot find by time. Mediabunny remembers where clusters start;
   * in a WebM without cues whose later clusters hold no keyframe (MediaRecorder output: one keyframe at the start,
   * a cluster per second) a lookup after such a cluster was seen starts the search inside it and reports "no
   * keyframe", so no frame could be decoded any more. Asking for the exact time of a known keyframe still works.
   */
  private async decode(entry: VideoEntry, lookup: Micros): Promise<WrappedCanvas | null> {
    let failure: unknown = null
    try {
      const wrapped = await entry.sink.getCanvas(lookup / 1_000_000)
      if (wrapped) return wrapped
    } catch (e) {
      failure = e
    }
    try {
      const wrapped = await this.decodeFromKeyframe(entry, lookup)
      if (wrapped) return wrapped
    } catch (e) {
      failure ??= e
    }
    if (failure) throw failure
    return null
  }

  private keyTimes(entry: VideoEntry): Promise<Micros[]> {
    entry.keys ??= readKeyTimes(entry.packets)
    return entry.keys
  }

  private async decodeFromKeyframe(entry: VideoEntry, lookup: Micros): Promise<WrappedCanvas | null> {
    const keys = await this.keyTimes(entry)
    if (keys.length === 0) return null
    // Last keyframe at or before the lookup; before the first one the first is the nearest.
    const key = keyAtOrBefore(keys, lookup) ?? keys[0]!
    let run = entry.run
    const resumable = run && run.key === key && run.current && Math.round(run.current.timestamp * 1_000_000) <= lookup
    if (!resumable) {
      await run?.iterator.return()
      run = { key, iterator: entry.sink.canvases(key / 1_000_000), current: null, ahead: null }
      entry.run = run
    }
    const active = entry.run!
    for (;;) {
      const next: WrappedCanvas | null = active.ahead ?? (await active.iterator.next()).value ?? null
      active.ahead = null
      if (!next) break
      if (active.current && Math.round(next.timestamp * 1_000_000) > lookup) {
        active.ahead = next
        break
      }
      active.current = next
      if (Math.round(next.timestamp * 1_000_000) > lookup) break
    }
    if (active.current) this.rescues.fromKeyframe++
    return active.current
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

    const wrapped = await this.decode(entry, lookup)
    if (!wrapped) return null
    const start = Math.round(wrapped.timestamp * 1_000_000)
    const duration = Math.round(wrapped.duration * 1_000_000)
    const next = duration > 0 ? null : await this.nextFrameStart(entry, start)
    entry.last = { canvas: wrapped.canvas, start, end: frameEnd(start, duration, next) }
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
      if (entry?.kind === 'video') closeVideo(entry)
      if (entry?.kind === 'image') entry.bitmap.close()
    }
    this.entries.clear()
    this.files.clear()
  }
}
