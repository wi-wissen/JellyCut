import { musicGain } from '../../core/audio/gain'
import type { Clip, Project } from '../../core/project/types'
import { buildScene, planTimeline, type PlannedTimeline } from '../../core/render/scene'
import type { Micros } from '../../core/time'
import { ExactFrameProvider } from '../media/frames'
import { Compositor, type FrameSource } from '../render/compositor'

export interface PreviewCallbacks {
  /** Called on every played frame and after every seek with the current time. */
  onTime(t: Micros): void
  /** Called when playback reached the end and stopped. */
  onEnded(): void
}

interface AssetEntry {
  url: string
  kind: 'video' | 'audio' | 'image'
  bitmap: ImageBitmap | null
}

/** Longest side of the preview canvas in pixels; the export always uses the full format size. */
const PREVIEW_MAX_SIDE = 1280
/** A media element further away from its wanted position than this is re-synchronised. */
const MAX_DRIFT_SECONDS = 0.2
/** Elements of clips starting within this window are prepared in advance (no stall at the cut). */
const PRELOAD_WINDOW: Micros = 1_500_000

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Drives the preview canvas. Playing uses <video>/<audio> elements (hardware decoding, sound),
 * paused frames and single steps use frame-exact WebCodecs decoding. Both paths draw through the
 * same Compositor and the same Scene as the export.
 */
export class PreviewEngine {
  private compositor: Compositor
  private project: Project | null = null
  private planned: PlannedTimeline = { clips: [], transitions: [], duration: 0, shortenedBy: 0 }
  private assets = new Map<string, AssetEntry>()
  private videoEls = new Map<string, HTMLVideoElement>()
  private audioEls = new Map<string, HTMLAudioElement>()
  private time: Micros = 0
  private isPlaying = false
  private raf = 0
  private startWall = 0
  private startTime: Micros = 0
  private renderToken = 0
  private disposed = false
  private fontsReady: Promise<unknown>

  constructor(
    private canvas: HTMLCanvasElement,
    private provider: ExactFrameProvider,
    private callbacks: PreviewCallbacks
  ) {
    this.compositor = new Compositor(canvas)
    this.fontsReady = this.loadFonts()
  }

  get playing(): boolean {
    return this.isPlaying
  }

  get currentTime(): Micros {
    return this.time
  }

  /** Total length including texts and music, which may outlast the last video clip. */
  get duration(): Micros {
    const p = this.project
    if (!p) return 0
    const textEnd = p.texts.reduce((end, t) => Math.max(end, t.start + t.duration), 0)
    const musicEnd = p.music.reduce((end, m) => Math.max(end, m.start + (m.srcOut - m.srcIn)), 0)
    return Math.max(this.planned.duration, textEnd, musicEnd)
  }

  setProject(project: Project): void {
    this.project = project
    this.planned = planTimeline(project)
    this.fitCanvas()
    // Drop elements of clips that no longer exist.
    const clipIds = new Set(project.clips.map((c) => c.id))
    for (const [id, el] of this.videoEls) {
      if (!clipIds.has(id)) this.releaseElement(el, this.videoEls, id)
    }
    const musicIds = new Set(project.music.map((m) => m.id))
    for (const [id, el] of this.audioEls) {
      if (!musicIds.has(id)) this.releaseElement(el, this.audioEls, id)
    }
    if (this.time > this.duration) this.time = this.duration
    if (this.isPlaying) this.resync()
    else void this.renderPaused()
  }

  setAssetFile(assetId: string, file: File, kind: 'video' | 'audio' | 'image'): void {
    this.removeAsset(assetId)
    const entry: AssetEntry = { url: URL.createObjectURL(file), kind, bitmap: null }
    this.assets.set(assetId, entry)
    if (kind === 'image') {
      void createImageBitmap(file).then((bitmap) => {
        if (this.disposed || this.assets.get(assetId) !== entry) bitmap.close()
        else entry.bitmap = bitmap
      })
    }
  }

