import { defineStore } from 'pinia'
import type { AudioCodec, VideoCodec } from 'mediabunny'
import { exportFileName } from '../../core/export/filename'
import { missingAssetsInUse, type AssetStatusMap } from '../../core/export/format'
import {
  applyFactors,
  estimateCodecOf,
  profileExport,
  totalSeconds,
  type ExportProfile,
  type FeatureClass,
  type PhaseSeconds,
  type TimeRange
} from '../../core/export/estimate'
import {
  calibrationFor,
  estimateRange,
  familyCalibrated,
  familyOf,
  learnRun,
  parseCalibration,
  updateCalibration,
  type Calibration,
  type CodecFamily
} from '../../core/export/calibration'
import {
  EXPORT_FPS,
  EXPORT_QUALITIES,
  EXPORT_RESOLUTIONS,
  GIF_DEFAULT_BYTES_PER_PIXEL,
  defaultExportOptions,
  defaultGifOptions,
  estimateFileSize,
  estimateGifBytes,
  gifOutputSize,
  gifTooLarge,
  learnGifBytesPerPixel,
  outputSize,
  totalFrames,
  videoBitrate,
  type ExportOptions,
  type GifOptions
} from '../../core/export/presets'
import type { Project } from '../../core/project/types'
import { planTimeline } from '../../core/render/scene'
import type { Micros } from '../../core/time'
import { checkEncoders, ExportCancelled, ExportUnsupported, projectDuration, type ExportProgress, type ExportResult } from '../../engine/export/exporter'
import { startExport, type RunningExport } from '../../engine/export/exportClient'
import { GifTooLarge as GifTooLargeError, type GifResult } from '../../engine/export/gifExporter'
import { FONT_SOURCES } from '../fontUrls'
import { getAssetFile, useMediaStore } from './media'
import { useEditorStore } from './editor'

export type ExportPhase = 'idle' | 'checking' | 'ready' | 'running' | 'done' | 'error' | 'cancelled'

/** A translation key with its parameters; the component translates it. */
export interface ExportMessage {
  key: string
  params: Record<string, string | number>
}

export interface EncoderInfo {
  video: VideoCodec | null
  audio: AudioCodec | null
}

export interface ExportResultInfo {
  size: number
  fileName: string
  extension: 'mp4' | 'gif'
  /** Measured wall time of the export, in milliseconds. */
  elapsedMs: number
  /** The estimate shown when the export started, in seconds. */
  estimatedSeconds: number
  /** Per phase: what was estimated and what was measured. Null for GIF, which has no phase timing. */
  estimatedPhases: PhaseSeconds | null
  measuredPhases: PhaseSeconds | null
  featureClass: FeatureClass
  /** 'file': written to the file the user picked. 'download': handed to the browser's download. */
  savedAs: 'file' | 'download'
  /** Share of the run the tab was hidden (browsers throttle hidden tabs). */
  hiddenShare: number
}

export type ExportFormat = 'mp4' | 'gif'

/** Learned for this computer from finished GIF exports: size per pixel and frame, and speed factor. */
export interface GifCalibration {
  bytesPerPixel: number | null
  speed: number | null
  /** GIF exports that taught the speed factor. */
  samples: number
}

/** The part of the store that the estimate depends on. */
interface EstimateState {
  format: ExportFormat
  options: ExportOptions
  gif: GifOptions
  encoders: EncoderInfo | null
  calibration: Calibration
  gifCalibration: GifCalibration
}

export interface Estimate {
  /** Uncalibrated work, by phase. */
  profile: ExportProfile
  family: CodecFamily
  featureClass: FeatureClass
  /** Work by phase after the learned factors: what is shown. */
  phases: PhaseSeconds
  seconds: number
  range: TimeRange
  /** Exports of this family and feature class that taught the factors. */
  samples: number
  /** A calibration exists for this codec family (the hint about it disappears). */
  calibrated: boolean
}

