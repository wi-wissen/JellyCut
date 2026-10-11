/**
 * Browser file access for project files. Uses the File System Access API where
 * it exists (Chromium) and falls back to an <input type=file> and a download.
 */
import { kvGet, kvSet } from './localStore'

export interface ProjectFileCaps {
  filePicker: boolean
  directoryPicker: boolean
}

export interface OpenedProjectFile {
  name: string
  text: string
  handle?: FsFileHandle
}

export interface SavedProjectFile {
  name: string
  handle?: FsFileHandle
}

// Minimal File System Access types; the DOM lib does not ship them everywhere.
export interface FsWritableStream {
  write(data: string): Promise<void>
  close(): Promise<void>
}

type PermissionResult = 'granted' | 'denied' | 'prompt'

export interface FsFileHandle {
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<FsWritableStream>
}

export interface FsDirectoryHandle {
  readonly name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionResult>
}

interface PickerType {
  description: string
  accept: Record<string, string[]>
}

interface FilePickerApi {
  showOpenFilePicker?: (options: { types: PickerType[]; multiple: boolean }) => Promise<FsFileHandle[]>
  showSaveFilePicker?: (options: { suggestedName: string; types: PickerType[] }) => Promise<FsFileHandle>
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FsDirectoryHandle>
}

const WORK_FOLDER_KEY = 'workFolder'
const PROJECT_TYPES: PickerType[] = [
  { description: 'Jelly Cut project', accept: { 'application/json': ['.jellycut', '.json'] } }
]
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function pickerApi(): FilePickerApi | null {
  return typeof window === 'undefined' ? null : (window as unknown as FilePickerApi)
}

function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError'
}

export function detectCaps(): ProjectFileCaps {
  const api = pickerApi()
  return {
    filePicker: api !== null && typeof api.showOpenFilePicker === 'function' && typeof api.showSaveFilePicker === 'function',
    directoryPicker: api !== null && typeof api.showDirectoryPicker === 'function'
  }
}

/** A file name that is safe on all common systems, always ending in .jellycut. */
export function projectFileName(name: string): string {
  const base = name
    .replace(CONTROL_CHARS, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60)
  return `${base || 'project'}.jellycut`
}

export async function openProjectFile(): Promise<OpenedProjectFile | null> {
  const api = pickerApi()
  if (detectCaps().filePicker && api?.showOpenFilePicker) {
    let handles: FsFileHandle[]
    try {
      handles = await api.showOpenFilePicker({ types: PROJECT_TYPES, multiple: false })
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
    const handle = handles[0]
    if (!handle) return null
    const file = await handle.getFile()
    return { name: file.name, text: await file.text(), handle }
  }
  return pickWithInput()
}

function pickWithInput(): Promise<OpenedProjectFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.jellycut,.json,application/json'
    input.style.display = 'none'
    const finish = (): void => input.remove()

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      finish()
      if (!file) {
        resolve(null)
        return
      }
      file.text().then((text) => resolve({ name: file.name, text }), reject)
    })
    // Supported by current Chrome, Firefox and Safari; without it a cancelled picker just stays pending.
    input.addEventListener('cancel', () => {
      finish()
      resolve(null)
    })
    document.body.append(input)
    input.click()
  })
}

async function writeFile(handle: FsFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable()
  // Chromium only replaces the file on close, so a failed write leaves the old content intact.
  await writable.write(text)
  await writable.close()
}

/** Writes to the given handle, or asks for a location, or downloads. Null if the user cancels the picker. */
export async function saveProjectFile(
  text: string,
  suggestedName: string,
  handle?: FsFileHandle
): Promise<SavedProjectFile | null> {
  if (handle) {
    await writeFile(handle, text)
    return { name: handle.name, handle }
  }
  const api = pickerApi()
  if (detectCaps().filePicker && api?.showSaveFilePicker) {
    let target: FsFileHandle
    try {
      target = await api.showSaveFilePicker({ suggestedName, types: PROJECT_TYPES })
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
    await writeFile(target, text)
    return { name: target.name, handle: target }
  }
  downloadProjectFile(text, suggestedName)
  return { name: suggestedName }
}

export function downloadProjectFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function chooseWorkFolder(): Promise<FsDirectoryHandle | null> {
  const api = pickerApi()
  if (!api?.showDirectoryPicker) return null
  let dir: FsDirectoryHandle
  try {
    dir = await api.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
  await kvSet(WORK_FOLDER_KEY, dir)
  return dir
}

/** The remembered work folder, or null if it is gone or its permission is no longer granted. */
export async function loadWorkFolder(): Promise<FsDirectoryHandle | null> {
  const dir = await kvGet<FsDirectoryHandle>(WORK_FOLDER_KEY)
  if (!dir || typeof dir.getFileHandle !== 'function' || !dir.queryPermission) return null
  try {
    return (await dir.queryPermission({ mode: 'readwrite' })) === 'granted' ? dir : null
  } catch {
    return null
  }
}

/** Writes the file into the work folder, replacing an existing one with the same name. Returns the file name. */
export async function saveInWorkFolder(dir: FsDirectoryHandle, text: string, fileName: string): Promise<string> {
  const handle = await dir.getFileHandle(fileName, { create: true })
  await writeFile(handle, text)
  return handle.name
}
