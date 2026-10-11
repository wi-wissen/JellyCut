import { describe, expect, it } from 'vitest'

/** Every component source under src/ui, keyed by its path relative to this folder. */
const SOURCES = import.meta.glob('./**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Attributes that reach assistive technology or tooltips and must come from $t when they hold words. */
const TEXT_ATTRIBUTES = ['title', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'placeholder', 'alt', 'label']

/**
 * The template part of an SFC with comments blanked out (newlines kept, so offsets and lines still match the file).
 * Interpolations and bound attributes are code, so they are blanked by the scanner, not here.
 */
function templateOf(source: string): { text: string; offset: number } {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  if (start < 0 || end < 0) return { text: '', offset: 0 }
  const body = source.slice(start + '<template>'.length, end).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
  return { text: body, offset: start + '<template>'.length }
}

export interface Finding {
  line: number
  kind: 'text' | 'attribute'
  value: string
}

/** Finds user-visible words in a template that are not translated: text nodes and static text attributes. */
export function findHardcodedStrings(source: string): Finding[] {
  const { text: template, offset } = templateOf(source)
  const findings: Finding[] = []
  const lineOf = (index: number) => source.slice(0, offset + index).split('\n').length

  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tag.exec(template))) {
    const text = template.slice(last, m.index).replace(/\{\{[\s\S]*?\}\}/g, ' ').trim()
    if (/\p{L}{2,}/u.test(text)) findings.push({ line: lineOf(last), kind: 'text', value: text.replace(/\s+/g, ' ') })
    last = m.index + m[0].length
    if (m[1] === '/' || m[3]!.trim().endsWith('/')) continue
    for (const attr of TEXT_ATTRIBUTES) {
      const match = new RegExp(`\\s${attr}="([^"]*)"`).exec(m[3]!)
      if (match && /\p{L}{2,}/u.test(match[1]!)) findings.push({ line: lineOf(m.index), kind: 'attribute', value: `${attr}="${match[1]}"` })
      // Bound attributes with a quoted literal, e.g. :title="open ? 'Close' : 'Open'", are hardcoded too.
      const bound = new RegExp(`\\s:${attr}="([^"]*)"`).exec(m[3]!)
      if (bound && /'[^']*\p{L}{2,}/u.test(bound[1]!) && !/\$?t\(/.test(bound[1]!)) {
        findings.push({ line: lineOf(m.index), kind: 'attribute', value: `:${attr}="${bound[1]}"` })
      }
    }
  }
  return findings
}

describe('templates use translated text only', () => {
  it('has no hardcoded user-visible strings in src/ui/**/*.vue', () => {
    expect(allReports(findHardcodedStrings)).toEqual([])
  })
})

describe('findHardcodedStrings', () => {
  it('flags static text nodes and attributes', () => {
    const src = '<template><button title="Close">Done</button><input :placeholder="$t(\'a\')" /></template>'
    expect(findHardcodedStrings(src).map((f) => f.value)).toEqual(['title="Close"', 'Done'])
  })

  it('flags quoted literals in bound attributes, not translated ones', () => {
    const src = `<template><button :aria-label="open ? 'Close' : $t('x')"></button><i :title="'Save'"></i></template>`
    expect(findHardcodedStrings(src).map((f) => f.value)).toEqual([`:title="'Save'"`])
  })

  it('ignores interpolations, bound attributes, comments and symbols', () => {
    const src = '<template><!-- Text here --><span :title="t">{{ $t("x") }}</span><i aria-label="×">✕</i></template>'
    expect(findHardcodedStrings(src)).toEqual([])
  })
})

interface Tag {
  name: string
  attrs: string
  closing: boolean
  index: number
  line: number
}

function tagsOf(source: string): Tag[] {
  const template = templateOf(source).text
  const offset = templateOf(source).offset
  const tags: Tag[] = []
  for (const m of template.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    tags.push({ name: m[2]!.toLowerCase(), attrs: m[3]!, closing: m[1] === '/', index: m.index!, line: source.slice(0, offset + m.index!).split('\n').length })
  }
  return tags
}

/** True when the attribute list names the element: aria-label, aria-labelledby, title (static or bound). */
function hasAccessibleNameAttr(attrs: string): boolean {
  return /\s:?(aria-label|aria-labelledby|title)="/.test(attrs)
}

