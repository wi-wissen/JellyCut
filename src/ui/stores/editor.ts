import { defineStore } from 'pinia'
import { createProject, parseProjectJson, serializeProject } from '../../core/project/schema'
import type { Asset, Clip, FitMode, FormatRatio, MusicItem, OverlayItem, Project, RegionOverlay, ShapeOverlay, TextItem } from '../../core/project/types'
import { DEFAULT_OVERLAY_COLOR, MARKER_PRESET, type LineWidthId } from '../../core/timeline/overlayCatalog'
import type { StickerShapeId } from '../../core/render/stickerShapes'
import {
  addMedia,
  addRegion,
  addShape,
  addSticker,
  addStroke,
  addImageSticker,
  addVectorSticker,
  bringForward,
  bringToFront,
  moveOverlay as moveOverlayInTime,
  removeLastStroke,
  sendBackward,
  sendToBack,
  trimOverlayEnd as trimOverlayEndInTime,
  trimOverlayStart as trimOverlayStartInTime,
  updateOverlay,
  type OverlayPatch,
  type StrokePoint
} from '../../core/timeline/overlayOps'
import {
  setAllFit,
  setBackground as setFormatBackground,
  setRatio as setFormatRatio,
  type FormatBackground
} from '../../core/project/format'
import type { TransitionType } from '../../core/render/types'
import { formatTimecode, frameIndexAt, frameStart, secondsToMicros, type Micros } from '../../core/time'
import { applyGradeToAll, setClipGrade as setGrade, type GradePatch } from '../../core/filters/ops'
import { nextId } from '../../core/timeline/ids'
import { freezeFrameAt } from '../../core/timeline/freezeOps'
import { timelineLength } from '../../core/timeline/speed'
import { fitToVideo, videoEnd } from '../../core/timeline/fit'
import {
  moveMusic as moveMusicInTime,
  splitMusicAt,
  trimMusicEnd,
  trimMusicStart,
  updateMusic,
  type MusicPatch
} from '../../core/timeline/musicOps'
import { addText, updateText, type TextPresetId, type TextPatch } from '../../core/timeline/textOps'
import { DEFAULT_TRANSITION, setTransition, transitionTargetClipId } from '../../core/timeline/transitionOps'
import {
  deleteItem,
  duplicateItem,
  moveText as moveTextInTime,
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
import { detectLocale } from '../i18n'
import de from '../../locales/de.json'
import en from '../../locales/en.json'

export type TabId = 'media' | 'audio' | 'record' | 'text' | 'sticker' | 'shape' | 'draw' | 'region' | 'picture' | 'filter' | 'transitions'
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
  /** Set by `?demo=1`. A demo session never reads or writes the autosave. */
  demo: boolean
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
  /** Message of the last failed autosave in this browser; null when the last save worked. */
  autosaveError: string | null
  dirtySinceFileSave: boolean
  /** Time (ms since epoch) of the first edit since the last file save; null when nothing is unsaved. */
  unsavedSince: number | null
  loadError: string | null
  caps: ProjectFileCaps
  /** The timeline item the user selected, if it still exists. */
  selection: ItemRef | null
  /** Read by the transport code; the store does not play anything itself. */
  isPlaying: boolean
  /** Colour for new shapes and strokes. Not part of the project and not undoable. */
  overlayColor: string
  penWidth: LineWidthId
  /** Pen opacity 0..1; 1 is opaque. Applied to each stroke as a whole. */
  penOpacity: number
  /** Line ends of new strokes; 'flat' only from the marker preset. */
  penCap: 'round' | 'flat'
  /** Drawing mode: pointer input on the player makes strokes instead of selecting. */
  drawing: boolean
  /** Shape of new blur or pixelate areas (the Hide tab). Not part of the project. */
  regionShape: RegionOverlay['shape']
}

const RULER_STEP = secondsToMicros(5)
const AUTOSAVE_DELAY_MS = 800
const MAX_PROJECT_NAME = 60
const ID_PREFIX: Record<ItemKind, string> = { clip: 'clip-', text: 'text-', music: 'music-', overlay: 'overlay-' }

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
  return timelineLength(clip.srcOut - clip.srcIn, clip.speed)
}

