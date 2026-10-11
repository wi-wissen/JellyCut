import type { MediaOverlay } from '../project/types'
import type { OverlayPatch } from './overlayOps'

/** Picture-in-picture shapes offered in the panel. Round is a circle of the centre square of the picture. */
export const PICTURE_SHAPES = ['rect', 'rounded', 'round'] as const
export type PictureShape = (typeof PICTURE_SHAPES)[number]

/** Corner radius of 'rounded' pictures, as a fraction of the output height. */
export const PICTURE_ROUNDED_RADIUS = 0.04
/** Half the box side: on a square box this is a circle (the compositor never radiuses past half the box). */
export const PICTURE_ROUND_RADIUS = 0.5

const SQUARE_EPSILON = 1e-6

/** Which shape preset a picture box matches. Anything with corners that is not square and round is 'rounded' or 'rect'. */
export function pictureShapeOf(item: Pick<MediaOverlay, 'width' | 'height' | 'radius'>): PictureShape {
  if (Math.abs(item.width - item.height) < SQUARE_EPSILON && item.radius >= PICTURE_ROUND_RADIUS - SQUARE_EPSILON) return 'round'
  return item.radius > 0 ? 'rounded' : 'rect'
}

/**
 * The patch that gives a picture one of the shape presets. 'rect' and 'rounded' keep the asset's own
 * proportions at the current height; 'round' makes a square of that height, so the centre square shows.
 */
export function pictureShapePatch(shape: PictureShape, item: Pick<MediaOverlay, 'height'>, assetAspect: number): OverlayPatch {
  if (shape === 'round') return { width: item.height, height: item.height, radius: PICTURE_ROUND_RADIUS }
  const aspect = Number.isFinite(assetAspect) && assetAspect > 0 ? assetAspect : 16 / 9
  return { width: item.height * aspect, height: item.height, radius: shape === 'rounded' ? PICTURE_ROUNDED_RADIUS : 0 }
}
