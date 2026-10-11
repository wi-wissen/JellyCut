import { describe, expect, it } from 'vitest'
import { findInWorkFolder, resolveRelPath, scanFolder, type WorkEntry, type WorkFolderHandle } from './workFolder'

interface FakeFile {
  kind: 'file'
  name: string
  size: number
  getFile(): Promise<File>
}

interface FakeDir {
  kind: 'directory'
  name: string
  getDirectoryHandle(name: string): Promise<FakeDir>
  getFileHandle(name: string): Promise<FakeFile>
  values(): AsyncIterable<WorkEntry>
}

/** An in-memory folder. `calls` records every lookup, so tests can prove what was (not) asked for. */
function fakeFolder(tree: Record<string, string | Record<string, unknown>>, calls: string[] = []): WorkFolderHandle {
  function build(name: string, node: Record<string, unknown>): FakeDir {
    const children = new Map<string, FakeDir | FakeFile>()
    for (const [childName, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        children.set(childName, {
          kind: 'file',
          name: childName,
          size: value.length,
          getFile: async () => new File([value], childName)
        })
      } else {
        children.set(childName, build(childName, value as Record<string, unknown>))
      }
    }
    return {
      kind: 'directory',
      name,
      async getDirectoryHandle(n: string) {
        calls.push(`dir:${n}`)
        const child = children.get(n)
        if (!child || child.kind !== 'directory') throw new DOMException(n, 'NotFoundError')
        return child
      },
      async getFileHandle(n: string) {
        calls.push(`file:${n}`)
        const child = children.get(n)
        if (!child || child.kind !== 'file') throw new DOMException(n, 'NotFoundError')
        return child
      },
      async *values() {
        for (const child of children.values()) yield child as unknown as WorkEntry
      }
    }
  }
  return build('Arbeitsordner', tree) as unknown as WorkFolderHandle
}

describe('resolveRelPath', () => {
  it('walks a relative path to the file', async () => {
    const root = fakeFolder({ media: { 'a.mp4': 'xyz' } })
    const handle = await resolveRelPath(root, 'media/a.mp4')
    expect(handle?.name).toBe('a.mp4')
  })

  it('refuses traversal and absolute paths without asking the folder for anything', async () => {
    const calls: string[] = []
    const root = fakeFolder({ media: { 'a.mp4': 'xyz' } }, calls)
    for (const p of ['../../etc/passwd', 'media/../../x', '/etc/passwd', 'C:\\x.mp4', '..\\x']) {
      expect(await resolveRelPath(root, p)).toBeNull()
    }
    expect(calls).toEqual([])
  })

  it('returns null for missing entries and never creates them', async () => {
    const calls: string[] = []
    const root = fakeFolder({ media: {} }, calls)
    expect(await resolveRelPath(root, 'media/gone.mp4')).toBeNull()
    expect(await resolveRelPath(root, 'nope/x.mp4')).toBeNull()
    expect(calls.every((c) => !c.includes('create'))).toBe(true)
  })
})

describe('findInWorkFolder', () => {
  it('returns the File behind the path', async () => {
    const root = fakeFolder({ 'clip.webm': 'abcd' })
    const file = await findInWorkFolder(root, 'clip.webm')
    expect(file?.name).toBe('clip.webm')
    expect(file?.size).toBe(4)
  })
})

describe('scanFolder', () => {
  it('lists files with their path and size, skipping hidden folders', async () => {
    const root = fakeFolder({
      'top.mp4': 'aa',
      sub: { 'deep.mp4': 'bbb' },
      '.trash': { 'hidden.mp4': 'cccc' }
    })
    const found = await scanFolder(root)
    const byKey = Object.fromEntries(found.map((f) => [f.key, f.size]))
    expect(byKey).toEqual({ 'top.mp4': 2, 'sub/deep.mp4': 3 })
  })

  it('stops at the depth limit', async () => {
    const root = fakeFolder({ a: { b: { c: { 'far.mp4': 'x' } } }, 'near.mp4': 'y' })
    const found = await scanFolder(root, 1)
    expect(found.map((f) => f.key)).toEqual(['near.mp4'])
  })

  it('stops at the file limit', async () => {
    const root = fakeFolder({ 'a.mp4': '1', 'b.mp4': '2', 'c.mp4': '3' })
    const found = await scanFolder(root, 3, 2)
    expect(found).toHaveLength(2)
  })
})
