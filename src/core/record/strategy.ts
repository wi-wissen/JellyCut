// Which way the screen picture reaches the MediaRecorder, and when to switch. No DOM.
//
// 'raw'    the display video track is recorded as it is (what the WebRTC samples, MDN and the mature recorders do).
// 'canvas' the picture is re-drawn onto a canvas at 30 fps first; only a fallback for shares that deliver no frames.

export type CaptureStrategy = 'raw' | 'canvas'
export type VideoProblem = 'noFrames' | 'black'

export const DEFAULT_STRATEGY: CaptureStrategy = 'raw'

export interface StrategyMemory {
  strategy: CaptureStrategy
  /** Problem seen with the strategy before the current one; null when the last switch had no precedent. */
  lastProblem: VideoProblem | null
}

export const DEFAULT_MEMORY: StrategyMemory = { strategy: DEFAULT_STRATEGY, lastProblem: null }

export function parseStrategyMemory(raw: string | null): StrategyMemory {
  if (!raw) return { ...DEFAULT_MEMORY }
  try {
    const value = JSON.parse(raw) as Partial<StrategyMemory>
    const strategy: CaptureStrategy = value.strategy === 'canvas' ? 'canvas' : 'raw'
    const lastProblem = value.lastProblem === 'noFrames' || value.lastProblem === 'black' ? value.lastProblem : null
    return { strategy, lastProblem }
  } catch {
    return { ...DEFAULT_MEMORY }
  }
}

export function serializeStrategyMemory(memory: StrategyMemory): string {
  return JSON.stringify(memory)
}

export interface StrategyDecision {
  memory: StrategyMemory
  /** True when the next recording will use the other way and the user should be told. */
  switched: boolean
}

/**
 * Decides the way for the next screen recording from what just happened.
 * - No problem: keep the way that worked, forget the last problem.
 * - Problem: switch to the other way - unless the previous recording already had a problem with the other way
 *   (then both fail, the content is the cause, e.g. protected windows) and switching again would only flip-flop.
 */
export function decideNextStrategy(memory: StrategyMemory, used: CaptureStrategy, problem: VideoProblem | null): StrategyDecision {
  if (!problem) return { memory: { strategy: used, lastProblem: null }, switched: false }
  if (memory.lastProblem !== null && memory.strategy === used) {
    return { memory: { strategy: used, lastProblem: problem }, switched: false }
  }
  const other: CaptureStrategy = used === 'raw' ? 'canvas' : 'raw'
  return { memory: { strategy: other, lastProblem: problem }, switched: true }
}
