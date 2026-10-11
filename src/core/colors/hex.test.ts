import { describe, expect, it } from 'vitest'
import { isHexColor, normalizeHex } from './hex'
import { TAILWIND_NEUTRALS, TAILWIND_ROWS, TAILWIND_SHADES } from './tailwindPalette'

describe('normalizeHex', () => {
  it('accepts #rrggbb and rrggbb, in any case, and returns lower case', () => {
    expect(normalizeHex('#3B82F6')).toBe('#3b82f6')
    expect(normalizeHex('3b82f6')).toBe('#3b82f6')
  })

  it('expands #rgb', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('f0a')).toBe('#ff00aa')
  })

  it('trims surrounding spaces', () => {
    expect(normalizeHex('  #fff  ')).toBe('#ffffff')
  })

  it('rejects other lengths, other characters and empty input', () => {
    for (const bad of ['', '#', '#12345', '#1234567', '#ffffff00', 'zzz', '#gg0000', 'rgb(1,2,3)', '##fff']) {
      expect(normalizeHex(bad), bad).toBeNull()
      expect(isHexColor(bad), bad).toBe(false)
    }
  })
})

describe('tailwind palette', () => {
  it('has 22 hues with one colour per shade from 50 to 950', () => {
    expect(TAILWIND_ROWS).toHaveLength(22)
    expect(TAILWIND_SHADES).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
    for (const row of TAILWIND_ROWS) {
      expect(row.hexes).toHaveLength(TAILWIND_SHADES.length)
      for (const hex of row.hexes) expect(normalizeHex(hex)).toBe(hex)
    }
  })

  it('stores exact sRGB values of the installed theme and white and black', () => {
    expect(TAILWIND_ROWS.find((r) => r.hue === 'red')!.hexes[5]).toBe('#fb2c36')
    expect(TAILWIND_NEUTRALS).toEqual([
      { name: 'white', hex: '#ffffff' },
      { name: 'black', hex: '#000000' }
    ])
  })
})
