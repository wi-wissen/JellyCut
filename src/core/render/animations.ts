/**
 * Entrance and exit animations of texts and overlays. Each name says what happens: `slideFromTop` comes in
 * from above, `slideToTop` leaves upwards. Legacy `slideUp` (before directions) maps to the bottom side:
 * in = from bottom, out = to bottom, which is what the old names played.
 */
export const IN_ANIMATIONS = ['fade', 'pop', 'slideFromTop', 'slideFromBottom', 'slideFromLeft', 'slideFromRight'] as const
export const OUT_ANIMATIONS = ['fade', 'pop', 'slideToTop', 'slideToBottom', 'slideToLeft', 'slideToRight'] as const
export type InAnimation = (typeof IN_ANIMATIONS)[number]
export type OutAnimation = (typeof OUT_ANIMATIONS)[number]
export type Side = 'top' | 'bottom' | 'left' | 'right'

export const LEGACY_SLIDE = 'slideUp'

/** Canonical name of a stored animation value for its role, or null when it is not a known name. */
export function canonicalAnimation(name: unknown, role: 'in' | 'out'): string | null {
  if (name === LEGACY_SLIDE) return role === 'in' ? 'slideFromBottom' : 'slideToBottom'
  const list: readonly string[] = role === 'in' ? IN_ANIMATIONS : OUT_ANIMATIONS
  return typeof name === 'string' && list.includes(name) ? name : null
}

/** Kind and side of a canonical animation name. Fade and pop have no side. */
export function parseAnimation(name: string): { kind: 'fade' | 'pop' } | { kind: 'slide'; side: Side } | null {
  if (name === 'fade' || name === 'pop') return { kind: name }
  const match = /^slide(?:From|To)(Top|Bottom|Left|Right)$/.exec(name)
  if (!match) return null
  return { kind: 'slide', side: match[1]!.toLowerCase() as Side }
}
