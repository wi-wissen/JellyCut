import { defineStore } from 'pinia'
import { createProject, parseProjectJson, serializeProject } from '../../core/project/schema'
import type { Asset, Clip, Project } from '../../core/project/types'
import { formatTimecode, frameStart, secondsToMicros, type Micros } from '../../core/time'
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
  type FsDirectoryHandle,
  type FsFileHandle,
  type OpenedProjectFile,
  type ProjectFileCaps,
  type SavedProjectFile
} from '../../platform/projectFiles'

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
}

const RULER_STEP = secondsToMicros(5)
const AUTOSAVE_DELAY_MS = 800
const MAX_PROJECT_NAME = 60

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
let workFolder: FsDirectoryHandle | null = null
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
    caps: detectCaps()
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
      this.fileHandle = file.handle
      this.fileName = file.name
      this.dirtySinceFileSave = false
      this.loadError = null
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
        if (this.fileHandle) saved = await saveProjectFile(text, suggested, this.fileHandle)
        else if (workFolder) saved = { name: await saveInWorkFolder(workFolder, text, suggested) }
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
        workFolder = dir
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
      workFolder = folder
      this.workFolderName = folder?.name ?? null
      // The user may have started editing while storage was loading; their work wins.
      if (this.history !== startedFrom) return
      if (!record || typeof record.text !== 'string') return
      const result = parseProjectJson(record.text)
      if (result.ok) this.history = createHistory(result.project)
    }
  }
})
