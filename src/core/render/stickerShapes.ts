/**
 * Built-in vector stickers. Plain SVG path data on a 24 x 24 grid, drawn with Path2D in the engine, so
 * they look the same on every OS (emoji glyphs do not). 'fill' shapes are filled with the even-odd rule
 * (inner subpaths are holes) and can be outlined; 'line' shapes are strokes in the sticker colour. `cut`
 * strokes knock holes into a fill shape (digits, eyes).
 */
export const STICKER_GRID = 24

export type StickerShapeId =
  | 'star'
  | 'heart'
  | 'check'
  | 'cross'
  | 'arrowRight'
  | 'arrowUp'
  | 'speech'
  | 'thought'
  | 'exclamation'
  | 'question'
  | 'lightbulb'
  | 'thumbsUp'
  | 'smile'
  | 'sun'
  | 'cloud'
  | 'lightning'
  | 'flag'
  | 'music'
  | 'camera'
  | 'play'
  | 'crown'
  | 'sparkles'
  | 'badge1'
  | 'badge2'
  | 'badge3'

export interface StickerShape {
  id: StickerShapeId
  kind: 'fill' | 'line'
  d: string
  /** Stroke paths removed from a fill shape after filling (drawn with destination-out). */
  cut?: string
}

/** Sun rays: short bars from radius 8.5 to 11.5, 1.1 half-width, at eight angles around the centre. */
function sunRays(): string {
  const parts: string[] = []
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const px = -uy * 1.1
    const py = ux * 1.1
    const corners: [number, number][] = [
      [12 + ux * 8.5 + px, 12 + uy * 8.5 + py],
      [12 + ux * 11.5 + px, 12 + uy * 11.5 + py],
      [12 + ux * 11.5 - px, 12 + uy * 11.5 - py],
      [12 + ux * 8.5 - px, 12 + uy * 8.5 - py]
    ]
    parts.push(`M${corners.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`)
  }
  return parts.join('')
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

