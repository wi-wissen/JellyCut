const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Lower-case #rrggbb for #rgb or #rrggbb input (the # is optional); null for anything else. */
export function normalizeHex(input: string): string | null {
  const match = HEX.exec(input.trim())
  if (!match) return null
  const digits = match[1]!.toLowerCase()
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits
  return `#${full}`
}

export function isHexColor(input: string): boolean {
  return normalizeHex(input) !== null
}
