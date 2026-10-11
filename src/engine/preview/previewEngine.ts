import { musicGain } from '../../core/audio/gain'
import { CURATED_FONTS, canvasFont } from '../../core/text/fonts'
import type { Clip, Project } from '../../core/project/types'
import { buildScene, planTimeline, type PlannedTimeline } from '../../core/render/scene'
import type { Micros } from '../../core/time'
import { ExactFrameProvider } from '../media/frames'
import { Compositor, type FrameSource } from '../render/compositor'
import { sceneFrames } from '../render/sceneFrames'

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

/** Longest side of the preview canvas until the real display size is known; the export always uses the full format size. */
const PREVIEW_MAX_SIDE = 1280
/** A media element further away from its wanted position than this is re-synchronised. */
const MAX_DRIFT_SECONDS = 0.2
/** The wall clock is trusted while it agrees with the media element this closely; beyond that the media wins. */
const RESYNC_TOLERANCE: Micros = 60_000
/** After this long without a picture the clock runs on regardless, so a broken file cannot freeze playback. */
const MAX_STALL_MS = 4000
/** A media element is not seeked again sooner than this after its last seek (avoids seek storms). */
const SEEK_COOLDOWN_MS = 600
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
  /** Picture-in-picture videos, by overlay id. Always muted: overlay sound is not mixed in. */
  private overlayEls = new Map<string, HTMLVideoElement>()
  private audioEls = new Map<string, HTMLAudioElement>()
  private time: Micros = 0
  private isPlaying = false
  private raf = 0
  private startWall = 0
  private startTime: Micros = 0
  private renderToken = 0
  private stallSince = 0
  private lastSeek = new WeakMap<HTMLMediaElement, number>()
  private targetSize: { width: number; height: number } | null = null
  private disposed = false
  private fontsReady: Promise<unknown>

  constructor(
    private canvas: HTMLCanvasElement,
    private getProvider: () => ExactFrameProvider,
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
    const pictureIds = new Set(project.overlays.filter((o) => o.kind === 'media').map((o) => o.id))
    for (const [id, el] of this.overlayEls) {
      if (!pictureIds.has(id)) this.releaseElement(el, this.overlayEls, id)
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
    for (const o of this.project?.overlays ?? []) {
      if (o.kind === 'media' && o.assetId === assetId) this.dropOverlayElement(o.id)
    }
    URL.revokeObjectURL(entry.url)
    entry.bitmap?.close()
    this.assets.delete(assetId)
  }

  /** Draws the current time again, e.g. after an asset became available. */
  refresh(): void {
    if (!this.isPlaying) void this.renderPaused()
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
    this.stallSince = 0
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
    for (const el of this.overlayEls.values()) el.pause()
    for (const el of this.audioEls.values()) el.pause()
    void this.renderPaused()
  }

  dispose(): void {
    this.disposed = true
    this.isPlaying = false
    cancelAnimationFrame(this.raf)
    this.renderToken++
    for (const [id, el] of this.videoEls) this.releaseElement(el, this.videoEls, id)
    for (const [id, el] of this.overlayEls) this.releaseElement(el, this.overlayEls, id)
    for (const [id, el] of this.audioEls) this.releaseElement(el, this.audioEls, id)
    for (const id of [...this.assets.keys()]) this.removeAsset(id)
    this.compositor.dispose()
  }

  // --- playing ---------------------------------------------------------------------------

  private tick = (now: number): void => {
    if (!this.isPlaying || this.disposed || !this.project) return
    let t = this.startTime + Math.round((now - this.startWall) * 1000)
    t = this.followMedia(t, now)
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
      const source = clip ? this.playbackFrame(clip, layer.srcTime, now) : null
      if (source) frames.set(layer.clipId, source)
      else complete = false
    }
    // A picture-in-picture that is not ready yet is simply left out for this frame.
    const activePictures = new Set<string>()
    for (const layer of scene.overlays) {
      if (layer.item.kind !== 'media') continue
      activePictures.add(layer.item.id)
      const source = this.pictureFrame(layer.item.id, layer.item.assetId, layer.srcTime, now)
      if (source) frames.set(layer.item.id, source)
    }
    for (const [id, el] of this.overlayEls) {
      if (!activePictures.has(id) && !el.paused) el.pause()
    }
    this.pauseInactive(activeClips)
    this.preloadUpcoming(t)
    this.syncMusic(t)
    // Keep the previous image on screen while an element is still seeking instead of flashing black.
    if (complete) this.compositor.draw(scene, frames)
    this.callbacks.onTime(t)
    this.raf = requestAnimationFrame(this.tick)
  }

  /**
   * The media element of the front video clip is the master clock: when its picture stalls (slow disk,
   * big file, decoder busy) the timeline waits instead of skipping ahead and then seeking back, which
   * caused stuttering and frozen pictures. Without a video clip (gaps, pictures, text only) the wall
   * clock runs on its own.
   */
  private followMedia(wallTime: Micros, now: number): Micros {
    if (!this.project) return wallTime
    const front = buildScene(this.project, this.planned, wallTime).videos.at(-1)
    const clip = front ? this.planned.clips.find((c) => c.id === front.clipId) : undefined
    const asset = clip ? this.assets.get(clip.assetId) : undefined
    const el = clip && asset && asset.kind === 'video' ? this.videoEls.get(clip.id) : undefined
    if (!clip || !el) {
      this.stallSince = 0
      return wallTime
    }
    // The wall clock may just have crossed into this clip: start its element now, otherwise the timeline
    // would wait for a picture that nobody asked for.
    this.driveElement(el, clip, front!.srcTime, now)
    const ready = !el.paused && !el.seeking && el.readyState >= 2
    if (ready) {
      this.stallSince = 0
      const mediaTime = clip.start + Math.round((el.currentTime * 1_000_000 - clip.srcIn) / clip.speed)
      if (Math.abs(mediaTime - wallTime) > RESYNC_TOLERANCE) {
        this.startWall = now
        this.startTime = mediaTime
        return mediaTime
      }
      return wallTime
    }
    if (!this.stallSince) this.stallSince = now
    if (now - this.stallSince < MAX_STALL_MS) {
      // Hold the clock where it was until the picture is there.
      this.startWall = now
      this.startTime = this.time
      return this.time
    }
    return wallTime
  }

  private playbackFrame(clip: Clip, srcTime: Micros, now: number): FrameSource | null {
    const asset = this.assets.get(clip.assetId)
    if (!asset) return null
    if (asset.kind === 'image') return asset.bitmap
    const el = this.videoElement(clip, asset)
    this.driveElement(el, clip, srcTime, now)
    return el.readyState >= 2 && !el.seeking ? el : null
  }

  /** Frame of a picture-in-picture item while playing: an image bitmap, or its muted video element when ready. */
  private pictureFrame(id: string, assetId: string, srcTime: Micros, now: number): FrameSource | null {
    const asset = this.assets.get(assetId)
    if (!asset) return null
    if (asset.kind === 'image') return asset.bitmap
    if (asset.kind !== 'video') return null
    let el = this.overlayEls.get(id)
    if (!el) {
      el = document.createElement('video')
      el.playsInline = true
      el.preload = 'auto'
      el.muted = true
      el.src = asset.url
      this.overlayEls.set(id, el)
    }
    this.driveMedia(el, srcTime, now, 1, true, 0)
    return el.readyState >= 2 && !el.seeking ? el : null
  }

  /** Makes a clip's element play at the right position and settings. Safe to call every frame. */
  private driveElement(el: HTMLVideoElement, clip: Clip, srcTime: Micros, now: number): void {
    this.driveMedia(el, srcTime, now, clip.speed, clip.muted, clamp01(clip.volume))
  }

  private driveMedia(el: HTMLVideoElement, srcTime: Micros, now: number, speed: number, muted: boolean, volume: number): void {
    const wanted = srcTime / 1_000_000
    if (el.playbackRate !== speed) el.playbackRate = speed
    el.muted = muted
    el.volume = volume
    const seekAllowed = now - (this.lastSeek.get(el) ?? -Infinity) > SEEK_COOLDOWN_MS
    if (el.paused) {
      if (Math.abs(el.currentTime - wanted) > 0.05) this.seekTo(el, wanted, now)
      void el.play().catch(() => undefined)
    } else if (seekAllowed && Math.abs(el.currentTime - wanted) > MAX_DRIFT_SECONDS) {
      this.seekTo(el, wanted, now)
    }
  }

  private seekTo(el: HTMLMediaElement, seconds: number, now: number): void {
    this.lastSeek.set(el, now)
    el.currentTime = seconds
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

  private dropOverlayElement(id: string): void {
    const el = this.overlayEls.get(id)
    if (el) this.releaseElement(el, this.overlayEls, id)
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
    this.stallSince = 0
    this.startWall = performance.now()
    this.startTime = this.time
    for (const el of this.overlayEls.values()) el.pause()
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
    const frames = await sceneFrames(scene, this.getProvider())
    if (token !== this.renderToken || this.disposed) return
    this.compositor.draw(scene, frames)
  }

  // --- helpers ---------------------------------------------------------------------------

  /**
   * Sets the size the preview should be drawn at, in device pixels (CSS size times devicePixelRatio).
   * Drawing at the displayed resolution keeps text and edges crisp on HiDPI screens; the project's own
   * output size is the upper limit.
   */
  setPreviewSize(width: number, height: number): void {
    if (!(width > 0) || !(height > 0)) return
    this.targetSize = { width, height }
    this.fitCanvas()
    if (!this.isPlaying) void this.renderPaused()
  }

  private fitCanvas(): void {
    if (!this.project) return
    const { width, height } = this.project.format
    let w = width
    let h = height
    if (this.targetSize) {
      const scale = Math.min(1, this.targetSize.width / width, this.targetSize.height / height)
      w = width * scale
      h = height * scale
    } else {
      const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height))
      w = width * scale
      h = height * scale
    }
    w = Math.max(2, Math.round(w))
    h = Math.max(2, Math.round(h))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.compositor.resize(w, h)
  }

  private async loadFonts(): Promise<void> {
    try {
      await Promise.all(CURATED_FONTS.map((f) => document.fonts.load(canvasFont(f.family, 32))))
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
