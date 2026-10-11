import { describe, expect, it } from 'vitest'
import de from './de.json'
import en from './en.json'

type Messages = { [key: string]: Messages | string }

/** Flattens nested messages to dotted keys. */
function flatten(node: Messages, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else for (const [k, v] of flatten(value, path)) out.set(k, v)
  }
  return out
}

/** Named placeholders in vue-i18n syntax, e.g. {name}. Literal braces are not used in the messages. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!).sort()
}

const deMessages = flatten(de as Messages)
const enMessages = flatten(en as Messages)

describe('locale files', () => {
  it('de.json and en.json have identical key sets', () => {
    const onlyDe = [...deMessages.keys()].filter((k) => !enMessages.has(k))
    const onlyEn = [...enMessages.keys()].filter((k) => !deMessages.has(k))
    expect({ onlyDe, onlyEn }).toEqual({ onlyDe: [], onlyEn: [] })
  })

  it('has no empty or whitespace-only values', () => {
    for (const messages of [deMessages, enMessages]) {
      const empty = [...messages].filter(([, value]) => value.trim() === '').map(([key]) => key)
      expect(empty).toEqual([])
    }
  })

  it('uses the same {placeholders} in both languages for every key', () => {
    const mismatched: string[] = []
    for (const [key, deValue] of deMessages) {
      const enValue = enMessages.get(key)
      if (enValue === undefined) continue
      if (placeholders(deValue).join(',') !== placeholders(enValue).join(',')) mismatched.push(key)
    }
    expect(mismatched).toEqual([])
  })

  it('has balanced braces in every message', () => {
    const broken = [...deMessages, ...enMessages].filter(([, value]) => {
      const opens = (value.match(/\{/g) ?? []).length
      const closes = (value.match(/\}/g) ?? []).length
      return opens !== closes
    })
    expect(broken.map(([key]) => key)).toEqual([])
  })
})
