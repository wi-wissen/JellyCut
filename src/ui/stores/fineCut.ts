import { defineStore } from 'pinia'
import type { Clip } from '../../core/project/types'
import { computeWaveform } from '../../engine/audio/waveform'
import { KeyframeIndex } from '../../engine/media/keyframes'
import { findPauses, nextPause, type Pause, type Waveform } from '../../core/audio/peaks'
import { nextId } from '../../core/timeline/ids'
import {
  clampCut,
  clipForFineCut,
  cutBounds,
  frameIndexLabel,
  nominalFps,
  pauseJumpTarget,
  snapToKeyframe,
  srcToTimeline,
  timelineToSrc
} from '../../core/timeline/fineCut'
import { projectIds, splitAt } from '../../core/timeline/ops'
import { frameDuration, frameIndexAt, frameStart, type Micros } from '../../core/time'
import { getAssetFile, getFrameProvider } from './media'
import { useEditorStore } from './editor'

export type FineCutError = 'no-file' | 'too-short' | 'cannot-cut' | null

interface WaveData {
  waveform: Waveform | null
  pauses: Pause[]
}

interface FrameSpan {
  start: Micros
  end: Micros
}

const PREFS_KEY = 'jellycut.fineCut'
const LANE = 'fine-cut'
/** Keyboard steps stop on a keyframe that is at most this many frames away. */
const SNAP_FRAMES = 3
/** Keyframes are looked up this many frames to each side of the cut; the strip spans at most 64 frames each side. */
const KEY_WINDOW_FRAMES = 64
const SNIPPET_MICROS = 80_000
/** Frame starts that differ by less than this are the same frame (timestamps are whole microseconds). */
const BOUNDARY_TOLERANCE: Micros = 1_000
/** A jump looks this far past the cut, so a cut sitting exactly on a keyframe or pause does not find the same one again. */
const JUMP_EPSILON: Micros = 1_000

// Not reactive: decoders, the waveform data and the audio element are large or DOM objects.
const waves = new Map<string, WaveData>()
const waveJobs = new Map<string, Promise<WaveData>>()
let keyframes: KeyframeIndex | null = null
/** Bumped on open and close; work from an older generation is dropped. */
let generation = 0
/** Keyboard steps and jumps run one after another, so a burst of presses is not lost. */
let queue: Promise<void> = Promise.resolve()
let audioEl: HTMLVideoElement | null = null
let audioFile: File | null = null
let audioUrl: string | null = null
let audioTimer: ReturnType<typeof setTimeout> | null = null

function readPrefs(): { snap: boolean; sound: boolean } {
  const fallback = { snap: true, sound: true }
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      snap: typeof parsed.snap === 'boolean' ? parsed.snap : fallback.snap,
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : fallback.sound
    }
  } catch {
    return fallback
  }
}

function writePrefs(snap: boolean, sound: boolean): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ snap, sound }))
  } catch {
    // Storage may be blocked; the choice then lasts for this page only.
  }
}

/** Plays a short piece of the source audio at srcTime. Autoplay or missing audio is silently ignored. */
function playSnippet(file: File, srcTime: Micros): void {
  try {
    if (!audioEl) audioEl = document.createElement('video')
    if (audioFile !== file) {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      audioUrl = URL.createObjectURL(file)
      audioFile = file
      audioEl.src = audioUrl
    }
    audioEl.currentTime = srcTime / 1_000_000
    audioEl.play()?.catch(() => undefined)
    if (audioTimer) clearTimeout(audioTimer)
    audioTimer = setTimeout(() => {
      audioTimer = null
      audioEl?.pause()
    }, SNIPPET_MICROS / 1000)
  } catch {
    // No audio output is not an error for the cut itself.
  }
}

function stopSnippet(): void {
  if (audioTimer) clearTimeout(audioTimer)
  audioTimer = null
  try {
    audioEl?.pause()
    audioEl?.removeAttribute('src')
  } catch {
    // Nothing to stop.
  }
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  audioUrl = null
  audioFile = null
}

const initialPrefs = readPrefs()

