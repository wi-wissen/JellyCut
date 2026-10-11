import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'
import { keyAfter, keyAtOrBefore, keysBetween } from '../../core/media/keyList'
import type { Micros } from '../../core/time'

/** Timestamps of all keyframes, from container metadata only (one pass over the packet headers). */
export async function readKeyTimes(packets: EncodedPacketSink): Promise<Micros[]> {
  const keys: Micros[] = []
  for await (const packet of packets.packets(undefined, undefined, { metadataOnly: true })) {
    if (packet.type === 'key') keys.push(Math.round(packet.timestamp * 1_000_000))
  }
  return keys
}

/**
 * Index of the keyframes of a video file, read from container metadata only (no decoding).
 * Used by the fine cut view to jump between keyframes and to show where they are.
 */
export class KeyframeIndex {
  /**
   * The demuxer's keyframe search can come back empty in a MediaRecorder WebM (see ExactFrameProvider.decode);
   * the full list, read once, answers then.
   */
  private all: Promise<Micros[]> | null = null

  private constructor(
    private input: Input,
    private sink: EncodedPacketSink
  ) {}

  static async open(file: File): Promise<KeyframeIndex | null> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) {
      input.dispose()
      return null
    }
    return new KeyframeIndex(input, new EncodedPacketSink(track))
  }

  private keyList(): Promise<Micros[]> {
    this.all ??= readKeyTimes(this.sink)
    return this.all
  }

  /** Timestamp of the last keyframe at or before `t` (microseconds), or null before the first one. */
  async before(t: Micros): Promise<Micros | null> {
    const packet = await this.sink.getKeyPacket(t / 1_000_000, { metadataOnly: true })
    return packet ? Math.round(packet.timestamp * 1_000_000) : keyAtOrBefore(await this.keyList(), t)
  }

  /** Timestamp of the first keyframe strictly after `t`, or null when there is none. */
  async after(t: Micros): Promise<Micros | null> {
    const current = await this.sink.getKeyPacket(t / 1_000_000, { metadataOnly: true })
    if (!current) return keyAfter(await this.keyList(), t)
    const next = await this.sink.getNextKeyPacket(current, { metadataOnly: true })
    return next ? Math.round(next.timestamp * 1_000_000) : null
  }

  /** All keyframe timestamps in [from, to], in order. Cheap for a screenful of the timeline. */
  async inRange(from: Micros, to: Micros): Promise<Micros[]> {
    const result: Micros[] = []
    let packet = await this.sink.getKeyPacket(from / 1_000_000, { metadataOnly: true })
    if (!packet) return keysBetween(await this.keyList(), from, to)
    let guard = 0
    while (packet && guard++ < 100_000) {
      const t = Math.round(packet.timestamp * 1_000_000)
      if (t > to) break
      if (t >= from) result.push(t)
      packet = await this.sink.getNextKeyPacket(packet, { metadataOnly: true })
    }
    return result
  }

  dispose(): void {
    this.input.dispose()
  }
}
