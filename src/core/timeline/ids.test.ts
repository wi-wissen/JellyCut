import { describe, expect, it } from 'vitest'
import { createIdGenerator, nextId } from './ids'

describe('nextId', () => {
  it('starts at 1 when no id matches the prefix', () => {
    expect(nextId([], 'c')).toBe('c1')
    expect(nextId(['clip-intro', 'text-1'], 'c')).toBe('c1')
  })

  it('goes one above the largest matching number', () => {
    expect(nextId(['c1', 'c12', 'c3'], 'c')).toBe('c13')
  })

  it('never returns an existing id, even with gaps or odd padding', () => {
    const existing = ['c2', 'c007']
    const id = nextId(existing, 'c')
    expect(existing).not.toContain(id)
    expect(id).toBe('c8')
  })

  it('does not treat prefix look-alikes as matches', () => {
    expect(nextId(['clip-5', 'xclip-9', 'clip-5x', 'clip-'], 'clip-')).toBe('clip-6')
  })

  it('escapes regular expression characters in the prefix', () => {
    expect(nextId(['a.1', 'aX1'], 'a.')).toBe('a.2')
  })

  it('ignores numbers that are not safe integers', () => {
    expect(nextId(['c99999999999999999999999'], 'c')).toBe('c1')
  })

  it('accepts any iterable', () => {
    expect(nextId(new Set(['c4']), 'c')).toBe('c5')
  })
});

describe('createIdGenerator', () => {
  it('never issues the same id twice, even when the project has not been updated', () => {
    const next = createIdGenerator('clip-')
    const first = next([])
    const second = next([])
    expect(first).toBe('clip-1')
    expect(second).toBe('clip-2')
  })

  it('also respects ids that already exist', () => {
    const next = createIdGenerator('c')
    expect(next(['c1', 'c2'])).toBe('c3')
    expect(next(['c1', 'c2'])).toBe('c4')
  })
})
