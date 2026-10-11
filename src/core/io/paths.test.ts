import { describe, expect, it } from 'vitest'
import { joinRelPath, safePathSegments } from './paths'

describe('safePathSegments', () => {
  it('splits a relative path into segments', () => {
    expect(safePathSegments('media/Beach.mp4')).toEqual(['media', 'Beach.mp4'])
    expect(safePathSegments('Beach.mp4')).toEqual(['Beach.mp4'])
  })
  it('accepts backslashes written by Windows tools', () => {
    expect(safePathSegments('media\\sub\\a.mp4')).toEqual(['media', 'sub', 'a.mp4'])
  })
  it('ignores empty and "." segments', () => {
    expect(safePathSegments('./media//a.mp4')).toEqual(['media', 'a.mp4'])
  })
  it('rejects path traversal', () => {
    for (const p of ['../a.mp4', 'media/../../a.mp4', 'media/..', '..\\a.mp4', 'a/%2e%2e/b']) {
      expect(safePathSegments(p)).toBeNull()
    }
  })
  it('rejects absolute paths and drive letters', () => {
    for (const p of ['/etc/passwd', 'C:\\Users\\x\\a.mp4', 'c:/a.mp4', '\\\\server\\share\\a.mp4', 'file:///a.mp4']) {
      expect(safePathSegments(p)).toBeNull()
    }
  })
  it('rejects empty paths and control characters', () => {
    for (const p of ['', '   ', '/', '.', 'a\u0000b.mp4', 'a\nb.mp4']) {
      expect(safePathSegments(p)).toBeNull()
    }
  })
  it('does not trim or alter normal names with spaces and dots', () => {
    expect(safePathSegments('My Clips/clip.v2.final.mp4')).toEqual(['My Clips', 'clip.v2.final.mp4'])
    expect(safePathSegments('.hidden/file')).toEqual(['.hidden', 'file'])
  })
})

describe('joinRelPath', () => {
  it('joins segments with forward slashes', () => {
    expect(joinRelPath(['media', 'a.mp4'])).toBe('media/a.mp4')
  })
  it('roundtrips with safePathSegments', () => {
    expect(safePathSegments(joinRelPath(['x y', 'b.mov']))).toEqual(['x y', 'b.mov'])
  })
})