export const STICKER_SHAPES: readonly StickerShape[] = [
  { id: 'star', kind: 'fill', d: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6-4.9-4.5 6.6-.8z' },
  {
    id: 'heart',
    kind: 'fill',
    d: 'M12 21C5 15.5 2.5 12.5 2.5 8.5 2.5 5.5 4.8 3.5 7.5 3.5c2 0 3.5 1.1 4.5 2.7 1-1.6 2.5-2.7 4.5-2.7 2.7 0 5 2 5 5 0 4-2.5 7-9.5 12.5z'
  },
  { id: 'check', kind: 'line', d: 'M4.5 12.5L9.5 17.5 19.5 6.5' },
  { id: 'cross', kind: 'line', d: 'M6 6L18 18M18 6L6 18' },
  { id: 'arrowRight', kind: 'line', d: 'M3.5 12h16M13.5 6L19.5 12 13.5 18' },
  { id: 'arrowUp', kind: 'line', d: 'M12 20.5V4M6 10l6-6 6 6' },
  {
    id: 'speech',
    kind: 'fill',
    d: 'M3 5.5Q3 3.5 5 3.5h14q2 0 2 2v9q0 2-2 2h-8.5L6 20.5v-4H5q-2 0-2-2z',
    cut: 'M7.5 10h.1M12 10h.1M16.5 10h.1'
  },
  {
    id: 'thought',
    kind: 'fill',
    d: 'M12 3.5A8 6 0 1 1 12 15.5 8 6 0 1 1 12 3.5ZM7.9 18.5A1.4 1.4 0 1 1 5.1 18.5 1.4 1.4 0 1 1 7.9 18.5ZM4.9 21.5A.9.9 0 1 1 3.1 21.5.9.9 0 1 1 4.9 21.5Z'
  },
  { id: 'exclamation', kind: 'fill', d: 'M10 3h4l-.6 12.5h-2.8zM10.2 17.5h3.6v3.8h-3.6z' },
  { id: 'question', kind: 'line', d: 'M8.5 9a3.5 3.5 0 1 1 4.6 3.3c-.7.3-1.1.9-1.1 1.6v1.1M12 18.6h.05' },
  {
    id: 'lightbulb',
    kind: 'fill',
    d: 'M12 2.5C7.9 2.5 5.5 5.6 5.5 9c0 2.6 1.6 4.4 2.7 5.8V17h7.6v-2.2c1.1-1.4 2.7-3.2 2.7-5.8 0-3.4-2.4-6.5-6.5-6.5zM9 18.6h6v2.2H9z'
  },
  {
    id: 'thumbsUp',
    kind: 'fill',
    d: 'M2.5 10.5H6V21H2.5zM8 10.5l4-7.5c1.3-.4 2.6.6 2.2 2l-1 4h6.3c1.4 0 2.3 1.3 1.9 2.6l-2 7.6c-.3 1-1.1 1.8-2.2 1.8H8z'
  },
  {
    id: 'smile',
    kind: 'fill',
    d: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 1 1 0-19z',
    cut: 'M8.6 9.5h.1M15.3 9.5h.1M7.5 13.5q4.5 5 9 0'
  },
  { id: 'sun', kind: 'fill', d: `M12 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 1 1 0-13z${sunRays()}` },
  { id: 'cloud', kind: 'fill', d: 'M7 18.5h10.5a4.5 4.5 0 0 0 0-9 6.5 6.5 0 0 0-12.3 1.5A4 4 0 0 0 7 18.5z' },
  { id: 'lightning', kind: 'fill', d: 'M13.5 2L5 13.5h6L9.5 22 19 9.5h-6z' },
  {
    id: 'flag',
    kind: 'fill',
    d: 'M4.5 2.5h2V22h-2zM7 4c3-1.5 5.5 1.5 9-.0 2-.7 3.5-.2 4.5.5V13c-1-.7-2.5-1.2-4.5-.5-3.5 1.3-6-1.7-9 -.2z'
  },
  {
    id: 'music',
    kind: 'fill',
    d: 'M3.4 18a3.6 3 0 1 0 7.2 0 3.6 3 0 1 0-7.2 0zM9.6 4h2.8v14.4H9.6zM12.4 4l7.1 1.8v4L12.4 8.2z'
  },
  {
    id: 'camera',
    kind: 'fill',
    d: 'M3 7.5Q3 6 4.5 6H7l1.6-2h6.8L17 6h2.5Q21 6 21 7.5v11q0 1.5-1.5 1.5h-15Q3 20 3 18.5z',
    cut: 'M8.5 12a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0'
  },
  {
    id: 'play',
    kind: 'fill',
    d: 'M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM9.5 8v8l6.5-4z'
  },
  { id: 'crown', kind: 'fill', d: 'M3 8l4.5 5L12 5.5 16.5 13 21 8l-2 11H5z' },
  {
    id: 'sparkles',
    kind: 'fill',
    d: 'M9 3c.8 5 1.2 5.8 6 6.5-4.8.7-5.2 1.5-6 6.5-.8-5-1.2-5.8-6-6.5C7.8 8.8 8.2 8 9 3zM18 13c.3 2.6.6 2.9 3 3.3-2.4.4-2.7.7-3 3.2-.3-2.5-.6-2.8-3-3.2 2.4-.4 2.7-.7 3-3.3z'
  },
  { id: 'badge1', kind: 'fill', d: 'M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20z', cut: 'M10.5 9l2-1.5v9' },
  { id: 'badge2', kind: 'fill', d: 'M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20z', cut: 'M8.8 9.2a3.2 3.2 0 1 1 3.4 3.5L8.8 16.5h6.6' },
  { id: 'badge3', kind: 'fill', d: 'M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20z', cut: 'M8.8 8.5h6.4l-3.2 3.3a3.1 3.1 0 1 1-3.1 3.6' }
]

export const STICKER_SHAPE_IDS: readonly StickerShapeId[] = STICKER_SHAPES.map((s) => s.id)

export function stickerShape(id: string): StickerShape | null {
  return (STICKER_SHAPES as readonly StickerShape[]).find((s) => s.id === id) ?? null
}