/** A run with more hidden time than this share is not learned from: the browser throttled it. */
const HIDDEN_SHARE_LIMIT = 0.1

/**
 * Follows the page's visibility while an export runs. Returns the stop function, which gives the hidden time
 * in milliseconds.
 */
function watchVisibility(onChange: (hidden: boolean) => void): () => number {
  // A tab that is already hidden counts from now on.
  let since: number | null = document.visibilityState === 'hidden' ? performance.now() : null
  let total = 0
  const handler = () => {
    const hidden = document.visibilityState === 'hidden'
    const now = performance.now()
    if (hidden && since === null) since = now
    if (!hidden && since !== null) {
      total += now - since
      since = null
    }
    onChange(hidden)
  }
  document.addEventListener('visibilitychange', handler)
  return () => {
    document.removeEventListener('visibilitychange', handler)
    return total + (since !== null ? performance.now() - since : 0)
  }
}

interface SaveHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>
}

const STORAGE_KEY = 'jellycut.export'
const CALIBRATION_KEY = 'jellycut.export.calibration'
const GIF_CALIBRATION_KEY = 'jellycut.export.gif'

// The file and the running export are large or not serialisable: they stay out of Pinia state.
let activeRun: RunningExport | null = null
let stopWatch: (() => number) | null = null
let resultBlob: Blob | null = null
/** Incremented on every encoder check, so only the latest answer is applied. */
let encoderCheck = 0

function pick<T>(list: readonly T[], value: unknown): T | undefined {
  return list.find((item) => item === value)
}

function readStoredOptions(): ExportOptions | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const resolution = pick(EXPORT_RESOLUTIONS, parsed.resolution)
    const fps = pick(EXPORT_FPS, parsed.fps)
    const quality = pick(EXPORT_QUALITIES, parsed.quality)
    if (resolution === undefined || fps === undefined || quality === undefined) return null
    return { resolution, fps, quality, format: 'mp4' }
  } catch {
    return null
  }
}

function writeStoredOptions(options: ExportOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // Without storage the options simply do not survive a reload.
  }
}

function usableFactor(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(10, Math.max(0.1, value)) : null
}

function readCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY)
    return parseCalibration(raw ? JSON.parse(raw) : null)
  } catch {
    return parseCalibration(null)
  }
}

function writeCalibration(calibration: Calibration): void {
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(calibration))
  } catch {
    // Without storage the correction only lasts for this session.
  }
}

function readGifCalibration(): GifCalibration {
  try {
    const raw = localStorage.getItem(GIF_CALIBRATION_KEY)
    const parsed = raw ? (JSON.parse(raw) as { bytesPerPixel?: unknown; speed?: unknown; samples?: unknown }) : {}
    const speed = usableFactor(parsed.speed)
    const samples = typeof parsed.samples === 'number' && Number.isInteger(parsed.samples) && parsed.samples > 0 ? parsed.samples : speed !== null ? 1 : 0
    return { bytesPerPixel: usableFactor(parsed.bytesPerPixel), speed, samples }
  } catch {
    return { bytesPerPixel: null, speed: null, samples: 0 }
  }
}

function writeGifCalibration(calibration: GifCalibration): void {
  try {
    localStorage.setItem(GIF_CALIBRATION_KEY, JSON.stringify(calibration))
  } catch {
    // Without storage the correction only lasts for this session.
  }
}

/** GIF size estimate: frames at the output size, with the learned or the default size per pixel. */
function gifBytesFor(project: Project, options: GifOptions, durationMicros: number, bytesPerPixel: number | null): number {
  const { width, height } = gifOutputSize(project.format.ratio, options.width)
  return estimateGifBytes(width, height, totalFrames(durationMicros, options.fps), bytesPerPixel ?? GIF_DEFAULT_BYTES_PER_PIXEL)
}

