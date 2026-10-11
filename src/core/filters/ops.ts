import type { Clip, ColorAdjust, Project } from '../project/types'
import type { Micros } from '../time'
import { clipEnd } from '../timeline/edit'
import { clampAdjustValue, clampAmount, isFilterId, isIdentity, resolveGrade, type FilterId, type Grade } from './filters'

export interface GradePatch {
  /** 'none' or null removes the filter. */
  filter?: string | null
  filterAmount?: number
  /** Only the given fields change. */
  adjust?: Partial<ColorAdjust>
}

const NEUTRAL: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0 }

function normalizeFilter(value: string | null): FilterId | null | undefined {
  if (value === null || value === 'none') return null
  return isFilterId(value) ? value : undefined
}

/** The grade a clip is drawn with; null when the clip has no visible grade. */
export function clipGrade(clip: Clip): Grade | null {
  const grade = resolveGrade(clip.filter, clip.filterAmount, clip.adjust)
  return isIdentity(grade) ? null : grade
}

function sameAdjust(a: ColorAdjust | undefined, b: ColorAdjust): boolean {
  const x = a ?? NEUTRAL
  return x.brightness === b.brightness && x.contrast === b.contrast && x.saturation === b.saturation
}

/**
 * Sets filter, intensity and adjustments of one clip. Returns the same project object when nothing
 * changes or the clip does not exist, so the history does not record empty steps.
 */
export function setClipGrade(project: Project, clipId: string, patch: GradePatch): Project {
  const index = project.clips.findIndex((c) => c.id === clipId)
  const clip = project.clips[index]
  if (!clip) return project

  let filter = clip.filter
  if (patch.filter !== undefined) {
    const normalized = normalizeFilter(patch.filter)
    if (normalized === undefined) return project
    filter = normalized
  }

  let next: Clip = { ...clip, filter }
  if (patch.filterAmount !== undefined) {
    next = { ...next, filterAmount: clampAmount(patch.filterAmount) }
  }
  if (patch.adjust !== undefined) {
    const base = clip.adjust ?? NEUTRAL
    const adjust: ColorAdjust = {
      brightness: patch.adjust.brightness === undefined ? base.brightness : clampAdjustValue(patch.adjust.brightness),
      contrast: patch.adjust.contrast === undefined ? base.contrast : clampAdjustValue(patch.adjust.contrast),
      saturation: patch.adjust.saturation === undefined ? base.saturation : clampAdjustValue(patch.adjust.saturation)
    }
    next = { ...next, adjust }
  }

  const unchanged =
    next.filter === clip.filter &&
    (next.filterAmount ?? 1) === (clip.filterAmount ?? 1) &&
    sameAdjust(clip.adjust, next.adjust ?? NEUTRAL)
  if (unchanged) return project

  const clips = project.clips.slice()
  clips[index] = next
  return { ...project, clips }
}

/** Copies the filter, intensity and adjustments of one clip to every video clip of the project. */
export function applyGradeToAll(project: Project, sourceClipId: string): Project {
  const source = project.clips.find((c) => c.id === sourceClipId)
  if (!source) return project
  const grade = { filter: source.filter, filterAmount: source.filterAmount ?? 1, adjust: { ...(source.adjust ?? NEUTRAL) } }
  const clips = project.clips.map((clip) => ({
    ...clip,
    filter: grade.filter,
    filterAmount: grade.filterAmount,
    adjust: { ...grade.adjust }
  }))
  return { ...project, clips }
}

/**
 * The clip the filter panel edits: the selected clip, or the clip under the playhead when no clip
 * is selected. Null when neither exists.
 */
export function gradeTargetClipId(
  project: Project,
  selection: { kind: string; id: string } | null,
  playhead: Micros
): string | null {
  if (selection?.kind === 'clip' && project.clips.some((c) => c.id === selection.id)) return selection.id
  const under = project.clips.find((c) => c.start <= playhead && playhead < clipEnd(c))
  return under?.id ?? null
}

