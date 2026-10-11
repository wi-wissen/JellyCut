/** Colour reduction for the GIF encoder. Pure TypeScript: no DOM, deterministic output. */

export type PixelBuffer = Uint8Array | Uint8ClampedArray

/** Pixels sampled across all frames for the palette. Enough for a stable palette, cheap to sort. */
const SAMPLE_BUDGET = 65_536

interface ColorRecord {
  key: number
  r: number
  g: number
  b: number
  count: number
}

function channel(record: ColorRecord, c: number): number {
  return c === 0 ? record.r : c === 1 ? record.g : record.b
}

function countColors(frames: readonly PixelBuffer[], sampleBudget: number): ColorRecord[] {
  const counts = new Map<number, number>()
  const perFrame = Math.max(1, Math.floor(sampleBudget / Math.max(1, frames.length)))
  for (const rgba of frames) {
    const pixels = rgba.length >> 2
    const stride = Math.max(1, Math.floor(pixels / perFrame))
    for (let p = 0; p < pixels; p += stride) {
      const o = p << 2
      const key = (rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return Array.from(counts, ([key, count]) => ({
    key,
    r: key >> 16,
    g: (key >> 8) & 0xff,
    b: key & 0xff,
    count
  })).sort((a, b) => a.key - b.key)
}

function clampColors(maxColors: number): number {
  return Math.min(256, Math.max(1, Math.floor(maxColors)))
}

/**
 * Median cut over the sampled colours of all given frames (RGBA, same size).
 * Returns the palette as RGB triples. Colour sets with at most maxColors distinct colours
 * are returned exactly, so flat graphics survive unchanged.
 */
export function buildPalette(frames: readonly PixelBuffer[], maxColors = 256, sampleBudget = SAMPLE_BUDGET): Uint8Array {
  const limit = clampColors(maxColors)
  const records = countColors(frames, sampleBudget)
  if (records.length === 0) return new Uint8Array(0)

  const boxes: ColorRecord[][] = [records]
  while (boxes.length < limit) {
    let pick = -1
    let pickCount = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!
      if (box.length < 2) continue
      const total = box.reduce((sum, rec) => sum + rec.count, 0)
      if (total > pickCount && spread(box, 0) + spread(box, 1) + spread(box, 2) > 0) {
        pick = i
        pickCount = total
      }
    }
    if (pick < 0) break

    const box = boxes[pick]!
    const rangeR = spread(box, 0)
    const rangeG = spread(box, 1)
    const rangeB = spread(box, 2)
    const c = rangeR >= rangeG && rangeR >= rangeB ? 0 : rangeG >= rangeB ? 1 : 2
    box.sort((a, b) => channel(a, c) - channel(b, c) || a.key - b.key)

    const half = pickCount / 2
    let cumulative = 0
    let cut = 1
    for (let i = 0; i < box.length - 1; i++) {
      cumulative += box[i]!.count
      if (cumulative >= half) {
        cut = i + 1
        break
      }
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut))
  }

  const palette = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, i) => {
    let total = 0
    let r = 0
    let g = 0
    let b = 0
    for (const rec of box) {
      total += rec.count
      r += rec.r * rec.count
      g += rec.g * rec.count
      b += rec.b * rec.count
    }
    palette[i * 3] = Math.round(r / total)
    palette[i * 3 + 1] = Math.round(g / total)
    palette[i * 3 + 2] = Math.round(b / total)
  })
  return palette
}