/** Too long or too large: the GIF is refused before it starts (same rule in the engine). */
function gifRefused(project: Project, options: GifOptions, durationMicros: number): boolean {
  const { width, height } = gifOutputSize(project.format.ratio, options.width)
  return gifTooLarge(durationMicros, width, height, options.fps)
}

function scale(phases: PhaseSeconds, factor: number): PhaseSeconds {
  return {
    decode: phases.decode * factor,
    draw: phases.draw * factor,
    encode: phases.encode * factor,
    audio: phases.audio * factor,
    fixed: phases.fixed * factor
  }
}

/** Estimate for the current settings: the uncalibrated work, and the same work after the learned factors. */
function estimateFor(state: EstimateState, project: Project, durationMicros: Micros): Estimate {
  const planned = planTimeline(project)
  if (state.format === 'gif') {
    const { width, height } = gifOutputSize(project.format.ratio, state.gif.width)
    const profile = profileExport({ project, planned, width, height, fps: state.gif.fps, durationMicros, kind: 'gif', codec: 'avc' })
    const phases = scale(profile.phases, state.gifCalibration.speed ?? 1)
    const seconds = totalSeconds(phases)
    return {
      profile,
      family: 'avc',
      featureClass: profile.featureClass,
      phases,
      seconds,
      range: estimateRange(seconds, state.gifCalibration.samples),
      samples: state.gifCalibration.samples,
      calibrated: state.gifCalibration.samples > 0
    }
  }
  const { width, height } = outputSize(project.format.ratio, state.options.resolution)
  const codec = estimateCodecOf(state.encoders?.video)
  const family = familyOf(codec)
  const profile = profileExport({ project, planned, width, height, fps: state.options.fps, durationMicros, kind: 'mp4', codec })
  const { factors, samples } = calibrationFor(state.calibration, family, profile.featureClass)
  const phases = applyFactors(profile.phases, factors)
  const seconds = totalSeconds(phases)
  return {
    profile,
    family,
    featureClass: profile.featureClass,
    phases,
    seconds,
    range: estimateRange(seconds, samples),
    samples,
    calibrated: familyCalibrated(state.calibration, family)
  }
}

function canPickFile(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
}

/** Asks where to save. Must be called straight from a click (user activation). */
function pickTarget(fileName: string, extension: 'mp4' | 'gif'): Promise<SaveHandle> {
  const picker = window as unknown as {
    showSaveFilePicker: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>
  }
  const type: { description: string; accept: Record<string, string[]> } =
    extension === 'gif' ? { description: 'GIF', accept: { 'image/gif': ['.gif'] } } : { description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }
  return picker.showSaveFilePicker({ suggestedName: fileName, types: [type] })
}

async function writeTo(handle: SaveHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    await writable.abort?.().catch(() => undefined)
    throw error
  }
}

/** Writes to the picked file, or downloads when there is none or the write fails. */
async function deliver(blob: Blob, fileName: string, handle: SaveHandle | null): Promise<{ savedAs: 'file' | 'download'; error: string | null }> {
  if (handle) {
    try {
      await writeTo(handle, blob)
      return { savedAs: 'file', error: null }
    } catch (error) {
      downloadBlob(blob, fileName)
      return { savedAs: 'download', error: errorMessage(error) }
    }
  }
  downloadBlob(blob, fileName)
  return { savedAs: 'download', error: null }
}

function statusMap(project: Project): AssetStatusMap {
  const media = useMediaStore()
  return Object.fromEntries(project.assets.map((asset) => [asset.id, media.statusOf(asset.id)]))
}

function missingInProject(project: Project): string[] {
  return missingAssetsInUse(project, statusMap(project))
}

