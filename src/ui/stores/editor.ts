import { defineStore } from 'pinia'
import { createProject, parseProjectJson, serializeProject } from '../../core/project/schema'
import type { Asset, Clip, FitMode, FormatRatio, MusicItem, Project, TextItem } from '../../core/project/types'
import {
  setAllFit,
  setBackground as setFormatBackground,
  setRatio as setFormatRatio,
  type FormatBackground
} from '../../core/project/format'
import type { TransitionType } from '../../core/render/types'
import { formatTimecode, frameIndexAt, frameStart, secondsToMicros, type Micros } from '../../core/time'
import { nextId } from '../../core/timeline/ids'
import { updateMusic, type MusicPatch } from '../../core/timeline/musicOps'
import { addText, updateText, type TextPresetId, type TextPatch } from '../../core/timeline/textOps'
import { DEFAULT_TRANSITION, setTransition, transitionTargetClipId } from '../../core/timeline/transitionOps'
import {
  deleteItem,
  duplicateItem,
  moveText as moveTextInTime,
  nextSpeed,
  projectIds,
  type ClipPatch,
  reorderVideoClip,
  setClipProps,
  splitAt,
  trimTextEnd,
  trimTextStart,
  trimVideoEnd,
  trimVideoStart,
  type ItemKind,
  type ItemRef
} from '../../core/timeline/ops'
import {
  breakCoalescing,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commit,
  createHistory,
  redo as redoHistory,
  undo as undoHistory,
  type HistoryState
} from '../../core/history/history'
import { createAutosaver, type Autosaver, type AutosaveStatus } from '../../core/io/autosave'
import { AUTOSAVE_KEY, kvGet, kvSet, type AutosaveRecord } from '../../platform/localStore'
import {
  chooseWorkFolder,
  detectCaps,
  downloadProjectFile,
  loadWorkFolder,
  openProjectFile,
  projectFileName,
  saveInWorkFolder,
  saveProjectFile,
  type FsFileHandle,
  type OpenedProjectFile,
  type ProjectFileCaps,
  type SavedProjectFile
} from '../../platform/projectFiles'
import { useMediaStore } from './media'
import { activeWorkFolder, setActiveWorkFolder } from '../../platform/workFolder'

export type TabId = 'media' | 'audio' | 'record' | 'text' | 'sticker' | 'draw' | 'captions' | 'filter' | 'transitions'
export type GroupId = 'material' | 'design' | 'look'
export type ThemeMode = 'light' | 'dark' | 'system'

export interface TimelineSpan {
  id: string
  label: string
  leftPct: number
  widthPct: number
  /** Index into the video track palette (--jc-track-video-N). */
  tone?: 1 | 2 | 3
}

export interface RulerTick {
  label: string
  leftPct: number
}

export interface Subtitle {
  lead: string
  accent: string
}

export interface EditorState {
  history: HistoryState<Project>
  activeGroup: GroupId
  activeTab: TabId
  playheadMicros: Micros
  theme: ThemeMode
  prefersDark: boolean
  /** Set when the project was opened from or saved to a file that can be written again. */
  fileHandle: FsFileHandle | null
  fileName: string | null
  workFolderName: string | null
  saveStatus: AutosaveStatus
  dirtySinceFileSave: boolean
  loadError: string | null
  caps: ProjectFileCaps
  /** The timeline item the user selected, if it still exists. */
  selection: ItemRef | null
  /** Read by the transport code; the store does not play anything itself. */
  isPlaying: boolean
}

const RULER_STEP = secondsToMicros(5)
const AUTOSAVE_DELAY_MS = 800
const MAX_PROJECT_NAME = 60
const ID_PREFIX: Record<ItemKind, string> = { clip: 'clip-', text: 'text-', music: 'music-' }

/**
 * Drag gestures edit relative to the project at pointer-down. Kept outside the reactive
 * state: it is only needed between begin and end of one gesture.
 */
let gestureBase: Project | null = null

function freshId(project: Project, prefix: string): string {
  return nextId(projectIds(project), prefix)
}

/** Angle in [0, 360). */
function normalizeAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** Timeline length of a clip after speed is applied. */
function clipLength(clip: Clip): Micros {
  return Math.round((clip.srcOut - clip.srcIn) / clip.speed)
}

export function projectDuration(project: Project): Micros {
  const ends = [
    ...project.clips.map((c) => c.start + clipLength(c)),
    ...project.texts.map((t) => t.start + t.duration),
    ...project.music.map((m) => m.start + (m.srcOut - m.srcIn))
  ]
  return Math.max(0, ...ends)
}