function spread(box: readonly ColorRecord[], c: number): number {
  let min = 255
  let max = 0
  for (const rec of box) {
    const v = channel(rec, c)
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min
}

/**
 * Maps pixels to palette indexes. Exact palette colours are found through a map, other colours through
 * a 5-5-5 bit cache of nearest-colour answers per cell (one cell covers 8 levels per channel).
 */
export class PaletteMapper {
  readonly colors: number
  private readonly palette: Uint8Array
  private readonly exact = new Map<number, number>()
  private readonly cells = new Int16Array(1 << 15).fill(-1)

  constructor(palette: Uint8Array) {
    if (palette.length === 0 || palette.length % 3 !== 0 || palette.length / 3 > 256) {
      throw new RangeError('A palette needs 1 to 256 RGB triples')
    }
    this.palette = palette
    this.colors = palette.length / 3
    for (let i = 0; i < this.colors; i++) {
      const key = (palette[i * 3]! << 16) | (palette[i * 3 + 1]! << 8) | palette[i * 3 + 2]!
      if (!this.exact.has(key)) this.exact.set(key, i)
    }
  }

  map(rgba: PixelBuffer, width: number, height: number): Uint8Array {
    const pixels = width * height
    const indexes = new Uint8Array(pixels)
    for (let p = 0; p < pixels; p++) {
      const o = p << 2
      const r = rgba[o]!
      const g = rgba[o + 1]!
      const b = rgba[o + 2]!
      let index = this.exact.get((r << 16) | (g << 8) | b)
      if (index === undefined) {
        const cell = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        index = this.cells[cell]!
        if (index < 0) {
          // The cell centre, not the first colour seen in it, so the answer does not depend on the frames before.
          index = this.nearest(((r >> 3) << 3) | 4, ((g >> 3) << 3) | 4, ((b >> 3) << 3) | 4)
          this.cells[cell] = index
        }
      }
      indexes[p] = index
    }
    return indexes
  }

  nearest(r: number, g: number, b: number): number {
    const palette = this.palette
    let best = 0
    let bestDistance = Infinity
    for (let i = 0; i < this.colors; i++) {
      const dr = palette[i * 3]! - r
      const dg = palette[i * 3 + 1]! - g
      const db = palette[i * 3 + 2]! - b
      const d = dr * dr + dg * dg + db * db
      if (d < bestDistance) {
        bestDistance = d
        best = i
      }
    }
    return best
  }
}

/** Floyd-Steinberg error diffusion against a fixed palette. Slower (no cache), so only for single images. */
function mapDithered(rgba: PixelBuffer, width: number, height: number, palette: Uint8Array): Uint8Array {
  const mapper = new PaletteMapper(palette)
  const pixels = width * height
  const work = new Float32Array(pixels * 3)
  for (let p = 0; p < pixels; p++) {
    work[p * 3] = rgba[p << 2]!
    work[p * 3 + 1] = rgba[(p << 2) + 1]!
    work[p * 3 + 2] = rgba[(p << 2) + 2]!
  }
  const indexes = new Uint8Array(pixels)
  const diffuse = (x: number, y: number, weight: number, er: number, eg: number, eb: number) => {
    if (x < 0 || x >= width || y >= height) return
    const q = (y * width + x) * 3
    work[q] = work[q]! + er * weight
    work[q + 1] = work[q + 1]! + eg * weight
    work[q + 2] = work[q + 2]! + eb * weight
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const q = p * 3
      const r = clampByte(work[q]!)
      const g = clampByte(work[q + 1]!)
      const b = clampByte(work[q + 2]!)
      const index = mapper.nearest(r, g, b)
      indexes[p] = index
      const er = r - palette[index * 3]!
      const eg = g - palette[index * 3 + 1]!
      const eb = b - palette[index * 3 + 2]!
      diffuse(x + 1, y, 7 / 16, er, eg, eb)
      diffuse(x - 1, y + 1, 3 / 16, er, eg, eb)
      diffuse(x, y + 1, 5 / 16, er, eg, eb)
      diffuse(x + 1, y + 1, 1 / 16, er, eg, eb)
    }
  }
  return indexes
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/**
 * One image to a palette and indexes. Median cut on sampled pixels; dithering is off by default because it
 * roughly triples the cost of mapping pixels.
 */
export function quantize(
  rgba: PixelBuffer,
  width: number,
  height: number,
  maxColors = 256,
  options: { dither?: boolean } = {}
): { palette: Uint8Array; indexes: Uint8Array } {
  const palette = buildPalette([rgba], maxColors)
  const indexes = options.dither ? mapDithered(rgba, width, height, palette) : new PaletteMapper(palette).map(rgba, width, height)
  return { palette, indexes }
}
