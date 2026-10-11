import plateUrl from '../../assets/photos/reef-plate.jpg'
import spriteUrl from '../../assets/photos/turtle-sprite.png'
import type { Sprite } from '../../core/learn/flipbook'

/** A rectangle in the plate photo's own pixels. */
export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

function load(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  return image.decode().then(() => image)
}

function context(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d', { willReadFrequently: true })!
}

/**
 * The empty reef at width x height, optionally cropped first. The same crop gives the same pixels
 * every time, so frames built from it always share one background.
 */
export async function loadPlate(width: number, height: number, crop?: Crop): Promise<Uint8ClampedArray> {
  const image = await load(plateUrl)
  const ctx = context(width, height)
  const c = crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
  ctx.drawImage(image, c.x, c.y, c.width, c.height, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

/** The cut-out turtle scaled once to spriteWidth pixels wide, so every frame blends a small picture. */
export async function loadSprite(spriteWidth: number): Promise<Sprite> {
  const image = await load(spriteUrl)
  const height = Math.round((spriteWidth * image.naturalHeight) / image.naturalWidth)
  const ctx = context(spriteWidth, height)
  ctx.drawImage(image, 0, 0, spriteWidth, height)
  return { width: spriteWidth, height, pixels: ctx.getImageData(0, 0, spriteWidth, height).data }
}
