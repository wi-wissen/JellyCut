import { describe, expect, it } from 'vitest'
import { createProject, validateProject } from '../project/schema'
import type { Project } from '../project/types'
import { IN_ANIMATIONS, OUT_ANIMATIONS } from '../render/animations'
import { secondsToMicros } from '../time'
import { DEFAULT_TEXT_DURATION, TEXT_PRESETS, addText, textPreset, updateText } from './textOps'

const s = (seconds: number) => secondsToMicros(seconds)

function fixture(): Project {
  const p = createProject('Text')
  return {
    ...p,
    assets: [{ id: 'a1', kind: 'video', name: 'one.mp4', relPath: 'media/one.mp4', size: 1, duration: s(10), width: 1920, height: 1080, fps: 30 }],
    clips: [
      {
        id: 'clip-1',
        track: 'video',
        assetId: 'a1',
        srcIn: 0,
        srcOut: s(10),
        start: 0,
        speed: 1,
        transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
        volume: 1,
        muted: false,
        filter: null,
        transitionIn: null
      }
    ],
    texts: [
      {
        id: 'text-1',
        start: s(2),
        duration: s(4),
        text: 'Hello',
        style: { font: 'Sora', size: 26, color: '#ffffff', outline: null },
        pos: { x: 0.5, y: 0.85 },
        animIn: null,
        animOut: null
      }
    ]
  }
}

describe('TEXT_PRESETS', () => {
  it('has the six presets from the spec with fonts from the curated list', () => {
    expect(TEXT_PRESETS.map((p) => p.id)).toEqual(['title', 'subtitle', 'neon', 'poster', 'script', 'note'])
    const byId = Object.fromEntries(TEXT_PRESETS.map((p) => [p.id, p]))
    expect(byId.title).toMatchObject({ style: { font: 'Sora', size: 96, color: '#ffffff' } })
    expect(byId.title!.style.outline).not.toBeNull()
    expect(byId.subtitle).toMatchObject({ style: { font: 'Inter', size: 56, color: '#ffffff' }, pos: { x: 0.5, y: 0.85 } })
    expect(byId.neon).toMatchObject({ style: { font: 'Fredoka', size: 80, color: '#c6f432', outline: '#14121f' } })
    expect(byId.poster).toMatchObject({ style: { font: 'Bebas Neue', size: 120, color: '#ffffff', outline: null } })
    expect(byId.script).toMatchObject({ style: { font: 'Pacifico', size: 80, color: '#ffffff' } })
    expect(byId.note).toMatchObject({ style: { font: 'Caveat', size: 72, color: '#ffe066' } })
  })

  it('textPreset falls back to Title for unknown ids', () => {
    expect(textPreset('nope' as never).id).toBe('title')
  })
})