  removeAsset(assetId: string): void {
    const entry = this.assets.get(assetId)
    if (!entry) return
    for (const clip of this.project?.clips ?? []) {
      if (clip.assetId === assetId) this.dropClipElement(clip.id)
    }
    for (const m of this.project?.music ?? []) {
      if (m.assetId === assetId) this.dropMusicElement(m.id)
    }
    URL.revokeObjectURL(entry.url)
    entry.bitmap?.close()
    this.assets.delete(assetId)
  }

  /** Shows the frame at `t` (paused). Resolves when the frame is on the canvas. */
  async seek(t: Micros): Promise<void> {
    this.time = Math.max(0, Math.min(t, this.duration))
    if (this.isPlaying) {
      this.resync()
      return
    }
    this.callbacks.onTime(this.time)
    await this.renderPaused()
  }

  play(): void {
    if (this.isPlaying || this.disposed) return
    if (this.time >= this.duration) this.time = 0
    this.isPlaying = true
    this.startWall = performance.now()
    this.startTime = this.time
    this.renderToken++
    this.raf = requestAnimationFrame(this.tick)
  }

  pause(): void {
    if (!this.isPlaying) return
    this.isPlaying = false
    cancelAnimationFrame(this.raf)
    for (const el of this.videoEls.values()) el.pause()
    for (const el of this.audioEls.values()) el.pause()
    void this.renderPaused()
  }

  dispose(): void {
    this.disposed = true
    this.isPlaying = false
    cancelAnimationFrame(this.raf)
    this.renderToken++
    for (const [id, el] of this.videoEls) this.releaseElement(el, this.videoEls, id)
    for (const [id, el] of this.audioEls) this.releaseElement(el, this.audioEls, id)
    for (const id of [...this.assets.keys()]) this.removeAsset(id)
    this.compositor.dispose()
  }

  // --- playing ---------------------------------------------------------------------------

  private tick = (now: number): void => {
    if (!this.isPlaying || this.disposed || !this.project) return
    const t = this.startTime + Math.round((now - this.startWall) * 1000)
    if (t >= this.duration) {
      this.time = this.duration
      this.isPlaying = false
      for (const el of this.videoEls.values()) el.pause()
      for (const el of this.audioEls.values()) el.pause()
      this.callbacks.onTime(this.time)
      void this.renderPaused()
      this.callbacks.onEnded()
      return
    }
    this.time = t
    const scene = buildScene(this.project, this.planned, t)
    const frames = new Map<string, FrameSource>()
    let complete = true
    const activeClips = new Set<string>()
    for (const layer of scene.videos) {
      activeClips.add(layer.clipId)
      const clip = this.planned.clips.find((c) => c.id === layer.clipId)
      const source = clip ? this.playbackFrame(clip, layer.srcTime) : null
      if (source) frames.set(layer.clipId, source)
      else complete = false
    }
    this.pauseInactive(activeClips)
    this.preloadUpcoming(t)
    this.syncMusic(t)
    // Keep the previous image on screen while an element is still seeking instead of flashing black.
    if (complete) this.compositor.draw(scene, frames)
    this.callbacks.onTime(t)
    this.raf = requestAnimationFrame(this.tick)
  }

  private playbackFrame(clip: Clip, srcTime: Micros): FrameSource | null {
    const asset = this.assets.get(clip.assetId)
    if (!asset) return null
    if (asset.kind === 'image') return asset.bitmap
    const el = this.videoElement(clip, asset)
    const wanted = srcTime / 1_000_000
    el.playbackRate = clip.speed
    el.muted = clip.muted
    el.volume = clamp01(clip.volume)
    if (el.paused) {
      if (Math.abs(el.currentTime - wanted) > 0.05) el.currentTime = wanted
      void el.play().catch(() => undefined)
    } else if (Math.abs(el.currentTime - wanted) > MAX_DRIFT_SECONDS) {
      el.currentTime = wanted
    }
    return el.readyState >= 2 && !el.seeking ? el : null
  }

