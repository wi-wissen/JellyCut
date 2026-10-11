import { describe, expect, it } from 'vitest'
import { lzwEncode } from './lzw'
import { GifWriter, type GifWriterOptions } from './writer'
import { PaletteMapper, buildPalette } from './quantize'

// ---- An independent GIF reader, written from the GIF89a specification (not from the encoder). ----

interface DecodedFrame {
  left: number
  top: number
  width: number
  height: number
  delay: number
  disposal: number
  transparentFlag: boolean
  /** Index of the frame as stored (cropped to its rectangle). */
  stored: Uint8Array
  /** The whole canvas after this frame was drawn: palette indexes, -1 where nothing was drawn. */
  canvas: Int16Array
  /** The canvas as RGBA, using the global palette. */
  rgba: Uint8ClampedArray
}

interface DecodedGif {
  width: number
  height: number
  palette: Uint8Array
  /** Netscape loop count, null when there is no loop extension. */
  loop: number | null
  frames: DecodedFrame[]
}

function decodeLzw(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const length = new Int32Array(4096)
  for (let i = 0; i < clear; i++) {
    suffix[i] = i
    length[i] = 1
    prefix[i] = -1
  }
  const out = new Uint8Array(pixelCount)
  let o = 0
  let codeSize = minCodeSize + 1
  let next = eoi + 1
  let prev = -1
  let bitPos = 0
  const totalBits = data.length * 8

  const writeString = (code: number): number => {
    const len = length[code]!
    let c = code
    for (let k = len - 1; k >= 0; k--) {
      out[o + k] = suffix[c]!
      c = prefix[c]!
    }
    return len
  }
  const firstOf = (code: number): number => {
    let c = code
    while (prefix[c]! !== -1) c = prefix[c]!
    return suffix[c]!
  }

  while (bitPos + codeSize <= totalBits) {
    let code = 0
    for (let b = 0; b < codeSize; b++) {
      const bit = (data[(bitPos + b) >> 3]! >> ((bitPos + b) & 7)) & 1
      code |= bit << b
    }
    bitPos += codeSize
    if (code === clear) {
      codeSize = minCodeSize + 1
      next = eoi + 1
      prev = -1
      continue
    }
    if (code === eoi) break
    if (prev === -1) {
      if (code >= clear) throw new Error(`first code after clear is ${code}`)
      o += writeString(code)
      prev = code
      continue
    }
    let entryFirst: number
    if (code < next) {
      entryFirst = firstOf(code)
    } else if (code === next) {
      entryFirst = firstOf(prev)
    } else {
      throw new Error(`code ${code} beyond table size ${next}`)
    }
    prefix[next] = prev
    suffix[next] = entryFirst
    length[next] = length[prev]! + 1
    next++
    if (next === 1 << codeSize && codeSize < 12) codeSize++
    if (o + length[code]! > pixelCount) throw new Error('LZW data is longer than the image')
    o += writeString(code)
    prev = code
  }
  if (o !== pixelCount) throw new Error(`LZW produced ${o} pixels, expected ${pixelCount}`)
  return out
}

