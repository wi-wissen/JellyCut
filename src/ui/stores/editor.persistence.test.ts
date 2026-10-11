import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createProject, serializeProject } from '../../core/project/schema'
import { AUTOSAVE_KEY, kvGet, kvSet } from '../../platform/localStore'
import { openProjectFile, loadWorkFolder, saveProjectFile, downloadProjectFile } from '../../platform/projectFiles'
import { useEditorStore } from './editor'

vi.mock('../../platform/localStore', () => ({
  AUTOSAVE_KEY: 'autosave',
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => true),
  kvDelete: vi.fn(async () => true)
}))

vi.mock('../../platform/projectFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform/projectFiles')>()
  return {
    ...actual,
    detectCaps: vi.fn(() => ({ filePicker: false, directoryPicker: false })),
    openProjectFile: vi.fn(async () => null),
    saveProjectFile: vi.fn(async () => null),
    downloadProjectFile: vi.fn(),
    chooseWorkFolder: vi.fn(async () => null),
    loadWorkFolder: vi.fn(async () => null),
    saveInWorkFolder: vi.fn(async () => 'x.jellycut')
  }
})

const DEMO_NAME = 'Summer trip'

function makeStore() {
  return useEditorStore()
}

describe('editor store: history', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('commits, undoes and redoes project changes', () => {
    const store = makeStore()
    store.commitProject({ ...store.project, name: 'First' })
    expect(store.project.name).toBe('First')
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.project.name).toBe(DEMO_NAME)
    expect(store.canRedo).toBe(true)
    expect(store.canUndo).toBe(false)

    store.redo()
    expect(store.project.name).toBe('First')
  })

  it('ignores a commit that does not change the project', () => {
    const store = makeStore()
    store.commitProject(store.project)
    expect(store.canUndo).toBe(false)
    expect(store.dirtySinceFileSave).toBe(false)
  })

  it('merges rename keystrokes into one undo step', () => {
    const store = makeStore()
    store.renameProject('Tr')
    store.renameProject('Tri')
    store.renameProject('Trip')
    expect(store.project.name).toBe('Trip')

    store.undo()
    expect(store.project.name).toBe(DEMO_NAME)
    expect(store.canUndo).toBe(false)
  })

  it('starts a new undo step after the rename field loses focus', () => {
    const store = makeStore()
    store.renameProject('Trip')
    store.endRenameStep()
    store.renameProject('Trip 2')
    store.undo()
    expect(store.project.name).toBe('Trip')
  })

  it('caps the project name at 60 characters', () => {
    const store = makeStore()
    store.renameProject('x'.repeat(80))
    expect(store.project.name).toHaveLength(60)
  })

  it('newProject starts a fresh history and resets the file binding', () => {
    const store = makeStore()
    store.renameProject('Changed')
    store.newProject('Neues Projekt')
    expect(store.project.name).toBe('Neues Projekt')
    expect(store.canUndo).toBe(false)
    expect(store.fileName).toBeNull()
    expect(store.fileHandle).toBeNull()
  })
})