  private videoElement(clip: Clip, asset: AssetEntry): HTMLVideoElement {
    let el = this.videoEls.get(clip.id)
    if (!el) {
      el = document.createElement('video')
      el.playsInline = true
      el.preload = 'auto'
      el.src = asset.url
      this.videoEls.set(clip.id, el)
    }
    return el
  }

  private pauseInactive(active: Set<string>): void {
    for (const [id, el] of this.videoEls) {
      if (!active.has(id) && !el.paused) el.pause()
    }
  }

  private preloadUpcoming(t: Micros): void {
    for (const clip of this.planned.clips) {
      if (clip.start <= t || clip.start - t > PRELOAD_WINDOW) continue
      const asset = this.assets.get(clip.assetId)
      if (!asset || asset.kind !== 'video') continue
      const el = this.videoElement(clip, asset)
      if (el.paused && Math.abs(el.currentTime - clip.srcIn / 1_000_000) > 0.05) {
        el.currentTime = clip.srcIn / 1_000_000
      }
    }
  }

  private syncMusic(t: Micros): void {
    if (!this.project) return
    for (const item of this.project.music) {
      const asset = this.assets.get(item.assetId)
      const length = item.srcOut - item.srcIn
      const active = !!asset && t >= item.start && t < item.start + length
      let el = this.audioEls.get(item.id)
      if (!active || !asset) {
        if (el && !el.paused) el.pause()
        continue
      }
      if (!el) {
        el = document.createElement('audio')
        el.preload = 'auto'
        el.src = asset.url
        this.audioEls.set(item.id, el)
      }
      const wanted = (item.srcIn + (t - item.start)) / 1_000_000
      el.volume = clamp01(musicGain(item, t))
      if (el.paused) {
        el.currentTime = wanted
        void el.play().catch(() => undefined)
      } else if (Math.abs(el.currentTime - wanted) > MAX_DRIFT_SECONDS) {
        el.currentTime = wanted
      }
    }
  }

  /** Re-anchors the clock and the media elements after a seek or project change while playing. */
  private resync(): void {
    this.startWall = performance.now()
    this.startTime = this.time
    for (const el of this.videoEls.values()) el.pause()
    for (const el of this.audioEls.values()) el.pause()
  }

  // --- paused / exact --------------------------------------------------------------------

  private async renderPaused(): Promise<void> {
    if (!this.project || this.disposed) return
    const token = ++this.renderToken
    await this.fontsReady
    const project = this.project
    const scene = buildScene(project, this.planned, this.time)
    const frames = new Map<string, FrameSource>()
    for (const [lane, layer] of scene.videos.entries()) {
      const frame = await this.provider.getFrame(layer.assetId, layer.srcTime, String(lane))
      if (token !== this.renderToken || this.disposed) return
      if (frame) frames.set(layer.clipId, frame)
    }
    this.compositor.draw(scene, frames)
  }

  // --- helpers ---------------------------------------------------------------------------

  private fitCanvas(): void {
    if (!this.project) return
    const { width, height } = this.project.format
    const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height))
    const w = Math.max(2, Math.round(width * scale))
    const h = Math.max(2, Math.round(height * scale))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.compositor.resize(w, h)
  }

  private async loadFonts(): Promise<void> {
    try {
      await Promise.all(['400', '600', '700'].map((w) => document.fonts.load(`${w} 32px Sora`)))
    } catch {
      // Text falls back to the system font; nothing else depends on it.
    }
  }

  private dropClipElement(clipId: string): void {
    const el = this.videoEls.get(clipId)
    if (el) this.releaseElement(el, this.videoEls, clipId)
  }

  private dropMusicElement(id: string): void {
    const el = this.audioEls.get(id)
    if (el) this.releaseElement(el, this.audioEls, id)
  }

  private releaseElement<T extends HTMLMediaElement>(el: T, map: Map<string, T>, id: string): void {
    el.pause()
    el.removeAttribute('src')
    el.load()
    map.delete(id)
  }
}
