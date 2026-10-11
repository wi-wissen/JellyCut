import { describe, expect, it } from 'vitest'
import css from './tokens.css?raw'

/** Declarations of the first block whose selector matches; the light block is the bare :root. */
function tokensIn(blockStart: RegExp): Record<string, string> {
  const match = blockStart.exec(css)
  if (!match) throw new Error(`block not found: ${blockStart}`)
  const body = css.slice(match.index + match[0].length, css.indexOf('}', match.index + match[0].length))
  const out: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/--(jc-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[name!] = value!
  return out
}

const light = tokensIn(/:root \{/)
// The dark values are repeated for the system preference and for data-theme; both must agree.
const darkSystem = tokensIn(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \{/)
const darkForced = tokensIn(/:root\[data-theme='dark'\] \{/)
const dark = { ...light, ...darkForced }

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// Text pairs that must reach 4.5:1 (WCAG AA, normal text) in both themes.
const TEXT_PAIRS: [string, string][] = [
  ['jc-fg', 'jc-bg'],
  ['jc-fg', 'jc-panel'],
  ['jc-fg', 'jc-panel2'],
  ['jc-muted', 'jc-bg'],
  ['jc-muted', 'jc-panel'],
  ['jc-muted', 'jc-panel2'],
  ['jc-txt', 'jc-bg'],
  ['jc-txt', 'jc-panel'],
  ['jc-txt', 'jc-panel2'],
  ['jc-fill-fg', 'jc-fill'],
  ['jc-signal-fg', 'jc-signal'],
  ['jc-danger', 'jc-bg'],
  ['jc-danger', 'jc-panel'],
  ['jc-danger', 'jc-panel2']
]

// Focus rings and control borders are non-text content: 3:1 (WCAG 1.4.11).
const NON_TEXT_PAIRS: [string, string][] = [
  ['jc-fill', 'jc-bg'],
  ['jc-fill', 'jc-panel']
]

describe('design tokens', () => {
  it('define the same dark values for the system preference and data-theme', () => {
    expect(darkSystem).toEqual(darkForced)
  })

  for (const [themeName, tokens] of [['light', light], ['dark', dark]] as const) {
    describe(`${themeName} theme`, () => {
      it.each(TEXT_PAIRS)('%s on %s reaches 4.5:1', (fg, bg) => {
        const ratio = contrast(tokens[fg]!, tokens[bg]!)
        expect(ratio, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}`).toBeGreaterThanOrEqual(4.5)
      })

      it.each(NON_TEXT_PAIRS)('%s on %s reaches 3:1', (fg, bg) => {
        const ratio = contrast(tokens[fg]!, tokens[bg]!)
        expect(ratio, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}`).toBeGreaterThanOrEqual(3)
      })
    })
  }

  it('keeps the brand colours violet and lime', () => {
    expect(light['jc-fill']).toBe('#6d4cf5')
    expect(light['jc-signal']).toBe('#c6f432')
  })
})
