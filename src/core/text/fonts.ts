/** Curated fonts for text items. All are self-hosted via Fontsource (SIL OFL 1.1). */
export interface CuratedFont {
  family: string
  /** The one weight we load and draw with (some display fonts only exist in 400). */
  weight: 400 | 500 | 600 | 700
}

export const CURATED_FONTS: readonly CuratedFont[] = [
  { family: 'Sora', weight: 700 },
  { family: 'Inter', weight: 700 },
  { family: 'Lora', weight: 700 },
  { family: 'Bebas Neue', weight: 400 },
  { family: 'Pacifico', weight: 400 },
  { family: 'Caveat', weight: 700 },
  { family: 'Fredoka', weight: 600 },
  { family: 'DM Mono', weight: 500 }
]

export const DEFAULT_FONT = 'Sora'

/** Weight used when drawing the given family; unknown families fall back to bold. */
export function fontWeight(family: string): number {
  return CURATED_FONTS.find((f) => f.family === family)?.weight ?? 700
}

/** CSS font shorthand for the 2D canvas, e.g. `700 64px "Sora", system-ui, sans-serif`. */
export function canvasFont(family: string, sizePx: number): string {
  const safe = family.replace(/["\\]/g, '')
  return `${fontWeight(family)} ${sizePx}px "${safe}", system-ui, sans-serif`
}
