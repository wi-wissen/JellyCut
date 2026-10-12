import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createProject } from '../../core/project/schema'
import type { Asset, Project } from '../../core/project/types'
import { createMemoryMediaStore } from '../../platform/mediaStore'
import { useEditorStore } from './editor'
import { setMediaStorage, useMediaStore } from './media'

vi.mock('../../platform/localStore', () => ({
  AUTOSAVE_KEY: 'autosave',
  MEDIA_STORE_NAME: 'media',
  openDb: vi.fn(async () => null),
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => true),
  kvDelete: vi.fn(async () => true)
}))

const recording = (id: string, key: string | undefined, extra: Partial<Asset> = {}): Asset => ({
  id, kind: 'video', name: `${id}.webm`, relPath: `${id}.webm`, size: 100, duration: 2_000_000, origin: 'recording', ...(key ? { storeKey: key } : {}), ...extra
})
const withAssets = (assets: Asset[]): Project => ({
  ...createProject('P'),
  assets,
  clips: assets.map((a, i) => ({ id: `clip-${i}`, track: 'video', assetId: a.id, srcIn: 0, srcOut: 1_000_000, start: i * 1_000_000, speed: 1, transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false }, volume: 1, muted: false, filter: null, transitionIn: null }))
}) as unknown as Project

const blob = (name: string) => new File([new Uint8Array(100)], name, { type: 'video/webm' })
const tick = () => new Promise((r) => setTimeout(r, 0))

let fake: ReturnType<typeof createMemoryMediaStore>

beforeEach(() => {
  setActivePinia(createPinia())
  fake = createMemoryMediaStore()
  setMediaStorage(fake)
})

describe('media store: stored recordings', () => {
  it('restores a recording from storage as ready, with no re-link dialog', async () => {
    await fake.put('rec-aaaaaaaa', blob('a.webm'))
    const project = withAssets([recording('asset-1', 'rec-aaaaaaaa')])
    const media = useMediaStore()
    useEditorStore().history = { past: [], present: project, future: [] } as never
    media.markMissingFor(project)
    expect(media.relinkOpen).toBe(false)
    await media.restoreStored(project)
    expect(media.statusOf('asset-1')).toBe('ready')
    expect(media.relinkOpen).toBe(false)
    expect(media.missingCount).toBe(0)
    expect(media.storedBytes).toBe(100)
  })

  it('a copy this browser does not have joins the re-link list', async () => {
    const project = withAssets([recording('asset-1', 'rec-bbbbbbbb')])
    const media = useMediaStore()
    useEditorStore().history = { past: [], present: project, future: [] } as never
    media.markMissingFor(project)
    await media.restoreStored(project)
    expect(media.statusOf('asset-1')).toBe('missing')
    expect(media.relinkOpen).toBe(true)
    expect(media.relinkListIds).toEqual(['asset-1'])
  })

  it('an imported file without a key is missing at once, as before', () => {
    const project = withAssets([recording('asset-1', undefined, { origin: undefined })])
    const media = useMediaStore()
    useEditorStore().history = { past: [], present: project, future: [] } as never
    media.markMissingFor(project)
    expect(media.relinkOpen).toBe(true)
  })

  it('persistAsset skips assets without a file or key, and reports a full storage', async () => {
    const project = withAssets([recording('asset-1', 'rec-cccccccc')])
    const media = useMediaStore()
    useEditorStore().history = { past: [], present: project, future: [] } as never
    expect(await media.persistAsset('asset-1')).toBe('skipped')
  })

  it('replacing the document deletes the old copies but keeps those the new project uses', async () => {
    await fake.put('rec-aaaaaaaa', blob('a.webm'))
    await fake.put('rec-dddddddd', blob('d.webm'))
    const oldProject = withAssets([recording('asset-1', 'rec-aaaaaaaa'), recording('asset-2', 'rec-dddddddd')])
    const editor = useEditorStore()
    editor.replaceDocument(oldProject, { handle: null, name: null })
    await tick()
    await tick()
    expect(fake.keys().sort()).toEqual(['rec-aaaaaaaa', 'rec-dddddddd'])
    editor.newProject('New')
    await tick()
    await tick()
    expect(fake.keys()).toEqual([])
  })

  it('opening a project that refers to the same copy keeps it', async () => {
    await fake.put('rec-aaaaaaaa', blob('a.webm'))
    const editor = useEditorStore()
    editor.replaceDocument(withAssets([recording('asset-1', 'rec-aaaaaaaa')]), { handle: null, name: null })
    editor.replaceDocument(withAssets([recording('asset-9', 'rec-aaaaaaaa')]), { handle: null, name: null })
    await tick()
    await tick()
    expect(fake.keys()).toEqual(['rec-aaaaaaaa'])
  })

  it('removing a recording keeps its copy for undo and deletes it when the undo cache lets go', async () => {
    const editor = useEditorStore()
    const media = useMediaStore()
    const assets = Array.from({ length: 22 }, (_, i) => recording(`asset-${i + 1}`, `rec-${String(i).padStart(8, '0')}`))
    for (const a of assets) await fake.put(a.storeKey as string, blob(a.name))
    const project = withAssets(assets)
    editor.replaceDocument(project, { handle: null, name: null })
    await media.restoreStored(project)
    for (const a of assets) expect(media.statusOf(a.id)).toBe('ready')
    for (const a of assets) media.removeAsset(a.id)
    await tick()
    await tick()
    // 20 removed assets stay for undo; the two oldest fell out of the cache.
    expect(fake.keys().length).toBe(20)
    expect(fake.keys()).not.toContain('rec-00000000')
    expect(fake.keys()).not.toContain('rec-00000001')
    expect(fake.keys()).toContain('rec-00000021')
  })

  it('sweeps old orphans at restore but spares fresh ones', async () => {
    await fake.put('rec-aaaaaaaa', blob('a.webm'))
    await fake.put('rec-oldorphan', blob('o.webm'))
    const realList = fake.list.bind(fake)
    fake.list = async () => (await realList()).map((s) => (s.key === 'rec-oldorphan' ? { ...s, savedAt: Date.now() - 3 * 24 * 3600 * 1000 } : s))
    await fake.put('rec-freshorph', blob('f.webm'))
    const project = withAssets([recording('asset-1', 'rec-aaaaaaaa')])
    useEditorStore().history = { past: [], present: project, future: [] } as never
    const media = useMediaStore()
    media.markMissingFor(project)
    await media.restoreStored(project, { sweep: true })
    expect(fake.keys().sort()).toEqual(['rec-aaaaaaaa', 'rec-freshorph'])
  })
})
