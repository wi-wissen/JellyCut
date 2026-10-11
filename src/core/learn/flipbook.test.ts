import { describe, expect, it } from 'vitest'
import { changedMask, countSet } from './demo'
import { buildFlipbook, changeKinds, composeFrame, coverMask, flipbookKinds, INSIDE_CHANGE, NEWLY_COVERED, type Sprite, UNCOVERED } from './flipbook'

const grey = (w: number, h: number, value: number) => {
  const pixels = new Uint8ClampedArray(w * h * 4).fill(value)
  for (let p = 3; p < pixels.length; p += 4) pixels[p] = 255
  return pixels
}

/** A sprite of `width` x 1 pixels: opaque with the given red values, or transparent where the value is null. */
function row(values: (number | null)[]): Sprite {
  const pixels = new Uint8ClampedArray(values.length * 4)
  values.forEach((v, i) => pixels.set([v ?? 0, 0, 0, v === null ? 0 : 255], i * 4))
  return { width: values.length, height: 1, pixels }
}

describe('compositing', () => {
  it('draws the sprite over the plate and keeps the plate elsewhere', () => {
    const plate = grey(6, 1, 200)
    const frame = composeFrame(plate, 6, 1, row([30, 30]), 2, 0)
    expect([...frame.slice(0, 4)]).toEqual([200, 200, 200, 255])
    expect(frame[2 * 4]).toBe(30)
    expect(frame[3 * 4]).toBe(30)
    expect(frame[4 * 4]).toBe(200)
    expect(plate[2 * 4]).toBe(200)
  })

  it('clips the sprite at the picture edges', () => {
    const frame = composeFrame(grey(4, 1, 200), 4, 1, row([30, 30, 30]), -1, 0)
    expect([...frame.filter((_, i) => i % 4 === 0)]).toEqual([30, 30, 200, 200])
    expect(countSet(coverMask(row([30, 30, 30]), 4, 1, 3, 0))).toBe(1)
  })

  it('treats partly transparent pixels as not covering the picture', () => {
    const sprite: Sprite = { width: 2, height: 1, pixels: new Uint8ClampedArray([30, 0, 0, 127, 30, 0, 0, 128]) }
    expect([...coverMask(sprite, 2, 1, 0, 0)]).toEqual([0, 1])
    expect(composeFrame(grey(2, 1, 200), 2, 1, sprite, 0, 0)[0]).toBe(200)
  })
})

describe('flipbook frames', () => {
  // A 20 x 3 picture: grey background, a dark subject 8 px wide that moves 5 px to the right.
  const width = 20
  const height = 3
  const plate = grey(width, height, 200)
  const subject = row([30, 30, 30, 30, 30, 30, 30, 30])
  subject.height = height
  subject.pixels = new Uint8ClampedArray(8 * height * 4)
  for (let p = 0; p < 8 * height; p++) subject.pixels.set([30, 30, 30, 255], p * 4)

  it('moves only the subject: the plate is identical in every frame', () => {
    const book = buildFlipbook(plate, width, height, subject, [4, 9], 0)
    book.frames.forEach((frame, k) => {
      for (let p = 0; p < width * height; p++) if (!book.covers[k]![p]) expect(frame[p * 4]).toBe(200)
    })
    expect(book.frames[1]![9 * 4]).toBe(30)
    expect(book.frames[1]![4 * 4]).toBe(200)
  })

  it('marks the leading edge as newly covered and the trailing edge as uncovered', () => {
    const book = buildFlipbook(plate, width, height, subject, [4, 9], 0)
    const kinds = flipbookKinds(book, width, height, 12)
    expect([...kinds[0]!]).toEqual(new Array(width * height).fill(0))
    const expected = Array.from({ length: width }, (_, x) => (x >= 4 && x <= 8 ? UNCOVERED : x >= 12 && x <= 16 ? NEWLY_COVERED : 0))
    expect([...kinds[1]!.slice(0, width)]).toEqual(expected)
  })

  it('counts the uncovered background as changed, so both edges show up', () => {
    const book = buildFlipbook(plate, width, height, subject, [4, 9], 0)
    const changed = changedMask(book.frames[0]!, book.frames[1]!, 12)
    expect(countSet(changed)).toBe(10 * height)
    const kinds = changeKinds(changed, book.covers[0]!, book.covers[1]!)
    expect(kinds.filter((k) => k === NEWLY_COVERED).length).toBe(5 * height)
    expect(kinds.filter((k) => k === UNCOVERED).length).toBe(5 * height)
    expect(kinds.filter((k) => k === INSIDE_CHANGE).length).toBe(0)
  })

  it('reports the texture inside the subject as changed when it moves under it', () => {
    const textured: Sprite = { width: 8, height, pixels: new Uint8ClampedArray(8 * height * 4) }
    for (let p = 0; p < 8 * height; p++) textured.pixels.set([10 + (p % 8) * 30, 0, 0, 255], p * 4)
    const book = buildFlipbook(plate, width, height, textured, [4, 5], 0)
    const kinds = flipbookKinds(book, width, height, 12)
    // Columns 5 to 11 are covered by both positions; the texture shifted by one column, so all of them change.
    expect(kinds[1]!.filter((k) => k === INSIDE_CHANGE).length).toBe(7 * height)
    expect(kinds[1]!.filter((k) => k === NEWLY_COVERED).length).toBe(height)
  })

  it('shows nothing changing when the subject stands still', () => {
    const book = buildFlipbook(plate, width, height, subject, [6, 6, 6], 0)
    expect(flipbookKinds(book, width, height, 0).every((kind) => kind.every((v) => v === 0))).toBe(true)
  })
})
