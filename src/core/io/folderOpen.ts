import { isMediaFileName } from './paths'

export interface FolderEntry {
  name: string
  /** Path relative to the folder, with forward slashes. */
  key: string
}

export interface FolderPlan {
  /** Project files directly in the folder, by name. */
  projects: FolderEntry[]
  /** Importable media anywhere below the folder, by path. */
  media: FolderEntry[]
}

/** Project files are written as <name>.jellycut.json; the opener also accepts .jellycut. */
export function isProjectFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.length > '.jellycut'.length && (lower.endsWith('.jellycut.json') || lower.endsWith('.jellycut'))
}

/** What "open folder" works with: project files at the top level (nested ones belong to other projects) and all media. */
export function planFolderOpen(entries: FolderEntry[]): FolderPlan {
  const byName = (a: FolderEntry, b: FolderEntry): number => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' })
  return {
    projects: entries.filter((e) => !e.key.includes('/') && isProjectFileName(e.name)).sort(byName),
    media: entries.filter((e) => isMediaFileName(e.name)).sort(byName)
  }
}
