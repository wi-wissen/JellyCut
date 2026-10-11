// Detecting a picture that is black, and remembering which assets needed the fallback to the media element.

/** Largest colour channel value (0..255) still counted as black; compression noise and dark mattes stay below it. */
const BLACK_CHANNEL_MAX = 10

/** True when every pixel of the RGBA data is black (or transparent black). Empty data counts as black. */
export function isNearlyBlack(rgba: ArrayLike<number>): boolean {
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    if (rgba[i]! > BLACK_CHANNEL_MAX || rgba[i + 1]! > BLACK_CHANNEL_MAX || rgba[i + 2]! > BLACK_CHANNEL_MAX) return false
  }
  return true
}

/** Why the exact (WebCodecs) frame was not used: no frame at all, an error, or a black picture where the element has one. */
export type FallbackReason = 'missing' | 'error' | 'black'

/** Remembers the assets whose paused picture came from the media element; `note` is true only the first time per asset. */
export class FallbackLog {
  private reasons = new Map<string, FallbackReason>()

  note(assetId: string, reason: FallbackReason): boolean {
    if (this.reasons.has(assetId)) return false
    this.reasons.set(assetId, reason)
    return true
  }

  has(assetId: string): boolean {
    return this.reasons.has(assetId)
  }

  reasonOf(assetId: string): FallbackReason | undefined {
    return this.reasons.get(assetId)
  }

  get assets(): string[] {
    return [...this.reasons.keys()]
  }
}
