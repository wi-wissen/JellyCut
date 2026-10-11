import { describe, expect, it } from 'vitest'
import { DEFAULT_MEMORY, decideNextStrategy, parseStrategyMemory, serializeStrategyMemory } from './strategy'

describe('decideNextStrategy', () => {
  it('starts with the direct way and keeps a way that worked', () => {
    expect(DEFAULT_MEMORY.strategy).toBe('raw')
    expect(decideNextStrategy(DEFAULT_MEMORY, 'raw', null)).toEqual({ memory: { strategy: 'raw', lastProblem: null }, switched: false })
  })

  it('switches to the canvas way after black or missing pictures, and tells the user', () => {
    for (const problem of ['black', 'noFrames'] as const) {
      const next = decideNextStrategy(DEFAULT_MEMORY, 'raw', problem)
      expect(next).toEqual({ memory: { strategy: 'canvas', lastProblem: problem }, switched: true })
    }
  })

  it('does not flip-flop when the canvas way fails too: the content is the cause', () => {
    const afterRaw = decideNextStrategy(DEFAULT_MEMORY, 'raw', 'black').memory
    const afterCanvas = decideNextStrategy(afterRaw, 'canvas', 'black')
    expect(afterCanvas.switched).toBe(false)
    expect(afterCanvas.memory.strategy).toBe('canvas')
  })

  it('a good recording on the new way clears the problem and stays there', () => {
    const afterRaw = decideNextStrategy(DEFAULT_MEMORY, 'raw', 'noFrames').memory
    expect(decideNextStrategy(afterRaw, 'canvas', null).memory).toEqual({ strategy: 'canvas', lastProblem: null })
  })

  it('tries the other way again for a later problem on the remembered way after a success', () => {
    const memory = { strategy: 'canvas' as const, lastProblem: null }
    expect(decideNextStrategy(memory, 'canvas', 'black')).toEqual({ memory: { strategy: 'raw', lastProblem: 'black' }, switched: true })
  })
})

describe('strategy memory storage', () => {
  it('round-trips and survives garbage', () => {
    const memory = { strategy: 'canvas' as const, lastProblem: 'black' as const }
    expect(parseStrategyMemory(serializeStrategyMemory(memory))).toEqual(memory)
    expect(parseStrategyMemory(null)).toEqual(DEFAULT_MEMORY)
    expect(parseStrategyMemory('{not json')).toEqual(DEFAULT_MEMORY)
    expect(parseStrategyMemory('{"strategy":"x","lastProblem":5}')).toEqual(DEFAULT_MEMORY)
  })
})