export const useFineCutStore = defineStore('fineCut', {
  state: () => ({
    isOpen: false,
    clipId: null as string | null,
    assetId: null as string | null,
    fps: 30,
    /** Cut position on the timeline, a whole number of microseconds. */
    cutTime: 0,
    /** 0 shows one second across the viewport, 100 one frame at 64 px. */
    zoom: 0,
    snapKeyframes: initialPrefs.snap,
    soundOnStep: initialPrefs.sound,
    /** null while the waveform is still being computed. */
    hasAudio: null as boolean | null,
    waveformLoading: false,
    waveformFraction: 0,
    /** Incremented when waveform data changes; views read it to redraw. */
    waveformRevision: 0,
    keyframeTimes: [] as Micros[],
    pendingJobs: 0,
    error: null as FineCutError
  }),
  getters: {
    clip(state): Clip | null {
      if (!state.clipId) return null
      return useEditorStore().project.clips.find((c) => c.id === state.clipId) ?? null
    },
    assetName(state): string {
      const asset = useEditorStore().project.assets.find((a) => a.id === state.assetId)
      return asset?.name ?? ''
    },
    frameMicros(state): Micros {
      return frameDuration(state.fps)
    },
    /** Source time of the first frame after the cut. */
    cutSrc(state): Micros {
      const clip = this.clip
      return clip ? timelineToSrc(clip, state.cutTime) : 0
    },
    frameIndex(state): number {
      return frameIndexLabel(this.cutSrc, state.fps)
    },
    /** Pauses inside the clip's source range, in source time. */
    pauses(state): Pause[] {
      void state.waveformRevision
      const clip = this.clip
      const data = state.assetId ? waves.get(state.assetId) : undefined
      if (!clip || !data) return []
      return data.pauses.filter((p) => p.start >= clip.srcIn && p.start < clip.srcOut)
    },
    canCut(state): boolean {
      const clip = this.clip
      return !!clip && cutBounds(clip, Math.max(1, Math.round(frameDuration(state.fps) / clip.speed))) !== null
    }
  },
  actions: {
    /** Opens on the clip under the playhead or the selected clip. Returns false when no clip can be edited. */
    async open(): Promise<boolean> {
      if (this.isOpen) return true
      const editor = useEditorStore()
      const clip = clipForFineCut(editor.project, editor.playheadMicros, editor.selection)
      if (!clip) return false
      const asset = editor.project.assets.find((a) => a.id === clip.assetId)
      const fps = nominalFps(asset?.fps ?? editor.project.format.fps)
      const gen = ++generation
      const file = getAssetFile(clip.assetId)
      const tlFrame = Math.max(1, Math.round(frameDuration(fps) / clip.speed))

      this.isOpen = true
      this.clipId = clip.id
      this.assetId = clip.assetId
      this.fps = fps
      this.cutTime = clampCut(clip, editor.playheadMicros, tlFrame)
      this.zoom = 0
      this.hasAudio = null
      this.waveformLoading = false
      this.waveformFraction = 0
      this.keyframeTimes = []
      this.error = null
      if (!cutBounds(clip, tlFrame)) this.error = 'too-short'
      if (!file) {
        this.error = this.error ?? 'no-file'
        this.hasAudio = false
      } else {
        void KeyframeIndex.open(file)
          .catch(() => null)
          .then((index) => {
            if (gen !== generation) {
              index?.dispose()
              return
            }
            keyframes?.dispose()
            keyframes = index
            void this.enqueue(() => this.refreshKeyframes())
          })
        this.startWaveform(clip.assetId, file, gen)
      }
      void this.enqueue(async () => {
        const current = this.clip
        if (!current) return
        this.cutTime = await this.settle(current, this.cutTime, 0)
        await this.refreshKeyframes()
      })
      return true
    },

    close(): void {
      generation++
      this.isOpen = false
      this.error = null
      this.keyframeTimes = []
      keyframes?.dispose()
      keyframes = null
      stopSnippet()
    },

    /** Moves the cut by whole source frames. Shift = 10 is passed as n = 10. */
    stepFrames(n: number): Promise<void> {
      const steps = Math.trunc(n)
      if (!this.isOpen || !Number.isFinite(steps) || steps === 0) return Promise.resolve()
      return this.enqueue(async () => {
        const clip = this.clip
        if (!clip) return
        const dir = steps > 0 ? 1 : -1
        const window = frameDuration(this.fps)
        for (let i = 0; i < Math.abs(steps); i++) {
          const before = this.cutTime
          const cur = timelineToSrc(clip, this.cutTime)
          const neighbour = dir > 0 ? (await this.frameAt(cur)).end : (await this.frameAt(Math.max(0, cur - window / 2))).start
          let target = neighbour
          if (this.snapKeyframes && keyframes) {
            // Only keyframes ahead of the cut in the direction of travel; the cut itself would match otherwise.
            const near =
              dir > 0
                ? await keyframes.inRange(cur + 1, neighbour + window * SNAP_FRAMES)
                : await keyframes.inRange(Math.max(0, neighbour - window * SNAP_FRAMES), cur - 1)
            target = snapToKeyframe(neighbour, near, window * SNAP_FRAMES)
          }
          this.cutTime = await this.settle(clip, srcToTimeline(clip, target), dir)
          if (this.cutTime === before) break
        }
        await this.refreshKeyframes()
        if (this.soundOnStep) this.playAtCut()
      })
    },

    /** dir 1 = next keyframe, -1 = previous keyframe. */
    jumpKeyframe(dir: 1 | -1): Promise<void> {
      if (!this.isOpen) return Promise.resolve()
      return this.enqueue(async () => {
        const clip = this.clip
        const index = keyframes
        if (!clip || !index) return
        const cur = timelineToSrc(clip, this.cutTime)
        let key: Micros | null = null
        if (dir > 0) key = await index.after(cur + JUMP_EPSILON)
        else if (cur > JUMP_EPSILON) key = await index.before(cur - JUMP_EPSILON)
        if (key === null) return
        this.cutTime = await this.settle(clip, srcToTimeline(clip, key), dir)
        await this.refreshKeyframes()
      })
    },

    /** dir 1 = next pause, -1 = previous pause. Does nothing when the file has no sound or no pause lies that way. */
    jumpPause(dir: 1 | -1): Promise<void> {
      if (!this.isOpen || this.hasAudio !== true) return Promise.resolve()
      return this.enqueue(async () => {
        const clip = this.clip
        if (!clip) return
        const cur = timelineToSrc(clip, this.cutTime)
        const pause = nextPause(this.pauses, dir > 0 ? cur + JUMP_EPSILON : cur - JUMP_EPSILON, dir)
        if (!pause) return
        this.cutTime = await this.settle(clip, pauseJumpTarget(pause, clip), dir)
        await this.refreshKeyframes()
      })
    },

    /** Splits the clip at the cut as one undo step, puts the playhead there and closes the view. */
    cutHere(): Promise<boolean> {
      if (!this.isOpen) return Promise.resolve(false)
      let done = false
      return this.enqueue(async () => {
        const editor = useEditorStore()
        const project = editor.project
        const cut = this.cutTime
        const next = splitAt(project, cut, nextId(projectIds(project), 'clip-'))
        if (next === project) {
          this.error = 'cannot-cut'
          return
        }
        editor.commitProject(next)
        editor.setPlayhead(cut)
        done = true
        this.close()
      }).then(() => done)
    },

    setZoom(zoom: number): void {
      this.zoom = Math.min(Math.max(zoom, 0), 100)
    },

    setSnap(on: boolean): void {
      this.snapKeyframes = on
      writePrefs(on, this.soundOnStep)
    },

    setSound(on: boolean): void {
      this.soundOnStep = on
      writePrefs(this.snapKeyframes, on)
    },

    /** Waveform data of the open asset, or null while it is not computed. Read it when `waveformRevision` changes. */
    waveformData(): WaveData | null {
      return this.assetId ? (waves.get(this.assetId) ?? null) : null
    },

    startWaveform(assetId: string, file: File, gen: number): void {
      const cached = waves.get(assetId)
      if (cached) {
        this.hasAudio = cached.waveform !== null
        this.waveformRevision++
        return
      }
      const asset = useEditorStore().project.assets.find((a) => a.id === assetId)
      if (asset?.hasAudio === false) {
        waves.set(assetId, { waveform: null, pauses: [] })
        this.hasAudio = false
        this.waveformRevision++
        return
      }
      this.waveformLoading = true
      let job = waveJobs.get(assetId)
      if (!job) {
        job = computeWaveform(file, (p) => {
          if (this.assetId === assetId) this.waveformFraction = p.fraction
        })
          .then((waveform): WaveData => ({ waveform, pauses: waveform ? findPauses(waveform) : [] }))
          .catch((): WaveData => ({ waveform: null, pauses: [] }))
          .then((data) => {
            waves.set(assetId, data)
            waveJobs.delete(assetId)
            return data
          })
        waveJobs.set(assetId, job)
      }
      void job.then((data) => {
        this.waveformRevision++
        if (gen !== generation || this.assetId !== assetId) return
        this.hasAudio = data.waveform !== null
        this.waveformLoading = false
        this.waveformFraction = 1
      })
    },

    /** Runs the job after all earlier ones; a job from an older open or close is skipped. */
    enqueue(job: () => Promise<void>): Promise<void> {
      const gen = generation
      this.pendingJobs++
      const run = queue
        .then(async () => {
          if (gen !== generation) return
          try {
            await job()
          } catch {
            // A failed decode leaves the cut where it was.
          }
        })
        .finally(() => {
          this.pendingJobs--
        })
      queue = run
      return run
    },

    /** Frame span containing t. Falls back to the frame grid when the file cannot be decoded. */
    async frameAt(t: Micros): Promise<FrameSpan> {
      const at = Math.max(0, Math.round(t))
      const assetId = this.assetId
      if (assetId && getAssetFile(assetId)) {
        try {
          const info = await getFrameProvider().getFrameInfo(assetId, at, LANE)
          if (info && info.end > info.start) return info
        } catch {
          // Use the grid below.
        }
      }
      const index = frameIndexAt(at, this.fps)
      return { start: frameStart(index, this.fps), end: frameStart(index + 1, this.fps) }
    },

    /**
     * Turns a source time into a real frame start inside the clip's bounds and returns its timeline time.
     * dir 1 rounds up to the next frame start, -1 and 0 round down.
     */
    async settle(clip: Clip, target: Micros, dir: 1 | -1 | 0): Promise<Micros> {
      const tlFrame = Math.max(1, Math.round(frameDuration(this.fps) / clip.speed))
      const bounds = cutBounds(clip, tlFrame)
      if (!bounds) return clampCut(clip, target, tlFrame)
      const src = timelineToSrc(clip, clampCut(clip, target, tlFrame))
      const span = await this.frameAt(src)
      let s = dir > 0 && span.start < src - BOUNDARY_TOLERANCE ? span.end : span.start
      // Container timestamps are whole milliseconds, so a real first frame can start a fraction of a frame early.
      const lo = bounds.min - BOUNDARY_TOLERANCE
      const hi = bounds.max + BOUNDARY_TOLERANCE
      for (let i = 0; i < 3; i++) {
        const t = srcToTimeline(clip, s)
        if (t < lo) s = (await this.frameAt(s)).end
        else if (t > hi) s = (await this.frameAt(Math.max(0, s - frameDuration(this.fps) / 2))).start
        else return t
      }
      return clampCut(clip, srcToTimeline(clip, s), tlFrame)
    },

    async refreshKeyframes(): Promise<void> {
      const clip = this.clip
      const index = keyframes
      if (!clip || !index) {
        this.keyframeTimes = []
        return
      }
      const window = KEY_WINDOW_FRAMES * frameDuration(this.fps)
      const cur = timelineToSrc(clip, this.cutTime)
      this.keyframeTimes = await index.inRange(Math.max(0, cur - window), cur + window)
    },

    playAtCut(): void {
      const file = this.assetId ? getAssetFile(this.assetId) : undefined
      const clip = this.clip
      if (file && clip) playSnippet(file, timelineToSrc(clip, this.cutTime))
    }
  }
})
