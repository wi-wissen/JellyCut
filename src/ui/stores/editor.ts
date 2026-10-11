import { defineStore } from 'pinia'
import { createProject } from '../../core/project/schema'
import type { Asset, Clip, Project } from '../../core/project/types'
import { formatTimecode, frameStart, secondsToMicros, type Micros } from '../../core/time'

export type TabId = 'media' | 'audio' | 'record' | 'text' | 'sticker' | 'draw' | 'captions' | 'filter' | 'transitions'
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
  project: Project
  activeTab: TabId
  playheadMicros: Micros
  theme: ThemeMode
  prefersDark: boolean
}

const RULER_STEP = secondsToMicros(5)

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

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    project: buildDemoProject(),
    activeTab: 'media',
    // Frame 338 at 30 fps, displayed as 00:11:08.
    playheadMicros: frameStart(338, 30),
    theme: 'system',
    prefersDark: systemPrefersDark()
  }),
  getters: {
    totalDuration(state): Micros {
      return projectDuration(state.project)
    },
    resolvedDark(state): boolean {
      return state.theme === 'dark' || (state.theme === 'system' && state.prefersDark)
    },
    timecode(state): string {
      return formatTimecode(state.playheadMicros, state.project.format.fps)
    },
    playheadPct(state): number {
      return toPct(state.playheadMicros, projectDuration(state.project))
    },
    mediaAssets(state): Asset[] {
      return state.project.assets.filter((a) => a.kind === 'video')
    },
    videoSpans(state): TimelineSpan[] {
      const total = projectDuration(state.project)
      return [...state.project.clips]
        .sort((a, b) => a.start - b.start)
        .map((clip, i) => ({
          id: clip.id,
          label: assetName(state.project, clip.assetId),
          leftPct: toPct(clip.start, total),
          widthPct: toPct(clipLength(clip), total),
          tone: ((i % 3) + 1) as 1 | 2 | 3
        }))
    },
    originalAudioSpans(state): TimelineSpan[] {
      const total = projectDuration(state.project)
      return [...state.project.clips]
        .filter((clip) => !clip.muted)
        .sort((a, b) => a.start - b.start)
        .map((clip) => ({
          id: `audio-${clip.id}`,
          label: assetName(state.project, clip.assetId),
          leftPct: toPct(clip.start, total),
          widthPct: toPct(clipLength(clip), total)
        }))
    },
    textSpans(state): TimelineSpan[] {
      const total = projectDuration(state.project)
      return state.project.texts.map((t) => ({
        id: t.id,
        label: t.text,
        leftPct: toPct(t.start, total),
        widthPct: toPct(t.duration, total)
      }))
    },
    musicSpans(state): TimelineSpan[] {
      const total = projectDuration(state.project)
      return state.project.music.map((m) => ({
        id: m.id,
        label: assetName(state.project, m.assetId),
        leftPct: toPct(m.start, total),
        widthPct: toPct(m.srcOut - m.srcIn, total)
      }))
    },
    rulerTicks(state): RulerTick[] {
      const total = projectDuration(state.project)
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
      const words = (state.project.texts[0]?.text ?? '').split(' ').filter(Boolean)
      const accent = words.pop() ?? ''
      return { lead: words.join(' '), accent }
    }
  },
  actions: {
    setActiveTab(tab: TabId) {
      this.activeTab = tab
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
    }
  }
})
