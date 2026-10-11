// Decorative motion is only switched on when the visitor has not asked for less of it.
export function motionAllowed(): boolean {
  return !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window
}

export function fineHover(): boolean {
  return matchMedia('(hover: hover) and (pointer: fine)').matches
}