function readGif(bytes: Uint8Array): DecodedGif {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  expect(text(0, 6)).toBe('GIF89a')
  const u16 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8)
  const width = u16(6)
  const height = u16(8)
  const packed = bytes[10]!
  let p = 13
  let palette = new Uint8Array(0)
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 7) + 1))
    palette = bytes.slice(p, p + size)
    p += size
  }
  const readSubBlocks = (): Uint8Array => {
    const parts: number[] = []
    for (;;) {
      const size = bytes[p++]!
      if (size === 0) break
      for (let i = 0; i < size; i++) parts.push(bytes[p++]!)
    }
    return Uint8Array.from(parts)
  }
  let loop: number | null = null
  const frames: DecodedFrame[] = []
  let canvas = new Int16Array(width * height).fill(0)
  let pendingDelay = 0
  let pendingDisposal = 0
  let pendingTransparent = false
  let pendingIndex = 0
  let sawTrailer = false
  while (p < bytes.length) {
    const marker = bytes[p++]!
    if (marker === 0x3b) {
      sawTrailer = true
      break
    }
    if (marker === 0x21) {
      const label = bytes[p++]!
      if (label === 0xf9) {
        const size = bytes[p++]!
        expect(size).toBe(4)
        const flags = bytes[p]!
        pendingDisposal = (flags >> 2) & 7
        pendingTransparent = (flags & 1) === 1
        pendingDelay = u16(p + 1)
        pendingIndex = bytes[p + 3]!
        p += 4
        expect(bytes[p++]).toBe(0)
      } else if (label === 0xff) {
        const blockSize = bytes[p++]!
        const id = text(p, p + blockSize)
        p += blockSize
        const data = readSubBlocks()
        if (id === 'NETSCAPE2.0' && data[0] === 1) loop = data[1]! | (data[2]! << 8)
      } else {
        readSubBlocks()
      }
      continue
    }
    if (marker === 0x2c) {
      const left = u16(p)
      const top = u16(p + 2)
      const w = u16(p + 4)
      const h = u16(p + 6)
      const flags = bytes[p + 8]!
      p += 9
      expect(flags & 0x80).toBe(0) // no local table in this encoder
      const minCodeSize = bytes[p++]!
      const data = readSubBlocks()
      const stored = decodeLzw(data, minCodeSize, w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const value = stored[y * w + x]!
          if (pendingTransparent && value === pendingIndex) continue
          canvas[(top + y) * width + left + x] = value
        }
      }
      const rgba = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < canvas.length; i++) {
        const index = canvas[i]!
        if (index < 0) continue
        rgba[i * 4] = palette[index * 3]!
        rgba[i * 4 + 1] = palette[index * 3 + 1]!
        rgba[i * 4 + 2] = palette[index * 3 + 2]!
        rgba[i * 4 + 3] = 255
      }
      frames.push({
        left,
        top,
        width: w,
        height: h,
        delay: pendingDelay,
        disposal: pendingDisposal,
        transparentFlag: pendingTransparent,
        stored,
        canvas: Int16Array.from(canvas),
        rgba
      })
      continue
    }
    throw new Error(`unknown block 0x${marker.toString(16)} at ${p - 1}`)
  }
  expect(sawTrailer).toBe(true)
  expect(p).toBe(bytes.length)
  canvas = new Int16Array(0)
  return { width, height, palette, loop, frames }
}

// ---- Synthetic content ----

function fill(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      const o = (y * width + x) * 4
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = 255
    }
  }
  return out
}

function gradient(width: number, height: number, t = 0): Uint8ClampedArray {
  return fill(width, height, (x, y) => [(x * 255) / Math.max(1, width - 1), (y * 255) / Math.max(1, height - 1), (t * 9) % 256])
}

function textLike(width: number, height: number, t = 0): Uint8ClampedArray {
  // Black background with white bars in a letter-like pattern that moves by t pixels.
  return fill(width, height, (x, y) => {
    const bar = (x + t) % 12 < 3 && y > height / 4 && y < (3 * height) / 4
    const row = Math.floor(y / 8) % 2 === 0 && (x + t) % 40 < 20
    return bar || row ? [255, 255, 255] : [0, 0, 0]
  })
}

function flat(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  return fill(width, height, () => rgb)
}

function noise(width: number, height: number, seed: number): Uint8ClampedArray {
  let s = seed >>> 0 || 1
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s >>> 24
  }
  return fill(width, height, () => [next(), next(), next()])
}

function encode(frames: Uint8ClampedArray[], width: number, height: number, options: Partial<GifWriterOptions> = {}): Uint8Array {
  const palette = options.palette ?? buildPalette(frames, options.differencing === false ? 256 : 255)
  const writer = new GifWriter({ width, height, palette, frameRate: options.frameRate ?? 10, ...options })
  const chunks: Uint8Array[] = [writer.header()]
  for (const frame of frames) chunks.push(writer.addFrame(frame))
  chunks.push(writer.finish())
  return concat(chunks)
}

