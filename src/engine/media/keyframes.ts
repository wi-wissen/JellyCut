import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'
import type { Micros } from '../../core/time'

/**
 * Index of the keyframes of a video file, read from container metadata only (no decoding).
 * Used by the fine cut view to jump between keyframes and to show where they are.
 */
export class KeyframeIndex {
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

  /** Timestamp of the last keyframe at or before `t` (microseconds), or null before the first one. */
  async before(t: Micros): Promise<Micros | null> {
    const packet = await this.sink.getKeyPacket(t / 1_000_000, { metadataOnly: true })
    return packet ? Math.round(packet.timestamp * 1_000_000) : null
  }

  /** Timestamp of the first keyframe strictly after `t`, or null when there is none. */
  async after(t: Micros): Promise<Micros | null> {
    const current = await this.sink.getKeyPacket(t / 1_000_000, { metadataOnly: true })
    const next = current
      ? await this.sink.getNextKeyPacket(current, { metadataOnly: true })
      : await this.sink.getFirstPacket({ metadataOnly: true })
    return next ? Math.round(next.timestamp * 1_000_000) : null
  }

  /** All keyframe timestamps in [from, to], in order. Cheap for a screenful of the timeline. */
  async inRange(from: Micros, to: Micros): Promise<Micros[]> {
    const result: Micros[] = []
    let packet = await this.sink.getKeyPacket(from / 1_000_000, { metadataOnly: true })
    if (!packet) packet = await this.sink.getFirstPacket({ metadataOnly: true })
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
