import { describe, expect, it } from 'vitest'
import { exportFileName } from './filename'

describe('exportFileName', () => {
  it('keeps a plain name and adds the extension', () => {
    expect(exportFileName('Summer trip', 'mp4')).toBe('Summer trip.mp4')
    expect(exportFileName('Summer trip', '.mp4')).toBe('Summer trip.mp4')
  })

  it('replaces characters that are not allowed in file names', () => {
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', 'mp4')).toBe('a-b-c-d-e-f-g-h-i-j.mp4')
  })

  it('replaces control characters and collapses whitespace', () => {
    expect(exportFileName('  one\t\ttwo \n three  ', 'mp4')).toBe('one two three.mp4')
    expect(exportFileName('bell\u0007name', 'mp4')).toBe('bell-name.mp4')
  })

  it('trims dots and spaces from both ends', () => {
    expect(exportFileName('..  Trip. ..', 'mp4')).toBe('Trip.mp4')
  })

  it('falls back to jelly-cut when nothing is left', () => {
    expect(exportFileName('', 'mp4')).toBe('jelly-cut.mp4')
    expect(exportFileName('   ...   ', 'mp4')).toBe('jelly-cut.mp4')
  })

  it('limits the whole file name to 80 characters', () => {
    const name = exportFileName('x'.repeat(200), 'mp4')
    expect(name.length).toBe(80)
    expect(name.endsWith('.mp4')).toBe(true)
  })

  it('does not leave a dot or space at the end after cutting', () => {
    const name = exportFileName(`${'a'.repeat(70)} ${'b'.repeat(20)}`, 'mp4')
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name).not.toMatch(/ \.mp4$/)
  })

  it('counts code points, not UTF-16 units, when cutting', () => {
    const name = exportFileName('🎬'.repeat(100), 'mp4')
    expect(Array.from(name.replace(/\.mp4$/, '')).length).toBe(76)
  })

  it('appends a dash to Windows reserved names', () => {
    expect(exportFileName('CON', 'mp4')).toBe('CON-.mp4')
    expect(exportFileName('nul', 'mp4')).toBe('nul-.mp4')
    expect(exportFileName('com1', 'mp4')).toBe('com1-.mp4')
    expect(exportFileName('LPT9', 'mp4')).toBe('LPT9-.mp4')
  })

  it('does not change names that only contain a reserved word', () => {
    expect(exportFileName('CONCERT', 'mp4')).toBe('CONCERT.mp4')
    expect(exportFileName('com10', 'mp4')).toBe('com10.mp4')
  })

  it('keeps German umlauts', () => {
    expect(exportFileName('Schulausflug Ängste', 'mp4')).toBe('Schulausflug Ängste.mp4')
  })
})