/** Buttons and links need a name: visible text, or aria-label / aria-labelledby / title. */
export function findUnnamedButtons(source: string): Finding[] {
  const template = templateOf(source).text
  const offset = templateOf(source).offset
  const findings: Finding[] = []
  for (const m of template.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    if (hasAccessibleNameAttr(m[2]!)) continue
    // Strip nested tags (icons are components or svg); interpolations count as text.
    const text = m[3]!.replace(/<[^>]*>/g, '').trim()
    if (text === '') findings.push({ line: source.slice(0, offset + m.index!).split('\n').length, kind: 'attribute', value: `<${m[1]}> without a name` })
  }
  return findings
}

/** Inputs need a label: a wrapping label, a for= label (static or bound), aria-label or aria-labelledby. */
export function findUnlabelledInputs(source: string): Finding[] {
  const tags = tagsOf(source)
  const findings: Finding[] = []
  const labelled = new Set(tags.flatMap((t) => [...t.attrs.matchAll(/\s:?for="([^"]+)"/g)].map((m) => m[1]!)))
  let labelDepth = 0
  for (const tag of tags) {
    if (tag.name === 'label') {
      labelDepth += tag.closing ? -1 : 1
      continue
    }
    if (tag.closing || !['input', 'select', 'textarea'].includes(tag.name)) continue
    if (/\stype="(hidden|button|submit|reset)"/.test(tag.attrs)) continue
    if (labelDepth > 0 || hasAccessibleNameAttr(tag.attrs)) continue
    const id = tag.attrs.match(/\s:?id="([^"]+)"/)?.[1]
    if (id !== undefined && labelled.has(id)) continue
    findings.push({ line: tag.line, kind: 'attribute', value: `<${tag.name}> without a label` })
  }
  return findings
}

/** Dialogs need a name and an explicit aria-modal (true for modal dialogs, false for popovers). */
export function findDialogProblems(source: string): Finding[] {
  const findings: Finding[] = []
  for (const tag of tagsOf(source)) {
    if (tag.closing || !/\srole="(dialog|alertdialog)"/.test(tag.attrs)) continue
    if (!hasAccessibleNameAttr(tag.attrs)) findings.push({ line: tag.line, kind: 'attribute', value: 'dialog without aria-labelledby or aria-label' })
    // Popovers are non-modal dialogs; they say so with aria-modal="false" rather than leaving it out.
    if (!/\saria-modal="(true|false)"/.test(tag.attrs)) findings.push({ line: tag.line, kind: 'attribute', value: 'dialog without aria-modal' })
  }
  return findings
}

/** aria-labelledby and aria-describedby must point at an id that exists in the same component. */
export function findDanglingReferences(source: string): Finding[] {
  const tags = tagsOf(source)
  const ids = new Set(tags.flatMap((t) => [...t.attrs.matchAll(/\s:?id="([^"]+)"/g)].map((m) => m[1]!)))
  const findings: Finding[] = []
  for (const tag of tags) {
    for (const m of tag.attrs.matchAll(/\s:?(aria-labelledby|aria-describedby)="([^"]+)"/g)) {
      // Only plain ids are checked; expressions and template strings are built at runtime.
      const ref = m[2]!
      if (!/^[\w-]+$/.test(ref)) continue
      if (!ids.has(ref)) findings.push({ line: tag.line, kind: 'attribute', value: `${m[1]}="${ref}" has no matching id` })
    }
  }
  return findings
}

/** Removing the focus ring without a visible replacement. */
export function findInvisibleFocus(source: string): Finding[] {
  const findings: Finding[] = []
  for (const tag of tagsOf(source)) {
    const cls = tag.attrs.match(/\sclass="([^"]*)"/)?.[1] ?? ''
    if (/(^|\s)(focus:)?outline-(none|0)(\s|$)/.test(cls) && !/focus-visible:(ring|outline)/.test(cls)) {
      findings.push({ line: tag.line, kind: 'attribute', value: `class="${cls}" removes the focus outline` })
    }
  }
  return findings
}

const allReports = (check: (source: string) => Finding[]) =>
  Object.entries(SOURCES).flatMap(([file, source]) => check(source).map((f) => `${file.replace('./', '')}:${f.line} ${f.value}`))

describe('interactive elements have accessible names', () => {
  it('every button and link has a name', () => {
    expect(allReports(findUnnamedButtons)).toEqual([])
  })

  it('every input, select and textarea has a label', () => {
    expect(allReports(findUnlabelledInputs)).toEqual([])
  })

  it('every dialog is named, and modal dialogs are marked modal', () => {
    expect(allReports(findDialogProblems)).toEqual([])
  })

  it('aria-labelledby and aria-describedby point at existing ids', () => {
    expect(allReports(findDanglingReferences)).toEqual([])
  })

  it('no element removes the focus outline without a visible replacement', () => {
    expect(allReports(findInvisibleFocus)).toEqual([])
  })
})