describe('editor store: open and save', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('openProject with valid JSON replaces the project', async () => {
    vi.mocked(openProjectFile).mockResolvedValueOnce({
      name: 'trip.jellycut',
      text: serializeProject(createProject('Opened trip'))
    })
    const store = makeStore()
    await store.openProject()
    expect(store.project.name).toBe('Opened trip')
    expect(store.fileName).toBe('trip.jellycut')
    expect(store.loadError).toBeNull()
    expect(store.canUndo).toBe(false)
  })

  it('openProject with invalid JSON sets loadError and keeps the project', async () => {
    vi.mocked(openProjectFile).mockResolvedValueOnce({ name: 'bad.jellycut', text: '{ not json' })
    const store = makeStore()
    await store.openProject()
    expect(store.loadError).toMatch(/invalid JSON/)
    expect(store.project.name).toBe(DEMO_NAME)
  })

  it('openProject with a valid JSON of the wrong shape keeps the project', async () => {
    vi.mocked(openProjectFile).mockResolvedValueOnce({ name: 'x.jellycut', text: '{"version":1}' })
    const store = makeStore()
    await store.openProject()
    expect(store.loadError).toBeTruthy()
    expect(store.project.name).toBe(DEMO_NAME)
  })

  it('openProject keeps the project when the picker fails', async () => {
    vi.mocked(openProjectFile).mockRejectedValueOnce(new Error('disk gone'))
    const store = makeStore()
    await store.openProject()
    expect(store.loadError).toBe('disk gone')
    expect(store.project.name).toBe(DEMO_NAME)
  })

  it('saveProject writes the file and clears the dirty flag, unless edits raced the save', async () => {
    vi.mocked(saveProjectFile).mockResolvedValueOnce({ name: 'Summer trip.jellycut' })
    const store = makeStore()
    store.renameProject('Saved')
    expect(store.dirtySinceFileSave).toBe(true)
    await store.saveProject()
    expect(saveProjectFile).toHaveBeenCalledWith(expect.stringContaining('"name": "Saved"'), 'Saved.jellycut')
    expect(store.fileName).toBe('Summer trip.jellycut')
    expect(store.dirtySinceFileSave).toBe(false)
  })

  it('downloadProject always downloads the serialized project', () => {
    const store = makeStore()
    store.renameProject('Download me')
    store.downloadProject()
    expect(downloadProjectFile).toHaveBeenCalledWith(expect.stringContaining('"name": "Download me"'), 'Download me.jellycut')
    expect(store.dirtySinceFileSave).toBe(false)
  })
})

describe('editor store: autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restoreAutosave loads a valid autosaved project', async () => {
    vi.mocked(kvGet).mockResolvedValueOnce({ text: serializeProject(createProject('Restored')), savedAt: 1 })
    const store = makeStore()
    await store.restoreAutosave()
    expect(kvGet).toHaveBeenCalledWith(AUTOSAVE_KEY)
    expect(store.project.name).toBe('Restored')
    expect(store.canUndo).toBe(false)
  })

  it('restoreAutosave ignores a corrupt autosave and keeps the demo project', async () => {
    vi.mocked(kvGet).mockResolvedValueOnce({ text: '{ broken', savedAt: 1 })
    const store = makeStore()
    await store.restoreAutosave()
    expect(store.project.name).toBe(DEMO_NAME)
  })

  it('restoreAutosave does not overwrite edits made while storage was loading', async () => {
    let finish: (v: unknown) => void = () => undefined
    vi.mocked(kvGet).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const store = makeStore()
    const restoring = store.restoreAutosave()
    store.renameProject('Typed early')
    finish({ text: serializeProject(createProject('Old autosave')), savedAt: 1 })
    await restoring
    expect(store.project.name).toBe('Typed early')
  })

  it('autosaves after a commit, once the debounce has passed', async () => {
    const store = makeStore()
    store.renameProject('Auto')
    expect(kvSet).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(800)
    expect(kvSet).toHaveBeenCalledTimes(1)
    const [key, record] = vi.mocked(kvSet).mock.calls[0] as [string, { text: string; savedAt: number }]
    expect(key).toBe(AUTOSAVE_KEY)
    expect(JSON.parse(record.text).name).toBe('Auto')
    expect(store.saveStatus).toBe('saved')
  })

  it('does not autosave a no-op commit', async () => {
    const store = makeStore()
    store.commitProject(store.project)
    await vi.advanceTimersByTimeAsync(2000)
    expect(kvSet).not.toHaveBeenCalled()
    expect(store.saveStatus).toBe('idle')
  })

  it('reports an error status when storage refuses the write', async () => {
    vi.mocked(kvSet).mockResolvedValueOnce(false)
    const store = makeStore()
    store.renameProject('Fails')
    await vi.advanceTimersByTimeAsync(800)
    expect(store.saveStatus).toBe('error')
  })

  it('flushAutosave writes immediately', async () => {
    const store = makeStore()
    store.renameProject('Now')
    await store.flushAutosave()
    expect(kvSet).toHaveBeenCalledTimes(1)
  })

  it('restores the remembered work folder name', async () => {
    vi.mocked(loadWorkFolder).mockResolvedValueOnce({ name: 'Klasse 7b', getFileHandle: async () => ({ name: 'x', getFile: async () => new File([], 'x'), createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) }) })
    const store = makeStore()
    await store.restoreAutosave()
    expect(store.workFolderName).toBe('Klasse 7b')
  })
})
