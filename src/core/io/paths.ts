/**
 * Relative media paths stored in a project file. The project JSON is untrusted,
 * so anything that could leave the project folder is rejected (null).
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const URL_OR_DRIVE_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const SEPARATORS = /[\\/]+/

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function safePathSegments(relPath: string): string[] | null {
  if (typeof relPath !== 'string' || relPath.trim() === '') return null
  if (CONTROL_CHARS.test(relPath)) return null
  if (URL_OR_DRIVE_SCHEME.test(relPath)) return null
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return null

  const segments: string[] = []
  for (const raw of relPath.split(SEPARATORS)) {
    if (raw === '' || raw === '.') continue
    if (raw === '..') return null
    // Traversal hidden behind percent-encoding, e.g. "%2e%2e" or "..%2f".
    const decoded = decodeSegment(raw)
    if (decoded !== raw && (decoded === '.' || decoded === '..' || SEPARATORS.test(decoded))) return null
    segments.push(raw)
  }
  return segments.length > 0 ? segments : null
}

export function joinRelPath(segments: string[]): string {
  return segments.join('/')
}

const MEDIA_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'ogv', 'avi',
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'
])

/** True for file names the editor can try to import (by extension only). */
export function isMediaFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && MEDIA_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}
