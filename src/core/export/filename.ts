const MAX_FILE_NAME = 80
const FALLBACK_BASE = 'jelly-cut'
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const FORBIDDEN_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/** Trims spaces and dots at both ends (Windows does not accept trailing dots or spaces). */
function trimEdges(text: string): string {
  return text.replace(/^[\s.]+|[\s.]+$/g, '')
}

/**
 * A file name for the exported video, derived from the project name.
 * Characters that are not allowed in file names on common systems become '-'.
 */
export function exportFileName(projectName: string, ext: string): string {
  const extension = ext.replace(/^\.+/, '')
  // Whitespace (including tabs and line breaks) is collapsed before the control characters are replaced.
  let base = projectName.replace(/\s+/g, ' ').replace(FORBIDDEN_CHARS, '-')
  base = trimEdges(base)

  const room = MAX_FILE_NAME - extension.length - 1
  base = trimEdges(Array.from(base).slice(0, room).join(''))

  if (base === '') base = FALLBACK_BASE
  if (WINDOWS_RESERVED.test(base)) base = `${base}-`

  return extension === '' ? base : `${base}.${extension}`
}