describe('addText', () => {
  it('adds a Title text by default with the default text, duration and centre position', () => {
    const next = addText(fixture(), 'text-2', s(5))
    const added = next.texts.find((t) => t.id === 'text-2')!
    expect(added).toMatchObject({
      start: s(5),
      duration: DEFAULT_TEXT_DURATION,
      text: 'Text',
      pos: { x: 0.5, y: 0.5 },
      animIn: null,
      animOut: null,
      style: { font: 'Sora', size: 96 }
    })
    expect(next.texts).toHaveLength(2)
    expect(validateProject(next).ok).toBe(true)
  })

  it('uses the preset style and position and the given text', () => {
    const next = addText(fixture(), 'text-2', 0, { preset: 'subtitle', text: 'Untertitel' })
    const added = next.texts.find((t) => t.id === 'text-2')!
    expect(added.style).toEqual(textPreset('subtitle').style)
    expect(added.pos).toEqual({ x: 0.5, y: 0.85 })
    expect(added.text).toBe('Untertitel')
    expect(validateProject(next).ok).toBe(true)
  })

  it('gives each new text its own style object', () => {
    const next = addText(fixture(), 'text-2', 0, { preset: 'neon' })
    const added = next.texts.find((t) => t.id === 'text-2')!
    added.style.size = 1
    expect(textPreset('neon').style.size).toBe(80)
  })

  it('clamps a negative start to 0 and rounds the start to whole microseconds', () => {
    expect(addText(fixture(), 'a', -5).texts.at(-1)!.start).toBe(0)
    expect(addText(fixture(), 'a', 1234.6).texts.at(-1)!.start).toBe(1235)
  })

  it('refuses ids that already exist in the project and non-finite starts', () => {
    const p = fixture()
    expect(addText(p, 'text-1', 0)).toBe(p)
    expect(addText(p, 'clip-1', 0)).toBe(p)
    expect(addText(p, 'a1', 0)).toBe(p)
    expect(addText(p, 'new', Number.NaN)).toBe(p)
    expect(addText(p, '', 0)).toBe(p)
  })

  it('does not change the input project', () => {
    const p = fixture()
    const before = JSON.stringify(p)
    addText(p, 'text-2', 0)
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('updateText', () => {
  it('changes the text content', () => {
    const next = updateText(fixture(), 'text-1', { text: 'Hi there' })
    expect(next.texts[0]!.text).toBe('Hi there')
    expect(validateProject(next).ok).toBe(true)
  })

  it('changes style fields and lower-cases colours', () => {
    const next = updateText(fixture(), 'text-1', { style: { font: 'Pacifico', size: 60, color: '#C6F432', outline: '#14121F' } })
    expect(next.texts[0]!.style).toEqual({ font: 'Pacifico', size: 60, color: '#c6f432', outline: '#14121f' })
    expect(validateProject(next).ok).toBe(true)
  })

  it('removes the outline with null', () => {
    const p = updateText(fixture(), 'text-1', { style: { outline: '#000000' } })
    expect(updateText(p, 'text-1', { style: { outline: null } }).texts[0]!.style.outline).toBeNull()
  })

  it('clamps size to 8..400', () => {
    expect(updateText(fixture(), 'text-1', { style: { size: 1 } }).texts[0]!.style.size).toBe(8)
    expect(updateText(fixture(), 'text-1', { style: { size: 900 } }).texts[0]!.style.size).toBe(400)
  })

  it('clamps position to 0..1 per axis and keeps the other axis', () => {
    const next = updateText(fixture(), 'text-1', { pos: { x: -0.4, y: 3 } })
    expect(next.texts[0]!.pos).toEqual({ x: 0, y: 1 })
    expect(updateText(fixture(), 'text-1', { pos: { y: 0.1 } }).texts[0]!.pos).toEqual({ x: 0.5, y: 0.1 })
  })

  it('clamps duration to at least 0.1 s and start to at least 0', () => {
    const next = updateText(fixture(), 'text-1', { duration: 10, start: -100 })
    expect(next.texts[0]!.duration).toBe(100_000)
    expect(next.texts[0]!.start).toBe(0)
  })

  it('sets the animations and refuses unknown ones', () => {
    const p = updateText(fixture(), 'text-1', { animIn: 'pop', animOut: 'slideToTop' })
    expect(p.texts[0]).toMatchObject({ animIn: 'pop', animOut: 'slideToTop' })
    expect(updateText(fixture(), 'text-1', { animIn: 'slideToTop' as never })).toEqual(fixture())
    expect(updateText(fixture(), 'text-1', { animOut: 'slideUp' as never })).toEqual(fixture())
    expect(updateText(p, 'text-1', { animIn: null }).texts[0]!.animIn).toBeNull()
    expect(updateText(fixture(), 'text-1', { animIn: 'spin' as never })).toEqual(fixture())
  })

  it('accepts every animation the renderer knows', () => {
    for (const anim of IN_ANIMATIONS) {
      expect(updateText(fixture(), 'text-1', { animIn: anim }).texts[0]!.animIn).toBe(anim)
    }
    for (const anim of OUT_ANIMATIONS) {
      expect(updateText(fixture(), 'text-1', { animOut: anim }).texts[0]!.animOut).toBe(anim)
    }
  })

  it('rejects a whole patch with an unknown font, a bad colour or a non-finite number', () => {
    const p = fixture()
    expect(updateText(p, 'text-1', { style: { font: 'Comic Sans' } })).toBe(p)
    expect(updateText(p, 'text-1', { style: { color: 'red' } })).toBe(p)
    expect(updateText(p, 'text-1', { style: { outline: '#fff' } })).toBe(p)
    expect(updateText(p, 'text-1', { style: { size: Number.NaN } })).toBe(p)
    expect(updateText(p, 'text-1', { pos: { x: Number.POSITIVE_INFINITY } })).toBe(p)
    expect(updateText(p, 'text-1', { start: Number.NaN })).toBe(p)
    expect(updateText(p, 'text-1', { duration: Number.NaN })).toBe(p)
    expect(updateText(p, 'text-1', { text: 5 as unknown as string })).toBe(p)
  })

  it('applies the valid parts of a multi-field patch only when every field is valid', () => {
    const p = fixture()
    expect(updateText(p, 'text-1', { text: 'New', style: { color: 'nope' } })).toBe(p)
  })

  it('returns the same project for an unknown id or no change', () => {
    const p = fixture()
    expect(updateText(p, 'missing', { text: 'x' })).toBe(p)
    expect(updateText(p, 'text-1', { text: 'Hello' })).toBe(p)
    expect(updateText(p, 'text-1', {})).toBe(p)
  })

  it('does not change the input project', () => {
    const p = fixture()
    const before = JSON.stringify(p)
    updateText(p, 'text-1', { style: { size: 200 }, pos: { x: 0.1 } })
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('texts and the video end', () => {
  it('a new text near the end ends at the end', () => {
    const text = addText(fixture(), 'text-new', s(9.8)).texts.find((t) => t.id === 'text-new')!
    expect(text).toMatchObject({ start: s(9.5), duration: s(0.5) })
  })

  it('a duration edit past the end stops at the end', () => {
    const p = updateText(addText(fixture(), 'text-new', s(1)), 'text-new', { duration: s(20) })
    expect(p.texts.find((t) => t.id === 'text-new')).toMatchObject({ start: s(1), duration: s(9) })
  })

  it('a move past the end stops flush and keeps the length', () => {
    const p = updateText(addText(fixture(), 'text-new', s(1)), 'text-new', { start: s(20) })
    expect(p.texts.find((t) => t.id === 'text-new')).toMatchObject({ start: s(7), duration: DEFAULT_TEXT_DURATION })
  })
})
