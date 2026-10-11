import { describe, expect, it } from 'vitest'
import { CURATED_FONTS, DEFAULT_FONT, canvasFont, fontWeight } from './fonts'

describe('curated fonts', () => {
  it('contains the default font and has unique families', () => {
    const families = CURATED_FONTS.map((f) => f.family)
    expect(families).toContain(DEFAULT_FONT)
    expect(new Set(families).size).toBe(families.length)
  })
  it('uses the only available weight for display fonts', () => {
    expect(fontWeight('Bebas Neue')).toBe(400)
    expect(fontWeight('Pacifico')).toBe(400)
    expect(fontWeight('Sora')).toBe(700)
  })
  it('falls back to bold for unknown families', () => {
    expect(fontWeight('Nonexistent')).toBe(700)
  })
  it('builds a canvas font string and strips quote characters from the family', () => {
    expect(canvasFont('Sora', 64)).toBe('700 64px "Sora", system-ui, sans-serif')
    expect(canvasFont('Ev"il\\', 10)).toBe('700 10px "Evil", system-ui, sans-serif')
  })
})
