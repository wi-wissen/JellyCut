import { PaletteMapper, type PixelBuffer } from './quantize'
import { lzwEncode } from './lzw'

export interface GifWriterOptions {
  width: number
  height: number
  /** RGB triples of the one global palette used by every frame (1 to 256 colours). */
  palette: Uint8Array
  /** Frames per second. Delays alternate so that the total length matches n / frameRate. */
  frameRate: number
  /** Netscape loop extension with loop count 0 (forever). Default true. */
  loop?: boolean
  /**
   * Unchanged pixels become transparent and each frame is cropped to the changed area.
   * Takes one palette slot for transparency, so the palette may have at most 255 colours. Default true.
   */
  differencing?: boolean
}

/** Frames whose changed area covers more than this share of the image are written whole. */
const FULL_FRAME_SHARE = 0.75
const NETSCAPE = [0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30] // "NETSCAPE2.0"

/**
 * Streaming GIF89a encoder. header() returns the file start, addFrame() one chunk per frame, finish() the
 * trailer. Concatenating all chunks gives the file. The caller supplies the palette up front, because the
 * global colour table must come before the first frame.
 */
export class GifWriter {
  private readonly width: number
  private readonly height: number
  private readonly frameRate: number
  private readonly loop: boolean
  private readonly differencing: boolean
  private readonly mapper: PaletteMapper
  private readonly tableBits: number
  private readonly minCodeSize: number
  private readonly colors: number
  /** Index of the transparent entry, right after the colours; -1 when not used. */
  private readonly transparent: number
  private readonly table: Uint8Array
  private frameIndex = 0
  private previous: Uint8Array | null = null

  constructor(options: GifWriterOptions) {
    const { width, height, palette, frameRate } = options
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) {
      throw new RangeError('GIF dimensions must be whole numbers from 1 to 65535')
    }
    if (!(frameRate > 0) || frameRate > 100) throw new RangeError('The frame rate must be above 0 and at most 100')
    if (palette.length === 0 || palette.length % 3 !== 0) throw new RangeError('The palette must be RGB triples')
    this.width = width
    this.height = height
    this.frameRate = frameRate
    this.loop = options.loop ?? true
    this.differencing = options.differencing ?? true
    this.colors = palette.length / 3
    if (this.colors > (this.differencing ? 255 : 256)) {
      throw new RangeError(this.differencing ? 'With differencing the palette may have at most 255 colours' : 'The palette may have at most 256 colours')
    }
    this.mapper = new PaletteMapper(palette)
    this.transparent = this.differencing ? this.colors : -1
    const entries = this.colors + (this.differencing ? 1 : 0)
    let bits = 1
    while (1 << bits < entries) bits++
    this.tableBits = bits
    this.minCodeSize = Math.max(2, bits)
    this.table = new Uint8Array(3 << bits)
    this.table.set(palette)
  }

  header(): Uint8Array {
    const out = new ByteWriter(64 + this.table.length)
    out.text('GIF89a')
    out.u16(this.width)
    out.u16(this.height)
    // Global colour table present, 8 bits of colour resolution, table size 2^tableBits.
    out.byte(0x80 | (7 << 4) | (this.tableBits - 1))
    out.byte(0) // background colour index
    out.byte(0) // pixel aspect ratio: square
    out.bytes(this.table)
    if (this.loop) {
      out.bytes([0x21, 0xff, 0x0b])
      out.bytes(NETSCAPE)
      out.bytes([0x03, 0x01, 0x00, 0x00, 0x00])
    }
    return out.finish()
  }

  addFrame(rgba: PixelBuffer): Uint8Array {
    if (rgba.length !== this.width * this.height * 4) throw new RangeError('The frame size does not match the GIF size')
    const full = this.mapper.map(rgba, this.width, this.height)
    const previous = this.previous
    const delay = this.delayOf(this.frameIndex)
    this.frameIndex++
    this.previous = full

    if (!this.differencing || previous === null) return this.encodeFrame(0, 0, this.width, this.height, full, false, delay)
    return this.encodeDifference(full, previous, delay)
  }

  finish(): Uint8Array {
    return Uint8Array.of(0x3b)
  }

  /** Delay in centiseconds from the frame index, so that the running total never drifts from the frame rate. */
  private delayOf(index: number): number {
    return Math.round(((index + 1) * 100) / this.frameRate) - Math.round((index * 100) / this.frameRate)
  }

  private encodeDifference(full: Uint8Array, previous: Uint8Array, delay: number): Uint8Array {
    let minX = this.width
    let minY = this.height
    let maxX = -1
    let maxY = -1
    let changed = 0
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const p = y * this.width + x
        if (full[p] === previous[p]) continue
        changed++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (changed === 0) {
      return this.encodeFrame(0, 0, 1, 1, Uint8Array.of(this.transparent), true, delay)
    }
    if (changed > FULL_FRAME_SHARE * this.width * this.height) {
      return this.encodeFrame(0, 0, this.width, this.height, full, false, delay)
    }
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const indexes = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (minY + y) * this.width + minX + x
        indexes[y * w + x] = full[p] === previous[p] ? this.transparent : full[p]!
      }
    }
    return this.encodeFrame(minX, minY, w, h, indexes, true, delay)
  }

  private encodeFrame(
    left: number,
    top: number,
    width: number,
    height: number,
    indexes: Uint8Array,
    transparent: boolean,
    delay: number
  ): Uint8Array {
    const out = new ByteWriter(indexes.length / 2 + 32)
    // Graphic control: disposal method 1 (leave the frame in place), delay, transparent index.
    out.bytes([0x21, 0xf9, 0x04, (1 << 2) | (transparent ? 1 : 0), delay & 0xff, (delay >> 8) & 0xff, transparent ? this.transparent : 0, 0])
    out.byte(0x2c)
    out.u16(left)
    out.u16(top)
    out.u16(width)
    out.u16(height)
    out.byte(0) // no local colour table, not interlaced
    out.bytes(lzwEncode(indexes, this.minCodeSize))
    return out.finish()
  }
}

class ByteWriter {
  private buffer: Uint8Array
  private length = 0

  constructor(initial: number) {
    this.buffer = new Uint8Array(Math.max(64, Math.ceil(initial)))
  }

  byte(value: number): void {
    this.reserve(1)
    this.buffer[this.length++] = value & 0xff
  }

  u16(value: number): void {
    this.byte(value)
    this.byte(value >> 8)
  }

  bytes(values: ArrayLike<number>): void {
    this.reserve(values.length)
    this.buffer.set(values as ArrayLike<number>, this.length)
    this.length += values.length
  }

  text(value: string): void {
    for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i))
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.length)
  }

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return
    const bigger = new Uint8Array(Math.max(this.buffer.length * 2, this.length + extra))
    bigger.set(this.buffer.subarray(0, this.length))
    this.buffer = bigger
  }
}