export function projectDuration(project: Project): Micros {
  const ends = [
    ...project.clips.map((c) => c.start + clipLength(c)),
    ...project.texts.map((t) => t.start + t.duration),
    ...project.overlays.map((o) => o.start + o.duration),
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
  autosaveError: string | null
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
      onError: (e) => {
        target.autosaveError = errorMessage(e)
      },
      onStatus: (status) => {
        target.saveStatus = status
        if (status !== 'error') target.autosaveError = null
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

/** `?demo=1` starts with the built-in demo project (tests and screenshots). Read once, when the store is created. */
function isDemoRequested(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('demo') === '1'
  } catch {
    return false
  }
}

/** The start project: an empty project, named in the UI language. */
function startProject(): Project {
  const locale = detectLocale(typeof navigator === 'undefined' ? ['en'] : navigator.languages)
  return createProject((locale === 'de' ? de : en).start.projectName)
}

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => {
    const demo = isDemoRequested()
    return {
      history: createHistory(demo ? buildDemoProject() : startProject()),
      demo,
      activeGroup: 'material',
      activeTab: 'media',
      // Frame 338 at 30 fps, displayed as 00:11:08.
      playheadMicros: demo ? frameStart(338, 30) : 0,
      theme: 'system',
      prefersDark: systemPrefersDark(),
      fileHandle: null,
      fileName: null,
      workFolderName: null,
      saveStatus: 'idle',
      autosaveError: null,
      dirtySinceFileSave: false,
      unsavedSince: null,
      loadError: null,
      caps: detectCaps(),
      selection: null,
      isPlaying: false,
      overlayColor: DEFAULT_OVERLAY_COLOR,
      penWidth: 'medium',
      penOpacity: 1,
      penCap: 'round',
      drawing: false,
      regionShape: 'rect'
    }
  },
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
    /** End of the video (clips and transitions); zero without clips. Overlays and texts never pass it. */
    videoEndMicros(state): Micros {
      return videoEnd(state.history.present)
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
    selectedItem(state): Clip | TextItem | MusicItem | OverlayItem | null {
      const ref = state.selection
      if (!ref) return null
      const project = state.history.present
      if (ref.kind === 'clip') return project.clips.find((c) => c.id === ref.id) ?? null
      if (ref.kind === 'text') return project.texts.find((t) => t.id === ref.id) ?? null
      if (ref.kind === 'overlay') return project.overlays.find((o) => o.id === ref.id) ?? null
      return project.music.find((m) => m.id === ref.id) ?? null
    },
    /** The music item (own sound) the selection points to; null for any other item. */
    selectedMusic(state): MusicItem | null {
      const ref = state.selection
      if (ref?.kind !== 'music') return null
      return state.history.present.music.find((m) => m.id === ref.id) ?? null
    },
    selectedOverlay(state): OverlayItem | null {
      const ref = state.selection
      if (ref?.kind !== 'overlay') return null
      return state.history.present.overlays.find((o) => o.id === ref.id) ?? null
    },
    /** Strokes in the project; the pen panel enables its undo button only when there is one. */
    strokeCount(state): number {
      return state.history.present.overlays.filter((o) => o.kind === 'stroke').length
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
      // Leaving the pen tab ends drawing, so the player goes back to normal pointer use.
      if (tab !== 'draw') this.drawing = false
    },
    setActiveGroup(group: GroupId, firstTab: TabId) {
      this.activeGroup = group
      this.activeTab = firstTab
      if (firstTab !== 'draw') this.drawing = false
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
      // Undo and redo can take an asset out of the project or back in; the media store follows the document.
      useMediaStore().reconcileWith(next.present)
      if (!this.dirtySinceFileSave) this.unsavedSince = Date.now()
      this.dirtySinceFileSave = true
      this.scheduleAutosave()
    },
    /** The one way a project edit enters the history. Items that hang over the end of the video are kept on it. */
    commitProject(next: Project, key?: string) {
      this.moveHistory(commit(this.history, fitToVideo(next), { key }))
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
      // Quietly: a loaded project that hangs over its video is fitted, but not marked dirty.
      this.history = createHistory(fitToVideo(project))
      useMediaStore().markMissingFor(project)
      this.fileHandle = file.handle
      this.fileName = file.name
      this.dirtySinceFileSave = false
      this.unsavedSince = null
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
        if (!this.dirtySinceFileSave) this.unsavedSince = null
      } catch (e) {
        this.loadError = errorMessage(e)
      }
    },
    downloadProject() {
      const project = this.project
      downloadProjectFile(serializeProject(project), projectFileName(project.name))
      this.dirtySinceFileSave = this.history.present !== project
      if (!this.dirtySinceFileSave) this.unsavedSince = null
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
      if (this.demo) return
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
      // A demo session keeps its own document and must not pick up a real project's autosave.
      const savedRecord = this.demo ? Promise.resolve(null) : kvGet<AutosaveRecord>(AUTOSAVE_KEY)
      const [record, folder] = await Promise.all([savedRecord, loadWorkFolder()])
      setActiveWorkFolder(folder)
      this.workFolderName = folder?.name ?? null
      // The user may have started editing while storage was loading; their work wins.
      if (this.history !== startedFrom) return
      if (!record || typeof record.text !== 'string') return
      const result = parseProjectJson(record.text)
      if (result.ok) {
        this.history = createHistory(fitToVideo(result.project))
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
    /** Freeze frame of the picture under the playhead, inserted with the default length. */
    insertFreezeFrame() {
      const project = this.project
      const stillId = freshId(project, ID_PREFIX.clip)
      const splitId = nextId([...projectIds(project), stillId], ID_PREFIX.clip)
      this.commitProject(freezeFrameAt(project, this.playheadMicros, { stillId, splitId }))
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
    /** Mute of the selected clip (original sound) or of the selected own sound item. */
    toggleMuteSelected() {
      const clip = this.selectedClip
      if (clip) {
        this.commitProject(setClipProps(this.project, clip.id, { muted: !clip.muted }))
        return
      }
      const music = this.selectedMusic
      if (music) this.commitProject(updateMusic(this.project, music.id, { muted: !music.muted }))
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
    /**
     * Sets the tempo of the selected clip (one undo step). Returns false when the speed is out of range
     * or the clip would be shorter than one microsecond; the project is then unchanged.
     */
    setClipSpeed(clipId: string, speed: number): boolean {
      const project = this.project
      const next = setClipProps(project, clipId, { speed })
      if (next === project) return false
      this.commitProject(next)
      return true
    },
    /** Splits the selected own sound item at the playhead (one undo step). */
    splitSelectedMusic() {
      const music = this.selectedMusic
      if (!music) return
      const project = this.project
      const id = freshId(project, ID_PREFIX.music)
      this.commitProject(splitMusicAt(project, music.id, this.playheadMicros, id, project.format.fps))
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
    /** Colour filter, intensity and adjustments of one clip (the selected clip or the one under the playhead). */
    setClipGrade(clipId: string | null, patch: GradePatch, key?: string) {
      if (!clipId) return
      this.commitProject(setGrade(this.project, clipId, patch), key)
    },
    applyGradeToAllClips(clipId: string) {
      this.commitProject(applyGradeToAll(this.project, clipId))
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
    },

    // --- stickers, shapes and strokes (overlays) ---
    setOverlayColor(color: string) {
      this.overlayColor = color
    },
    setPenWidth(width: LineWidthId) {
      this.penWidth = width
      // A width choice leaves the marker preset: round ends again.
      this.penCap = 'round'
    },
    setPenOpacity(opacity: number) {
      if (Number.isFinite(opacity)) this.penOpacity = Math.min(1, Math.max(0, opacity))
    },
    /** Sets the pen to the marker ('Textmarker') preset: yellow, wide, flat ends, 40 % opacity. */
    applyMarkerPreset() {
      this.overlayColor = MARKER_PRESET.color
      this.penWidth = MARKER_PRESET.width
      this.penOpacity = MARKER_PRESET.opacity
      this.penCap = MARKER_PRESET.cap
    },
    setDrawing(on: boolean) {
      this.drawing = on
      if (on) this.select(null)
    },
    /** Adds a sticker at the playhead and selects it. */
    addStickerAtPlayhead(emoji: string) {
      const project = this.project
      const id = freshId(project, ID_PREFIX.overlay)
      const next = addSticker(project, id, this.playheadMicros, emoji)
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: 'overlay', id }
    },
    addShapeAtPlayhead(shape: ShapeOverlay['shape']) {
      const project = this.project
      const id = freshId(project, ID_PREFIX.overlay)
      const next = addShape(project, id, this.playheadMicros, shape, this.overlayColor)
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: 'overlay', id }
    },
    /** One finished pen stroke is one undo step. Points are output fractions. */
    addStrokeAtPlayhead(points: StrokePoint[]) {
      const project = this.project
      const id = freshId(project, ID_PREFIX.overlay)
      const next = addStroke(project, id, this.playheadMicros, points, this.overlayColor, this.penWidth, {
        opacity: this.penOpacity,
        cap: this.penCap
      })
      if (next !== project) this.commitProject(next)
    },
    /** Adds a picture sticker of the catalog at the playhead and selects it. */
    addImageStickerAtPlayhead(imageId: string) {
      const project = this.project
      const id = freshId(project, ID_PREFIX.overlay)
      const next = addImageSticker(project, id, this.playheadMicros, imageId)
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: 'overlay', id }
    },
    /** Adds a built-in vector sticker at the playhead and selects it. */
    addVectorStickerAtPlayhead(shape: StickerShapeId) {
      const project = this.project
      const id = freshId(project, ID_PREFIX.overlay)
      const next = addVectorSticker(project, id, this.playheadMicros, shape, this.overlayColor)
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: 'overlay', id }
    },
    /** Changes the stacking of the selected overlay (see core/timeline/overlayOps). One undo step. */
    stackSelectedOverlay(direction: 'forward' | 'backward' | 'front' | 'back') {
      const ref = this.selection
      if (ref?.kind !== 'overlay') return
      const op = { forward: bringForward, backward: sendBackward, front: bringToFront, back: sendToBack }[direction]
      this.commitProject(op(this.project, ref.id))
    },
    setRegionShape(shape: RegionOverlay['shape']) {
      this.regionShape = shape
    },
    /** Adds a blur or pixelate area at the playhead, in the chosen shape, and selects it. */
    addRegionAtPlayhead(effect: RegionOverlay['effect']) {
      const project = this.project
      const id = freshId(project, ID_PREFIX.overlay)
      const next = addRegion(project, id, this.playheadMicros, effect, undefined, this.regionShape)
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: 'overlay', id }
    },
    /** Adds a library image or video as a picture in the picture at the playhead and selects it. */
    addMediaAtPlayhead(assetId: string) {
      const project = this.project
      const id = freshId(project, ID_PREFIX.overlay)
      const next = addMedia(project, id, this.playheadMicros, assetId)
      if (next === project) return
      this.commitProject(next)
      this.selection = { kind: 'overlay', id }
    },
    /** Removes the most recently drawn stroke. */
    undoLastStroke() {
      this.commitProject(removeLastStroke(this.project))
    },
    updateSelectedOverlay(patch: OverlayPatch, key?: string) {
      const ref = this.selection
      if (ref?.kind !== 'overlay') return
      this.commitProject(updateOverlay(this.project, ref.id, patch), key)
    },
    moveMusic(id: string, t: Micros) {
      this.editProject((base) => moveMusicInTime(base, id, t), `music-move:${id}`)
    },
    trimMusicStart(id: string, t: Micros) {
      this.editProject((base) => trimMusicStart(base, id, t, base.format.fps), `music-trim-start:${id}`)
    },
    trimMusicEnd(id: string, t: Micros) {
      this.editProject((base) => trimMusicEnd(base, id, t, base.format.fps), `music-trim-end:${id}`)
    },
    moveOverlay(id: string, t: Micros) {
      this.editProject((base) => moveOverlayInTime(base, id, t), `overlay-move:${id}`)
    },
    trimOverlayStart(id: string, t: Micros) {
      this.editProject((base) => trimOverlayStartInTime(base, id, t), `overlay-trim-start:${id}`)
    },
    trimOverlayEnd(id: string, t: Micros) {
      this.editProject((base) => trimOverlayEndInTime(base, id, t), `overlay-trim-end:${id}`)
    }
  }
})
