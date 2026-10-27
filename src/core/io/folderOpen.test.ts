import { describe, expect, it } from 'vitest'
import { isProjectFileName, planFolderOpen } from './folderOpen'

const entry = (key: string) => ({ key, name: key.slice(key.lastIndexOf('/') + 1) })

describe('isProjectFileName', () => {
  it('accepts both project extensions in any case', () => {
    for (const name of ['a.jellycut.json', 'B.JellyCut', 'koch 2.jellycut.json']) expect(isProjectFileName(name)).toBe(true)
  })
  it('rejects other json files and bare extensions', () => {
    for (const name of ['data.json', '.jellycut', 'jellycut', 'a.jellycut.txt']) expect(isProjectFileName(name)).toBe(false)
  })
})

describe('planFolderOpen', () => {
  it('finds project files at the top level only and media everywhere, sorted naturally', () => {
    const plan = planFolderOpen(['clip10.mp4', 'clip2.mp4', 'sub/b.jellycut.json', 'sub/pic.PNG', 'film.jellycut.json', 'notes.txt'].map(entry))
    expect(plan.projects.map((e) => e.key)).toEqual(['film.jellycut.json'])
    expect(plan.media.map((e) => e.key)).toEqual(['clip2.mp4', 'clip10.mp4', 'sub/pic.PNG'])
  })
  it('is empty for an empty folder', () => {
    expect(planFolderOpen([])).toEqual({ projects: [], media: [] })
  })
})
