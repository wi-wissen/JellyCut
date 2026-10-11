import { describe, expect, it } from 'vitest'
import { detectCaps, projectFileName } from './projectFiles'
import { kvGet, kvSet, kvDelete, AUTOSAVE_KEY } from './localStore'

describe('projectFileName', () => {
  it('replaces characters that are unsafe in file names', () => {
    expect(projectFileName('Urlaub/2024: "Tag"')).toBe('Urlaub_2024_ _Tag_.jellycut.json')
  })

  it('falls back when nothing usable is left', () => {
    expect(projectFileName('   ')).toBe('project.jellycut.json')
    expect(projectFileName('...')).toBe('project.jellycut.json')
  })

  it('always ends in .jellycut.json, also for names that already carry an extension', () => {
    expect(projectFileName('Trip.jellycut')).toBe('Trip.jellycut.jellycut.json')
    expect(projectFileName('Sommer  Tag')).toBe('Sommer Tag.jellycut.json')
  })

  it('limits the base name to 60 characters', () => {
    expect(projectFileName('a'.repeat(100))).toBe(`${'a'.repeat(60)}.jellycut.json`)
  })
})

describe('detectCaps without browser APIs', () => {
  it('reports no file or folder pickers in node', () => {
    expect(detectCaps()).toEqual({ filePicker: false, directoryPicker: false })
  })
})

describe('localStore without IndexedDB', () => {
  it('never throws and reports missing storage', async () => {
    expect(AUTOSAVE_KEY).toBe('autosave')
    await expect(kvGet('autosave')).resolves.toBeNull()
    await expect(kvSet('autosave', { text: '', savedAt: 0 })).resolves.toBe(false)
    await expect(kvDelete('autosave')).resolves.toBe(false)
  })
})