/** Fast equality for large typed arrays (deep toEqual on 50k elements is slow). */
function sameValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function expectCanvas(actual: Int16Array, expected: Int16Array, label: string): void {
  const same = sameValues(actual, expected)
  expect(same, `${label}: canvas equals the expected indexes`).toBe(true)
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** Expected palette index per pixel, computed with the same palette and mapper the writer uses. */
function expectedIndexes(rgba: Uint8ClampedArray, width: number, height: number, palette: Uint8Array): Uint8Array {
  return new PaletteMapper(palette).map(rgba, width, height)
}

// ---- LZW ----

describe('lzwEncode', () => {
  function lzwRoundTrip(indexes: Uint8Array, minCodeSize: number): { decoded: Uint8Array; data: Uint8Array } {
    const data = lzwEncode(indexes, minCodeSize)
    expect(data[0]).toBe(minCodeSize)
    expect(data[data.length - 1]).toBe(0)
    // Sub-blocks: each length byte is at most 255 and the blocks add up to the data.
    let p = 1
    let total = 0
    while (data[p] !== 0) {
      const size = data[p]!
      expect(size).toBeLessThanOrEqual(255)
      total += size
      p += size + 1
    }
    expect(p + 1).toBe(data.length)
    const decoded = decodeLzw(concatBlocks(data), minCodeSize, indexes.length)
    return { decoded, data }
  }

  function concatBlocks(data: Uint8Array): Uint8Array {
    const parts: number[] = []
    let p = 1
    while (data[p] !== 0) {
      const size = data[p]!
      for (let i = 0; i < size; i++) parts.push(data[p + 1 + i]!)
      p += size + 1
    }
    return Uint8Array.from(parts)
  }

  it('round-trips short and simple inputs', () => {
    expect(lzwRoundTrip(new Uint8Array([3]), 2).decoded).toEqual(new Uint8Array([3]))
    expect(lzwRoundTrip(new Uint8Array([0, 1, 0, 1, 0, 1, 0, 1]), 2).decoded).toEqual(new Uint8Array([0, 1, 0, 1, 0, 1, 0, 1]))
    expect(lzwRoundTrip(new Uint8Array(0), 2).decoded).toEqual(new Uint8Array(0))
  })

  it('round-trips a long run and random data for every minimum code size', () => {
    for (let min = 2; min <= 8; min++) {
      const size = 1 << min
      const run = new Uint8Array(5000).fill(size - 1)
      expect(lzwRoundTrip(run, min).decoded).toEqual(run)
      let s = 7 + min
      const random = new Uint8Array(20000)
      for (let i = 0; i < random.length; i++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0
        random[i] = (s >>> 16) % size
      }
      expect(lzwRoundTrip(random, min).decoded).toEqual(random)
    }
  })

  it('resets the dictionary at 4096 codes and stays in sync', () => {
    // Random 8-bit data fills the 4096-entry table after a few thousand codes, so several resets happen.
    let s = 99
    const random = new Uint8Array(400_000)
    for (let i = 0; i < random.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      random[i] = s >>> 24
    }
    const { decoded } = lzwRoundTrip(random, 8)
    expect(decoded).toEqual(random)
  })

  it('uses a code width of 12 bits when the table is full', () => {
    // A table-filling input makes the encoder reach 12-bit codes; the decoder must agree (checked by the round trip).
    const input = new Uint8Array(60_000)
    for (let i = 0; i < input.length; i++) input[i] = (i * i + (i >> 3)) % 4
    expect(lzwRoundTrip(input, 2).decoded).toEqual(input)
  })
})

// ---- Writer ----

describe('GifWriter', () => {
  it('starts with GIF89a and ends with the trailer 0x3B', () => {
    const frames = [gradient(16, 9)]
    const bytes = encode(frames, 16, 9)
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a')
    expect(bytes[bytes.length - 1]).toBe(0x3b)
  })

  it('round-trips gradient, text-like, flat and noise frames with exact index equality', () => {
    const width = 64
    const height = 48
    const cases: Record<string, Uint8ClampedArray[]> = {
      gradient: [0, 1, 2].map((t) => gradient(width, height, t)),
      textLike: [0, 3, 6].map((t) => textLike(width, height, t)),
      flat: [flat(width, height, [30, 120, 200]), flat(width, height, [30, 120, 200])],
      noise: [noise(width, height, 1), noise(width, height, 2)]
    }
    for (const [name, frames] of Object.entries(cases)) {
      for (const differencing of [false, true]) {
        const palette = buildPalette(frames, differencing ? 255 : 256)
        const bytes = encode(frames, width, height, { palette, differencing, frameRate: 10 })
        const gif = readGif(bytes)
        expect(gif.frames.length, `${name} frame count`).toBe(frames.length)
        frames.forEach((rgba, i) => {
          const expected = expectedIndexes(rgba, width, height, palette)
          const frame = gif.frames[i]!
          if (!differencing || i === 0) {
            expect(frame.stored, `${name} frame ${i} stored indexes`).toEqual(expected)
          }
          // The composited canvas (what a viewer shows) must equal the expected indexes.
          expectCanvas(frame.canvas, Int16Array.from(expected), `${name} frame ${i} (differencing ${differencing})`)
        })
      }
    }
  })

  it('keeps the colours of an image with at most 255 colours exactly', () => {
    const frame = flat(32, 8, [10, 20, 30])
    const stripes = fill(32, 8, (x) => (x < 16 ? [255, 0, 0] : [0, 0, 255]))
    const gif = readGif(encode([frame, stripes], 32, 8, { frameRate: 10 }))
    expect(gif.frames[0]!.rgba).toEqual(frame)
    expect(gif.frames[1]!.rgba).toEqual(stripes)
  })

  it('writes a palette sized to its colours and a minimum code size of at least 2', () => {
    const palette = Uint8Array.from([0, 0, 0, 255, 255, 255])
    const writer = new GifWriter({ width: 4, height: 2, palette, frameRate: 10, differencing: false })
    const header = writer.header()
    expect(header[10]! & 7).toBe(0) // global table of 2 entries (field = bits - 1)
    const bytes = concat([header, writer.addFrame(flat(4, 2, [255, 255, 255])), writer.finish()])
    const gif = readGif(bytes)
    expect(gif.frames[0]!.rgba).toEqual(flat(4, 2, [255, 255, 255]))
  })

  it('handles 1x1 and 2x2 frames', () => {
    const one = flat(1, 1, [200, 10, 10])
    const gif1 = readGif(encode([one], 1, 1))
    expect(gif1.width).toBe(1)
    expect(gif1.frames[0]!.rgba).toEqual(one)

    const two = fill(2, 2, (x, y) => [x * 200, y * 200, 0])
    const gif2 = readGif(encode([two, two], 2, 2, { frameRate: 15 }))
    expect(gif2.frames).toHaveLength(2)
    expect(gif2.frames[1]!.rgba).toEqual(two)
  })

  it('supports the largest typical size, 640x360', () => {
    const frames = [gradient(640, 360, 0), textLike(640, 360, 4)]
    const gif = readGif(encode(frames, 640, 360, { frameRate: 20 }))
    expect(gif.width).toBe(640)
    expect(gif.height).toBe(360)
    expect(gif.frames[1]!.canvas).toEqual(Int16Array.from(expectedIndexes(frames[1]!, 640, 360, buildPalette(frames, 255))))
  })

  it('gives delays that add up to the real duration at 15 fps (alternating 6 and 7 cs)', () => {
    const frames = Array.from({ length: 150 }, (_, i) => flat(4, 4, [i % 2 ? 255 : 0, 0, 0]))
    const gif = readGif(encode(frames, 4, 4, { frameRate: 15 }))
    const delays = gif.frames.map((f) => f.delay)
    expect(new Set(delays)).toEqual(new Set([6, 7]))
    const total = delays.reduce((a, b) => a + b, 0)
    expect(Math.abs(total - 1000)).toBeLessThanOrEqual(1)
    expect(delays.slice(0, 6)).toEqual([7, 6, 7, 7, 6, 7])
  })

  it('gives exact delays for 10 fps and 20 fps', () => {
    const frames = Array.from({ length: 100 }, () => flat(2, 2, [1, 2, 3]))
    expect(readGif(encode(frames, 2, 2, { frameRate: 10 })).frames.every((f) => f.delay === 10)).toBe(true)
    expect(readGif(encode(frames, 2, 2, { frameRate: 20 })).frames.every((f) => f.delay === 5)).toBe(true)
  })

  it('writes the Netscape loop extension only when looping is on', () => {
    const frames = [flat(2, 2, [0, 0, 0]), flat(2, 2, [255, 255, 255])]
    expect(readGif(encode(frames, 2, 2, { loop: true })).loop).toBe(0)
    expect(readGif(encode(frames, 2, 2, { loop: false })).loop).toBeNull()
  })

  it('uses disposal method 1 on every frame', () => {
    const gif = readGif(encode([gradient(8, 8, 0), gradient(8, 8, 1)], 8, 8))
    expect(gif.frames.every((f) => f.disposal === 1)).toBe(true)
  })

  it('reduces a mostly static animation with differencing, and keeps its pixels', () => {
    const width = 320
    const height = 180
    const background = gradient(width, height, 0)
    const frames: Uint8ClampedArray[] = []
    for (let i = 0; i < 30; i++) {
      const frame = new Uint8ClampedArray(background)
      // A small square moves across an otherwise static picture.
      for (let y = 60; y < 90; y++) {
        for (let x = 10 + i * 8; x < 40 + i * 8; x++) {
          const o = (y * width + x) * 4
          frame[o] = 255
          frame[o + 1] = 40
          frame[o + 2] = 40
        }
      }
      frames.push(frame)
    }
    const palette = buildPalette(frames, 255)
    const full = encode(frames, width, height, { palette, differencing: false })
    const diff = encode(frames, width, height, { palette, differencing: true })
    expect(diff.length).toBeLessThan(full.length / 2)
    const gif = readGif(diff)
    frames.forEach((rgba, i) => {
      expectCanvas(gif.frames[i]!.canvas, Int16Array.from(expectedIndexes(rgba, width, height, palette)), `static frame ${i}`)
    })
    // Later frames are cropped (the unchanged area is not stored again).
    expect(gif.frames[5]!.width * gif.frames[5]!.height).toBeLessThan((width * height) / 4)
  }, 30_000)

  it('handles an identical frame after a change (1x1 transparent frame)', () => {
    const a = gradient(16, 16, 0)
    const gif = readGif(encode([a, a], 16, 16))
    expect(gif.frames[1]!.width).toBe(1)
    expect(gif.frames[1]!.transparentFlag).toBe(true)
    expect(gif.frames[1]!.canvas).toEqual(Int16Array.from(expectedIndexes(a, 16, 16, buildPalette([a], 255))))
  })

  it('encodes a 480x270, 150 frame animation in under 4 seconds', () => {
    const width = 480
    const height = 270
    const frames = Array.from({ length: 150 }, (_, i) => textLike(width, height, i * 2))
    const palette = buildPalette(frames.filter((_, i) => i % 15 === 0), 255)
    const started = performance.now()
    const bytes = encode(frames, width, height, { palette, frameRate: 15 })
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(4000)
    expect(bytes.length).toBeGreaterThan(1000)
    expect(readGif(bytes).frames).toHaveLength(150)
  }, 30_000)

  it('rejects invalid settings', () => {
    const palette = Uint8Array.from([0, 0, 0])
    expect(() => new GifWriter({ width: 0, height: 2, palette, frameRate: 10 })).toThrow(RangeError)
    expect(() => new GifWriter({ width: 2, height: 2, palette, frameRate: 0 })).toThrow(RangeError)
    expect(() => new GifWriter({ width: 2, height: 2, palette: new Uint8Array(0), frameRate: 10 })).toThrow(RangeError)
    expect(() => new GifWriter({ width: 2, height: 2, palette: new Uint8Array(256 * 3), frameRate: 10 })).toThrow(RangeError)
    const writer = new GifWriter({ width: 2, height: 2, palette, frameRate: 10 })
    expect(() => writer.addFrame(new Uint8ClampedArray(4))).toThrow(RangeError)
  })
})
