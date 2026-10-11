import type { FitMode, FormatRatio, Project, ProjectFormat } from './types'

/** Every ratio is 1080 pixels on its short side. */
const SHORT_SIDE = 1080

const RATIO_SIZE: Record<FormatRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }
}

const RATIOS = Object.keys(RATIO_SIZE) as FormatRatio[]
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export type FormatBackground = ProjectFormat['background']

export function isFormatRatio(value: unknown): value is FormatRatio {
  return typeof value === 'string' && (RATIOS as string[]).includes(value)
}

export function formatForRatio(ratio: FormatRatio): { ratio: FormatRatio; width: number; height: number } {
  const size = RATIO_SIZE[ratio]
  return { ratio, width: size.width, height: size.height }
}

/** Short side is always SHORT_SIDE; fps and background are kept. Unknown ratios leave the project unchanged. */
export function setRatio(project: Project, ratio: FormatRatio): Project {
  if (!isFormatRatio(ratio)) return project
  const next = formatForRatio(ratio)
  const { format } = project
  if (format.ratio === next.ratio && format.width === next.width && format.height === next.height) return project
  return { ...project, format: { ...format, ...next } }
}

/** Blur or a #RRGGBB colour (stored in lower case). Invalid backgrounds leave the project unchanged. */
export function setBackground(project: Project, background: FormatBackground): Project {
  let next: FormatBackground
  if (background.type === 'blur') {
    next = { type: 'blur' }
  } else if (background.type === 'color' && HEX_COLOR.test(background.color)) {
    next = { type: 'color', color: background.color.toLowerCase() }
  } else {
    return project
  }
  const current = project.format.background
  if (current.type === next.type && (current.type === 'blur' || current.color === (next as { color: string }).color)) {
    return project
  }
  return { ...project, format: { ...project.format, background: next } }
}

/** Sets Fit or Fill on every clip. Returns the same project when every clip already has that mode. */
export function setAllFit(project: Project, fit: FitMode): Project {
  if (fit !== 'fit' && fit !== 'fill') return project
  if (project.clips.every((c) => c.transform.fit === fit)) return project
  return {
    ...project,
    clips: project.clips.map((c) => (c.transform.fit === fit ? c : { ...c, transform: { ...c.transform, fit } }))
  }
}
