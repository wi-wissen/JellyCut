/**
 * Work folder access for Chromium-based browsers (File System Access API). Everything here is
 * feature-detected: without the API the functions report "not available" instead of failing.
 * Lookups never create files or folders, and never read file contents.
 */
import { safePathSegments } from '../core/io/paths'
import { kvDelete, kvGet } from './localStore'
import type { FsDirectoryHandle, FsFileHandle } from './projectFiles'

// Same key as projectFiles.ts, which stores the handle when the folder is chosen.
const WORK_FOLDER_KEY = 'workFolder'
const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_FILES = 5000

export type FolderPermission = 'granted' | 'prompt' | 'denied'

export interface WorkFolderHandle extends FsDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WorkFolderHandle>
  values?(): AsyncIterable<WorkEntry>
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<FolderPermission>
  /** Segments of the path from the folder down to the child, or null when it is not inside. */
  resolve?(child: WorkEntry): Promise<string[] | null>
}

export type WorkEntry = (WorkFolderHandle | FsFileHandle) & { readonly kind: 'file' | 'directory' }

export interface ScannedFile {
  name: string
  size: number
  /** Path relative to the work folder, with forward slashes. */
  key: string
  handle: FsFileHandle
}

interface OpenFilePickerApi {
  showOpenFilePicker?: (options: { multiple: boolean }) => Promise<FsFileHandle[]>
}

let active: WorkFolderHandle | null = null

/** The work folder that may be used right now (its permission was granted in this session). */
export function activeWorkFolder(): WorkFolderHandle | null {
  return active
}

export function setActiveWorkFolder(dir: FsDirectoryHandle | null): void {
  active = dir as WorkFolderHandle | null
}

/** The folder remembered in storage, whatever its permission state. Null if none or not a folder handle. */
export async function loadFolder(): Promise<WorkFolderHandle | null> {
  const dir = await kvGet<WorkFolderHandle>(WORK_FOLDER_KEY)
  return dir && typeof dir.getFileHandle === 'function' ? dir : null
}

export async function forgetFolder(): Promise<void> {
  active = null
  await kvDelete(WORK_FOLDER_KEY)
}

export async function folderPermission(dir: WorkFolderHandle): Promise<FolderPermission> {
  if (!dir.queryPermission) return 'prompt'
  try {
    return await dir.queryPermission({ mode: 'readwrite' })
  } catch {
    return 'denied'
  }
}

/**
 * Asks for read and write access when it is not granted yet. Browsers only show the prompt
 * for a user gesture, so call this straight from a click handler.
 */
export async function ensurePermission(dir: WorkFolderHandle): Promise<boolean> {
  if ((await folderPermission(dir)) === 'granted') return true
  if (!dir.requestPermission) return false
  try {
    return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/**
 * Walks the relative path from the folder to a file. Refuses anything that is not a plain
 * relative path (no "..", no absolute paths, no drive letters); never creates entries.
 */
export async function resolveRelPath(root: WorkFolderHandle, relPath: string): Promise<FsFileHandle | null> {
  const segments = safePathSegments(relPath)
  if (!segments) return null
  let dir: WorkFolderHandle = root
  try {
    for (const segment of segments.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(segment)
    }
    return await dir.getFileHandle(segments[segments.length - 1] ?? '')
  } catch {
    return null
  }
}

export async function findInWorkFolder(dir: WorkFolderHandle, relPath: string): Promise<File | null> {
  const handle = await resolveRelPath(dir, relPath)
  if (!handle) return null
  try {
    return await handle.getFile()
  } catch {
    return null
  }
}

/**
 * Lists the files below the folder, up to maxDepth folder levels and maxFiles entries. Hidden
 * folders are skipped. Only file metadata (name and size) is read, never the contents.
 */
export async function scanFolder(
  dir: WorkFolderHandle,
  maxDepth = DEFAULT_MAX_DEPTH,
  maxFiles = DEFAULT_MAX_FILES,
  options: { onProgress?: (found: number) => void } = {}
): Promise<ScannedFile[]> {
  const found: ScannedFile[] = []

  async function walk(folder: WorkFolderHandle, prefix: string[], depth: number): Promise<void> {
    if (!folder.values) return
    for await (const entry of folder.values()) {
      if (found.length >= maxFiles) return
      if (entry.name.startsWith('.')) continue
      if (entry.kind === 'directory') {
        if (depth < maxDepth) await walk(entry as WorkFolderHandle, [...prefix, entry.name], depth + 1)
        continue
      }
      if (entry.kind !== 'file') continue
      const handle = entry as FsFileHandle
      try {
        const file = await handle.getFile()
        found.push({ name: entry.name, size: file.size, key: [...prefix, entry.name].join('/'), handle })
        options.onProgress?.(found.length)
      } catch {
        // A file that vanished or cannot be read is simply not a candidate.
      }
    }
  }

  await walk(dir, [], 0)
  return found
}

/**
 * Lets the user pick files with the native picker. Files inside the active work folder get their
 * path relative to it, so a later relink or move of the folder keeps working. Null if cancelled
 * or unsupported.
 */
export async function pickFilesFromWorkFolder(): Promise<{ file: File; relPath: string | null }[] | null> {
  const api = typeof window === 'undefined' ? null : (window as unknown as OpenFilePickerApi)
  if (!api?.showOpenFilePicker) return null
  let handles: FsFileHandle[]
  try {
    handles = await api.showOpenFilePicker({ multiple: true })
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === 'AbortError') return null
    throw e
  }
  const root = activeWorkFolder()
  const result: { file: File; relPath: string | null }[] = []
  for (const handle of handles) {
    const file = await handle.getFile()
    let relPath: string | null = null
    if (root?.resolve) {
      try {
        const segments = await root.resolve(handle as WorkEntry)
        if (segments && segments.length > 0) relPath = segments.join('/')
      } catch {
        relPath = null
      }
    }
    result.push({ file, relPath })
  }
  return result
}