function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const useExportStore = defineStore('export', {
  state: () => ({
    open: false,
    options: readStoredOptions() ?? defaultExportOptions(useEditorStore().project),
    format: 'mp4' as ExportFormat,
    gif: defaultGifOptions() as GifOptions,
    gifCalibration: readGifCalibration() as GifCalibration,
    phase: 'idle' as ExportPhase,
    progress: null as ExportProgress | null,
    result: null as ExportResultInfo | null,
    error: null as ExportMessage | null,
    /** A non-fatal problem after the export: the file could not be written and was downloaded instead. */
    notice: null as ExportMessage | null,
    /** Name of the file the running export will be written to; null when it will be downloaded. */
    runFileName: null as string | null,
    /** The tab is in the background right now: the export runs slower and the dialog says so. */
    hiddenNow: false,
    encoders: null as EncoderInfo | null,
    inWorker: false,
    /** The save dialog is open; nothing else may start meanwhile. */
    picking: false,
    calibration: readCalibration() as Calibration
  }),
  getters: {
    /** Estimated file size for the active format and the project length. */
    estimatedBytes(state): number {
      const editor = useEditorStore()
      if (state.format === 'gif') return gifBytesFor(editor.project, state.gif, editor.totalDuration, state.gifCalibration.bytesPerPixel)
      return estimateFileSize(state.options, editor.project.format.ratio, editor.totalDuration)
    },
    /** Estimate of the export time for the current settings, with the learned factors applied. */
    estimate(state): Estimate {
      const editor = useEditorStore()
      return estimateFor(state, editor.project, editor.totalDuration)
    },
    /** Expected export time in seconds (the middle of the range). */
    estimatedSeconds(state): number {
      const editor = useEditorStore()
      return estimateFor(state, editor.project, editor.totalDuration).seconds
    },
    /** Expected export time without any learned factor, for comparison. */
    uncalibratedSeconds(state): number {
      const editor = useEditorStore()
      return totalSeconds(estimateFor(state, editor.project, editor.totalDuration).profile.phases)
    },
    /** A GIF that is too long or too large: the dialog warns and Start stays disabled. */
    gifTooBig(state): boolean {
      const editor = useEditorStore()
      return state.format === 'gif' && gifRefused(editor.project, state.gif, editor.totalDuration)
    },
    missingNames(): string[] {
      return missingInProject(useEditorStore().project)
    },
    canStart(state): boolean {
      const editor = useEditorStore()
      if (state.phase !== 'ready' || state.picking || editor.totalDuration <= 0 || missingInProject(editor.project).length > 0) return false
      if (state.format === 'gif') return !gifRefused(editor.project, state.gif, editor.totalDuration)
      return state.encoders?.video != null
    }
  },
  actions: {
    async show(): Promise<void> {
      if (this.phase === 'running') return
      this.open = true
      this.progress = null
      this.result = null
      this.error = null
      this.notice = null
      resultBlob = null
      await this.refreshEncoders()
    },

    /** Closing is not possible while an export runs or the save dialog is open; Cancel is the way out of a run. */
    close(): void {
      if (this.phase === 'running' || this.picking) return
      this.open = false
      this.phase = 'idle'
      this.progress = null
      this.result = null
      this.error = null
      this.notice = null
      this.encoders = null
      resultBlob = null
      encoderCheck++
    },

    setOptions(patch: Partial<ExportOptions>): void {
      if (this.phase !== 'ready' && this.phase !== 'checking') return
      this.options = { ...this.options, ...patch }
      writeStoredOptions(this.options)
      void this.refreshEncoders()
    },

    setFormat(format: ExportFormat): void {
      if (this.phase !== 'ready' && this.phase !== 'checking') return
      if (this.format === format) return
      this.format = format
      void this.refreshEncoders()
    },

    setGifOptions(patch: Partial<Omit<GifOptions, 'format'>>): void {
      if (this.phase !== 'ready' && this.phase !== 'checking') return
      this.gif = { ...this.gif, ...patch }
    },

    /** Asks the browser which codecs can encode the current size, bitrate and frame rate. */
    async refreshEncoders(): Promise<void> {
      const id = ++encoderCheck
      this.phase = 'checking'
      const editor = useEditorStore()
      let encoders: EncoderInfo
      try {
        const { width, height } = outputSize(editor.project.format.ratio, this.options.resolution)
        const bitrate = videoBitrate(width, height, this.options.fps, this.options.quality)
        const found = await checkEncoders(width, height, bitrate)
        encoders = { video: found.video, audio: found.audio }
      } catch {
        encoders = { video: null, audio: null }
      }
      if (id !== encoderCheck) return
      this.encoders = encoders
      this.phase = 'ready'
    },

    fail(error: ExportMessage, phase: ExportPhase = 'error'): void {
      this.error = error
      this.phase = phase
    },

    /**
     * Starts the export. Where the browser can show a save dialog, the file is chosen first and written when
     * the export is done; otherwise the finished file is downloaded automatically.
     */
    async start(): Promise<void> {
      if (this.phase !== 'ready' || activeRun !== null || this.picking) return
      const isGif = this.format === 'gif'
      if (!isGif && this.encoders?.video == null) return
      const editor = useEditorStore()
      const project = editor.project
      if (projectDuration(project) <= 0) {
        this.fail({ key: 'export.errors.empty', params: {} })
        return
      }
      const missing = missingInProject(project)
      if (missing.length > 0) {
        this.fail({ key: 'export.errors.missing', params: { names: missing.join(', ') } })
        return
      }
      if (isGif && gifRefused(project, this.gif, editor.totalDuration)) {
        this.fail({ key: 'export.errors.gifTooLarge', params: {} })
        return
      }

      const extension = isGif ? 'gif' : 'mp4'
      const fileName = exportFileName(project.name, extension)
      // Called before any other await, so the browser still sees the click.
      let handle: SaveHandle | null = null
      if (canPickFile()) {
        this.picking = true
        try {
          handle = await pickTarget(fileName, extension)
        } catch (error) {
          // Cancelled: nothing has started, the dialog stays as it was.
          if (isAbort(error)) return
          // Not allowed here (no user activation, blocked): the file is downloaded at the end instead.
        } finally {
          this.picking = false
        }
      }

      const files: Record<string, File> = {}
      for (const asset of project.assets) {
        const file = getAssetFile(asset.id)
        if (file) files[asset.id] = file
      }
      // Uncalibrated work of this run: the learned factors are measured against the default rates.
      const estimate = this.estimate
      const uncalibrated = estimate.profile.phases
      const shownSeconds = estimate.seconds
      const shownPhases = estimate.phases
      const family = estimate.family
      const featureClass = estimate.featureClass
      // The state is reactive (Proxy objects cannot be posted to a worker), so the worker gets a plain copy.
      const snapshot = JSON.parse(JSON.stringify(project)) as Project

      this.progress = null
      this.error = null
      this.notice = null
      this.runFileName = handle ? fileName : null
      this.phase = 'running'
      try {
        const onProgress = (progress: ExportProgress) => {
          this.progress = progress
        }
        const run = isGif
          ? startExport({ kind: 'gif', project: snapshot, files, options: { ...this.gif } }, FONT_SOURCES, onProgress)
          : startExport({ project: snapshot, files, options: { ...this.options } }, FONT_SOURCES, onProgress)
        activeRun = run
        this.inWorker = run.inWorker
        run.setHidden(document.visibilityState === 'hidden')
        this.hiddenNow = document.visibilityState === 'hidden'
        stopWatch = watchVisibility((hidden) => {
          this.hiddenNow = hidden
          activeRun?.setHidden(hidden)
        })
        const result: ExportResult | GifResult = await run.promise
        const hiddenMs = stopWatch()
        stopWatch = null
        resultBlob = result.blob
        const info: ExportResultInfo = {
          size: result.blob.size,
          fileName,
          extension,
          elapsedMs: result.elapsedMs,
          estimatedSeconds: shownSeconds,
          estimatedPhases: isGif ? null : shownPhases,
          measuredPhases: isGif ? null : (result as ExportResult).phases,
          featureClass,
          savedAs: handle ? 'file' : 'download',
          hiddenShare: result.elapsedMs > 0 ? Math.min(1, hiddenMs / result.elapsedMs) : 0
        }
        this.result = info
        this.phase = 'done'
        const delivery = await deliver(result.blob, fileName, handle)
        this.result = { ...info, savedAs: delivery.savedAs }
        this.notice = delivery.error ? { key: 'export2.errors.writeFailed', params: { message: delivery.error } } : null

        if (info.hiddenShare > HIDDEN_SHARE_LIMIT) {
          // Throttled by the browser for too long: the timing says nothing about this computer.
        } else if (isGif) {
          const { width, height } = gifOutputSize(project.format.ratio, this.gif.width)
          this.learnGifCalibration(result.blob.size, totalSeconds(uncalibrated), result.elapsedMs, width, height, totalFrames(editor.totalDuration, this.gif.fps))
        } else {
          this.learnCalibration(family, featureClass, uncalibrated, (result as ExportResult).phases)
        }
      } catch (error) {
        if (error instanceof ExportCancelled) this.phase = 'cancelled'
        else if (error instanceof ExportUnsupported) this.fail({ key: 'export.errors.unsupported', params: {} })
        else if (error instanceof GifTooLargeError) this.fail({ key: 'export.errors.gifTooLarge', params: {} })
        else this.fail({ key: 'export.errors.failed', params: { message: errorMessage(error) } })
      } finally {
        stopWatch?.()
        stopWatch = null
        this.hiddenNow = false
        activeRun = null
        this.runFileName = null
      }
    },

    cancel(): void {
      if (this.phase === 'running') activeRun?.cancel()
    },

    /** Takes one finished MP4 export as a sample for its codec family and feature class. */
    learnCalibration(family: CodecFamily, cls: FeatureClass, uncalibrated: PhaseSeconds, measured: PhaseSeconds): void {
      const next = learnRun(this.calibration, family, cls, uncalibrated, measured)
      if (next === this.calibration) return
      this.calibration = next
      writeCalibration(next)
    },

    /** Takes one finished GIF as a sample of its size per pixel and frame and of this computer's speed. */
    learnGifCalibration(bytes: number, predictedSeconds: number, elapsedMs: number, width: number, height: number, frames: number): void {
      const speed = updateCalibration(this.gifCalibration.speed, predictedSeconds, elapsedMs / 1000)
      const next: GifCalibration = {
        bytesPerPixel: learnGifBytesPerPixel(this.gifCalibration.bytesPerPixel, bytes, width, height, frames),
        speed,
        samples: speed !== this.gifCalibration.speed ? this.gifCalibration.samples + 1 : this.gifCalibration.samples
      }
      this.gifCalibration = next
      writeGifCalibration(next)
    },

    /** Offers the finished file again: a save dialog where the browser has one, else a download. */
    async save(): Promise<void> {
      const blob = resultBlob
      const info = this.result
      if (!blob || !info) return
      // Called straight from the click, before any await, so the browser still sees the user gesture.
      let handle: SaveHandle | null = null
      if (canPickFile()) {
        try {
          handle = await pickTarget(info.fileName, info.extension)
        } catch (error) {
          if (isAbort(error)) return
        }
      }
      const delivery = await deliver(blob, info.fileName, handle)
      this.result = { ...info, savedAs: delivery.savedAs }
      this.notice = delivery.error ? { key: 'export2.errors.writeFailed', params: { message: delivery.error } } : null
    },

    /** Back to the settings, from the error, cancelled or done state. */
    reset(): void {
      if (this.phase === 'running' || this.picking) return
      resultBlob = null
      this.result = null
      this.error = null
      this.notice = null
      this.progress = null
      this.phase = 'ready'
    }
  }
})