function toPct(t: Micros, total: Micros): number {
  return total > 0 ? (t / total) * 100 : 0
}

function assetName(project: Project, assetId: string): string {
  return project.assets.find((a) => a.id === assetId)?.name ?? ''
}

function videoAsset(id: string, name: string, seconds: number, size: number): Asset {
  return {
    id,
    kind: 'video',
    name,
    relPath: `media/${name.toLowerCase()}`,
    size,
    duration: secondsToMicros(seconds),
    width: 1920,
    height: 1080,
    fps: 30
  }
}

function videoClip(id: string, assetId: string, startSec: number, srcInSec: number, srcOutSec: number): Clip {
  return {
    id,
    track: 'video',
    assetId,
    srcIn: secondsToMicros(srcInSec),
    srcOut: secondsToMicros(srcOutSec),
    start: secondsToMicros(startSec),
    speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1,
    muted: false,
    filter: null,
    transitionIn: null
  }
}

/** Three clips (30 s in total) with one text item and one music bed. */
export function buildDemoProject(): Project {
  const project = createProject('Summer trip')
  project.assets = [
    videoAsset('asset-intro', 'Intro.mp4', 8, 9_400_000),
    videoAsset('asset-beach', 'Beach.mp4', 20, 31_000_000),
    videoAsset('asset-interview', 'Interview.mp4', 15, 22_000_000),
    { id: 'asset-music', kind: 'audio', name: 'Sunset loop.mp3', relPath: 'media/sunset-loop.mp3', size: 4_800_000, duration: secondsToMicros(30) }
  ]
  project.clips = [
    videoClip('clip-intro', 'asset-intro', 0, 0, 8),
    videoClip('clip-beach', 'asset-beach', 8, 2, 14),
    videoClip('clip-interview', 'asset-interview', 20, 0, 10)
  ]
  project.texts = [
    {
      id: 'text-1',
      start: secondsToMicros(2),
      duration: secondsToMicros(4),
      text: 'Ein Tag am Meer',
      style: { font: 'Sora', size: 26, color: '#ffffff', outline: null },
      pos: { x: 0.5, y: 0.85 },
      animIn: null,
      animOut: null
    }
  ]
  project.music = [
    {
      id: 'music-1',
      assetId: 'asset-music',
      start: 0,
      srcIn: 0,
      srcOut: secondsToMicros(30),
      volume: 0.6,
      fadeIn: 0,
      fadeOut: secondsToMicros(1)
    }
  ]
  return project
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Non-reactive singletons: one autosaver per store instance, one work folder handle, one lifecycle listener set.
interface AutosaveTarget {
  saveStatus: AutosaveStatus
}

const autosavers = new WeakMap<object, Autosaver<Project>>()
let detachLifecycle: (() => void) | null = null

function autosaverFor(target: AutosaveTarget): Autosaver<Project> {
  let saver = autosavers.get(target)
  if (!saver) {
    saver = createAutosaver<Project>({
      delayMs: AUTOSAVE_DELAY_MS,
      save: async (project) => {
        const record: AutosaveRecord = { text: serializeProject(project), savedAt: Date.now() }
        if (!(await kvSet(AUTOSAVE_KEY, record))) throw new Error('autosave storage unavailable')
      },
      onStatus: (status) => {
        target.saveStatus = status
      }
    })
    autosavers.set(target, saver)
  }
  return saver
}

/** Flushes pending autosaves when the page is hidden or closed. Replaces any earlier listeners. */
function attachLifecycleFlush(flush: () => void): void {
  detachLifecycle?.()
  detachLifecycle = null
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flush)
  detachLifecycle = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flush)
  }
}

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    history: createHistory(buildDemoProject()),
    activeGroup: 'material',
    activeTab: 'media',
    // Frame 338 at 30 fps, displayed as 00:11:08.
    playheadMicros: frameStart(338, 30),
    theme: 'system',
    prefersDark: systemPrefersDark(),
    fileHandle: null,
    fileName: null,
    workFolderName: null,
    saveStatus: 'idle',
    dirtySinceFileSave: false,
    loadError: null,
    caps: detectCaps(),
    selection: null,
    isPlaying: false
  }),
  getters: {
    project(state): Project {
      return state.history.present
    },
    canUndo(state): boolean {
      return historyCanUndo(state.history)
    },
    canRedo(state): boolean {
      return historyCanRedo(state.history)
    },
    totalDuration(state): Micros {
      return projectDuration(state.history.present)
    },
    resolvedDark(state): boolean {
      return state.theme === 'dark' || (state.theme === 'system' && state.prefersDark)
    },
    timecode(state): string {
      return formatTimecode(state.playheadMicros, state.history.present.format.fps)
    },
    playheadPct(state): number {
      return toPct(state.playheadMicros, projectDuration(state.history.present))
    },
    mediaAssets(state): Asset[] {
      return state.history.present.assets.filter((a) => a.kind === 'video')
    },
    videoSpans(state): TimelineSpan[] {
      const project = state.history.present
      const total = projectDuration(project)
      return [...project.clips]
        .sort((a, b) => a.start - b.start)
        .map((clip, i) => ({
          id: clip.id,
          label: assetName(project, clip.assetId),
          leftPct: toPct(clip.start, total),
          widthPct: toPct(clipLength(clip), total),
          tone: ((i % 3) + 1) as 1 | 2 | 3
        }))
    },
    originalAudioSpans(state): TimelineSpan[] {
      const project = state.history.present
      const total = projectDuration(project)
      return [...project.clips]
        .filter((clip) => !clip.muted)
        .sort((a, b) => a.start - b.start)
        .map((clip) => ({
          id: `audio-${clip.id}`,
          label: assetName(project, clip.assetId),
          leftPct: toPct(clip.start, total),
          widthPct: toPct(clipLength(clip), total)
        }))
    },
    textSpans(state): TimelineSpan[] {
      const project = state.history.present
      const total = projectDuration(project)
      return project.texts.map((t) => ({
        id: t.id,
        label: t.text,
        leftPct: toPct(t.start, total),
        widthPct: toPct(t.duration, total)
      }))
    },
    musicSpans(state): TimelineSpan[] {
      const project = state.history.present
      const total = projectDuration(project)
      return project.music.map((m) => ({
        id: m.id,
        label: assetName(project, m.assetId),
        leftPct: toPct(m.start, total),
        widthPct: toPct(m.srcOut - m.srcIn, total)
      }))
    },
    rulerTicks(state): RulerTick[] {
      const total = projectDuration(state.history.present)
      const ticks: RulerTick[] = []
      for (let t = 0; t < total; t += RULER_STEP) {
        const seconds = Math.round(t / 1_000_000)
        const mm = Math.floor(seconds / 60).toString().padStart(2, '0')
        const ss = (seconds % 60).toString().padStart(2, '0')
        ticks.push({ label: `${mm}:${ss}`, leftPct: toPct(t, total) })
      }
      return ticks
    },
    subtitle(state): Subtitle {
      const words = (state.history.present.texts[0]?.text ?? '').split(' ').filter(Boolean)
      const accent = words.pop() ?? ''
      return { lead: words.join(' '), accent }
    },
    selectedItem(state): Clip | TextItem | MusicItem | null {
      const ref = state.selection
      if (!ref) return null
      const project = state.history.present
      if (ref.kind === 'clip') return project.clips.find((c) => c.id === ref.id) ?? null
      if (ref.kind === 'text') return project.texts.find((t) => t.id === ref.id) ?? null
      return project.music.find((m) => m.id === ref.id) ?? null
    },
    selectedClip(state): Clip | null {
      const ref = state.selection
      if (ref?.kind !== 'clip') return null
      return state.history.present.clips.find((c) => c.id === ref.id) ?? null
    },
    /** The clip that a transition would be applied to; see transitionTargetClipId. */
    transitionTargetId(state): string | null {
      return transitionTargetClipId(state.history.present, state.selection, state.playheadMicros)
    },
    canSplitAtPlayhead(state): boolean {
      const project = state.history.present
      return splitAt(project, state.playheadMicros, freshId(project, ID_PREFIX.clip)) !== project
    }
  },
  actions: {
    setActiveTab(tab: TabId) {
      this.activeTab = tab
    },
    setActiveGroup(group: GroupId, firstTab: TabId) {
      this.activeGroup = group
      this.activeTab = firstTab
    },
    setTheme(mode: ThemeMode) {
      this.theme = mode
      this.applyTheme()
    },
    toggleTheme() {
      this.setTheme(this.resolvedDark ? 'light' : 'dark')
    },
    applyTheme() {
      const root = document.documentElement
      if (this.theme === 'system') root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', this.theme)
    },

    /** Moves to a new history state; a real change marks the file dirty and schedules an autosave. */
    moveHistory(next: HistoryState<Project>) {
      if (next === this.history) return
      this.history = next
      this.dirtySinceFileSave = true
      this.scheduleAutosave()
    },
    commitProject(next: Project, key?: string) {
      this.moveHistory(commit(this.history, next, { key }))
    },
    undo() {
      this.moveHistory(undoHistory(this.history))
    },
    redo() {
      this.moveHistory(redoHistory(this.history))
    },
    /** Ends a rename step, so the next rename starts a new undo entry. */
    endRenameStep() {
      this.history = breakCoalescing(this.history)
    },
    renameProject(name: string) {
      this.commitProject({ ...this.project, name: name.slice(0, MAX_PROJECT_NAME) }, 'rename')
    },

    /** Replaces the whole document. The history starts over, so undo never mixes two files. */
    replaceDocument(project: Project, file: { handle: FsFileHandle | null; name: string | null }) {
      this.history = createHistory(project)
      useMediaStore().markMissingFor(project)
      this.fileHandle = file.handle
      this.fileName = file.name
      this.dirtySinceFileSave = false
      this.loadError = null
      this.selection = null
      this.scheduleAutosave()
    },
    newProject(name: string) {
      this.replaceDocument(createProject(name), { handle: null, name: null })
    },
    async openProject() {
      let picked: OpenedProjectFile | null
      try {
        picked = await openProjectFile()
      } catch (e) {
        this.loadError = errorMessage(e)
        return
      }
      if (!picked) return
      const result = parseProjectJson(picked.text)
      if (!result.ok) {
        this.loadError = result.errors.join('; ')
        return
      }
      this.replaceDocument(result.project, { handle: picked.handle ?? null, name: picked.name })
    },
    async saveProject() {
      const project = this.project
      const text = serializeProject(project)
      const suggested = projectFileName(project.name)
      try {
        let saved: SavedProjectFile | null
        const folder = activeWorkFolder()
        if (this.fileHandle) saved = await saveProjectFile(text, suggested, this.fileHandle)
        else if (folder) saved = { name: await saveInWorkFolder(folder, text, suggested) }
        else saved = await saveProjectFile(text, suggested)
        if (!saved) return
        this.fileHandle = saved.handle ?? null
        this.fileName = saved.name
        // Edits made while the save was running stay dirty.
        this.dirtySinceFileSave = this.history.present !== project
      } catch (e) {
        this.loadError = errorMessage(e)
      }
    },
    downloadProject() {
      const project = this.project
      downloadProjectFile(serializeProject(project), projectFileName(project.name))
      this.dirtySinceFileSave = this.history.present !== project
    },
    async chooseFolder() {
      try {
        const dir = await chooseWorkFolder()
        if (!dir) return
        setActiveWorkFolder(dir)
        this.workFolderName = dir.name
      } catch (e) {
        this.loadError = errorMessage(e)
      }
    },
    dismissLoadError() {
      this.loadError = null
    },

    scheduleAutosave() {
      autosaverFor(this).notify(this.history.present)
    },
    async flushAutosave() {
      await autosaverFor(this).flush()
    },
    /** Loads the autosaved project (if it is valid) and the remembered work folder. Call once on app start. */
    async restoreAutosave() {
      attachLifecycleFlush(() => {
        void this.flushAutosave()
      })
      const startedFrom = this.history
      const [record, folder] = await Promise.all([kvGet<AutosaveRecord>(AUTOSAVE_KEY), loadWorkFolder()])
      setActiveWorkFolder(folder)
      this.workFolderName = folder?.name ?? null
      // The user may have started editing while storage was loading; their work wins.
      if (this.history !== startedFrom) return
      if (!record || typeof record.text !== 'string') return
      const result = parseProjectJson(record.text)
      if (result.ok) {
        this.history = createHistory(result.project)
        useMediaStore().markMissingFor(result.project)
      }
    },

    select(ref: ItemRef | null) {
      this.selection = ref ? { kind: ref.kind, id: ref.id } : null
    },
    togglePlaying() {
      this.isPlaying = !this.isPlaying
    },
    /** Clamped to 0..project duration; the playhead is always a whole number of microseconds. */
    setPlayhead(micros: Micros) {
      const value = Number.isFinite(micros) ? Math.round(micros) : 0
      this.playheadMicros = Math.min(Math.max(value, 0), this.totalDuration)
    },
    stepFrame(delta: number) {
      if (!Number.isFinite(delta)) return
      const fps = this.project.format.fps
      const frame = frameIndexAt(this.playheadMicros, fps) + Math.trunc(delta)
      this.setPlayhead(frameStart(Math.max(0, frame), fps))
    },

    /**
     * Starts a drag gesture. Edits made until endGesture are computed from the project as it
     * was now and share one undo step, so the drag can be reversed or moved back exactly.
     */
    beginGesture() {
      gestureBase = this.project
    },
    endGesture() {
      gestureBase = null
      this.history = breakCoalescing(this.history)
    },
    /** Applies an edit to the gesture's base project (or the current one outside a gesture). */
    editProject(build: (base: Project) => Project, key?: string) {
      this.commitProject(build(gestureBase ?? this.project), key)
    },
    trimStart(id: string, t: Micros) {
      this.editProject((base) => trimVideoStart(base, id, t), `trim-start:${id}`)
    },
    trimEnd(id: string, t: Micros) {
      this.editProject((base) => trimVideoEnd(base, id, t), `trim-end:${id}`)
    },
    trimTextStart(id: string, t: Micros) {
      this.editProject((base) => trimTextStart(base, id, t), `text-trim-start:${id}`)
    },
    trimTextEnd(id: string, t: Micros) {
      this.editProject((base) => trimTextEnd(base, id, t), `text-trim-end:${id}`)
    },
    moveText(id: string, t: Micros) {
      this.editProject((base) => moveTextInTime(base, id, t), `text-move:${id}`)
    },
    reorderClip(id: string, index: number) {
      this.commitProject(reorderVideoClip(this.project, id, index))
    },

    splitAtPlayhead() {
      const project = this.project
      this.commitProject(splitAt(project, this.playheadMicros, freshId(project, ID_PREFIX.clip)))
    },
    deleteSelected() {
      const ref = this.selection
      if (!ref) return
      this.commitProject(deleteItem(this.project, ref))
      this.selection = null
    },
    duplicateSelected() {
      const ref = this.selection
      if (!ref) return
      const project = this.project
      const id = freshId(project, ID_PREFIX[ref.kind])
      const next = duplicateItem(project, ref, id)
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: ref.kind, id }
    },
    toggleMuteSelected() {
      const clip = this.selectedClip
      if (!clip) return
      this.commitProject(setClipProps(this.project, clip.id, { muted: !clip.muted }))
    },
    flipSelected() {
      const clip = this.selectedClip
      if (!clip) return
      this.commitProject(setClipProps(this.project, clip.id, { transform: { flipX: !clip.transform.flipX } }))
    },
    rotateSelected() {
      const clip = this.selectedClip
      if (!clip) return
      const rotation = normalizeAngle(clip.transform.rotation + 90)
      this.commitProject(setClipProps(this.project, clip.id, { transform: { rotation } }))
    },
    cycleSpeedSelected() {
      const clip = this.selectedClip
      if (!clip) return
      this.commitProject(setClipProps(this.project, clip.id, { speed: nextSpeed(clip.speed) }))
    },

    /**
     * Adds a text at the playhead and selects it. `text` is the initial content; the UI passes the
     * localised default. Slider and typing edits pass a `key` so one drag or burst is one undo step.
     */
    addTextAtPlayhead(preset: TextPresetId = 'title', text = 'Text') {
      const project = this.project
      const id = freshId(project, ID_PREFIX.text)
      const next = addText(project, id, this.playheadMicros, { preset, text })
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: 'text', id }
    },
    updateSelectedText(patch: TextPatch, key?: string) {
      const ref = this.selection
      if (ref?.kind !== 'text') return
      this.commitProject(updateText(this.project, ref.id, patch), key)
    },
    setSelectedClipProps(patch: ClipPatch, key?: string) {
      const clip = this.selectedClip
      if (!clip) return
      this.commitProject(setClipProps(this.project, clip.id, patch), key)
    },
    /** Applies a transition to transitionTargetClipId and selects that clip, so its panel shows the result. */
    applyTransition(type: TransitionType, duration: Micros = DEFAULT_TRANSITION, key?: string) {
      const project = this.project
      const id = transitionTargetClipId(project, this.selection, this.playheadMicros)
      if (!id) return
      this.selection = { kind: 'clip', id }
      this.commitProject(setTransition(project, id, { type, duration }), key)
    },
    /** Removes the transition at the cut before the given clip, or before the selected clip when no id is given. */
    removeTransition(clipId?: string) {
      const id = clipId ?? this.selectedClip?.id
      if (!id) return
      this.commitProject(setTransition(this.project, id, null))
    },
    setRatio(ratio: FormatRatio) {
      this.commitProject(setFormatRatio(this.project, ratio))
    },
    setBackground(background: FormatBackground, key?: string) {
      this.commitProject(setFormatBackground(this.project, background), key)
    },
    /** Fit or Fill for the whole project (format and all clips); independent of the selection. */
    setProjectFit(fit: FitMode, key?: string) {
      this.commitProject(setAllFit(this.project, fit), key)
    },
    updateSelectedMusic(patch: MusicPatch, key?: string) {
      const ref = this.selection
      if (ref?.kind !== 'music') return
      this.commitProject(updateMusic(this.project, ref.id, patch), key)
    }
  }
})
