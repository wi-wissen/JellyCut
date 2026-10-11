import { defineStore } from 'pinia'
import type { AudioCodec, VideoCodec } from 'mediabunny'
import { exportFileName } from '../../core/export/filename'
import { missingAssetsInUse, type AssetStatusMap } from '../../core/export/format'
import {
  estimateExportSeconds,
  estimateGifSeconds,
  sourceDecodeLoad,
  updateCalibration,
  type EstimateCodec
} from '../../core/export/estimate'
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
import { checkEncoders, ExportCancelled, ExportUnsupported, type ExportProgress, type ExportResult } from '../../engine/export/exporter'
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
}

export type ExportFormat = 'mp4' | 'gif'

/** Learned for this computer from finished GIF exports: size per pixel and frame, and speed factor. */
export interface GifCalibration {
  bytesPerPixel: number | null
  speed: number | null
}

const STORAGE_KEY = 'jellycut.export'
const CALIBRATION_KEY = 'jellycut.export.calibration'
const GIF_CALIBRATION_KEY = 'jellycut.export.gif'

/** AVC is the measured hardware path; VP9 and AV1 are software encoders with their own correction. */
export type CodecFamily = 'avc' | 'software'
export type Calibration = Record<CodecFamily, number | null>
const MIN_FACTOR = 0.1
const MAX_FACTOR = 10

// The file and the running export are large or not serialisable: they stay out of Pinia state.
let activeRun: RunningExport | null = null
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
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, value)) : null
}

function readCalibration(): Calibration {
  const empty: Calibration = { avc: null, software: null }
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as { avc?: unknown; software?: unknown }
    return { avc: usableFactor(parsed.avc), software: usableFactor(parsed.software) }
  } catch {
    return empty
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
  const empty: GifCalibration = { bytesPerPixel: null, speed: null }
  try {
    const raw = localStorage.getItem(GIF_CALIBRATION_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as { bytesPerPixel?: unknown; speed?: unknown }
    return { bytesPerPixel: usableFactor(parsed.bytesPerPixel), speed: usableFactor(parsed.speed) }
  } catch {
    return empty
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

/** Expected GIF time without the learned speed factor. */
function gifPredictSeconds(project: Project, options: GifOptions, durationMicros: number, calibration = 1): number {
  const { width, height } = gifOutputSize(project.format.ratio, options.width)
  return estimateGifSeconds({
    width,
    height,
    fps: options.fps,
    durationMicros,
    decodeMegapixels: sourceDecodeLoad(project),
    calibration
  })
}

/** Too long or too large: the GIF is refused before it starts (same rule in the engine). */
function gifRefused(project: Project, options: GifOptions, durationMicros: number): boolean {
  const { width, height } = gifOutputSize(project.format.ratio, options.width)
  return gifTooLarge(durationMicros, width, height, options.fps)
}

function familyOf(codec: string | null | undefined): CodecFamily {
  return codec === 'avc' || codec == null ? 'avc' : 'software'
}

function estimateCodecOf(video: string | null | undefined): EstimateCodec {
  return video === 'vp9' || video === 'av1' ? video : 'avc'
}

/** Expected export time for the project and options, without the learned correction. */
function predictSeconds(project: Project, options: ExportOptions, codec: EstimateCodec, durationMicros: number): number {
  const { width, height } = outputSize(project.format.ratio, options.resolution)
  return estimateExportSeconds({
    width,
    height,
    fps: options.fps,
    durationMicros,
    decodeMegapixels: sourceDecodeLoad(project),
    codec
  })
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

interface FilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>
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
    encoders: null as EncoderInfo | null,
    inWorker: false,
    calibration: readCalibration() as Calibration
  }),
  getters: {
    /** Estimated file size for the active format and the project length. */
    estimatedBytes(state): number {
      const editor = useEditorStore()
      if (state.format === 'gif') return gifBytesFor(editor.project, state.gif, editor.totalDuration, state.gifCalibration.bytesPerPixel)
      return estimateFileSize(state.options, editor.project.format.ratio, editor.totalDuration)
    },
    /** Expected export time without the correction learned on this computer. */
    uncalibratedSeconds(state): number {
      const editor = useEditorStore()
      if (state.format === 'gif') return gifPredictSeconds(editor.project, state.gif, editor.totalDuration)
      return predictSeconds(editor.project, state.options, estimateCodecOf(state.encoders?.video), editor.totalDuration)
    },
    /** Expected export time in seconds, corrected by the factor learned from earlier exports on this computer. */
    estimatedSeconds(state): number {
      const editor = useEditorStore()
      if (state.format === 'gif') {
        return gifPredictSeconds(editor.project, state.gif, editor.totalDuration) * (state.gifCalibration.speed ?? 1)
      }
      const factor = state.calibration[familyOf(state.encoders?.video)] ?? 1
      return predictSeconds(editor.project, state.options, estimateCodecOf(state.encoders?.video), editor.totalDuration) * factor
    },
    /** False until one export on this computer has taught the estimate its speed. */
    hasCalibration(state): boolean {
      if (state.format === 'gif') return state.gifCalibration.speed !== null || state.gifCalibration.bytesPerPixel !== null
      return state.calibration[familyOf(state.encoders?.video)] !== null
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
      if (state.phase !== 'ready' || editor.totalDuration <= 0 || missingInProject(editor.project).length > 0) return false
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
      resultBlob = null
      await this.refreshEncoders()
    },

    /** Closing is not possible while an export runs; the Cancel button is the way out. */
    close(): void {
      if (this.phase === 'running') return
      this.open = false
      this.phase = 'idle'
      this.progress = null
      this.result = null
      this.error = null
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

    async start(): Promise<void> {
      if (this.phase !== 'ready' || activeRun !== null) return
      const isGif = this.format === 'gif'
      if (!isGif && this.encoders?.video == null) return
      const editor = useEditorStore()
      const project = editor.project
      if (editor.totalDuration <= 0) {
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

      const files: Record<string, File> = {}
      for (const asset of project.assets) {
        const file = getAssetFile(asset.id)
        if (file) files[asset.id] = file
      }
      const fileName = exportFileName(project.name, isGif ? 'gif' : 'mp4')
      // Uncorrected prediction for this run, so the learned factor is measured against the default rates.
      const predicted = isGif
        ? gifPredictSeconds(project, this.gif, editor.totalDuration)
        : predictSeconds(project, this.options, estimateCodecOf(this.encoders?.video), editor.totalDuration)
      // The state is reactive (Proxy objects cannot be posted to a worker), so the worker gets a plain copy.
      const snapshot = JSON.parse(JSON.stringify(project)) as Project

      this.progress = null
      this.error = null
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
        const result: ExportResult | GifResult = await run.promise
        resultBlob = result.blob
        this.result = { size: result.blob.size, fileName, extension: isGif ? 'gif' : 'mp4' }
        this.phase = 'done'
        if (isGif) {
          const { width, height } = gifOutputSize(project.format.ratio, this.gif.width)
          this.learnGifCalibration(result.blob.size, predicted, result.elapsedMs, width, height, totalFrames(editor.totalDuration, this.gif.fps))
        } else {
          this.learnCalibration((result as ExportResult).videoCodec, predicted, result.elapsedMs)
        }
      } catch (error) {
        if (error instanceof ExportCancelled) this.phase = 'cancelled'
        else if (error instanceof ExportUnsupported) this.fail({ key: 'export.errors.unsupported', params: {} })
        else if (error instanceof GifTooLargeError) this.fail({ key: 'export.errors.gifTooLarge', params: {} })
        else this.fail({ key: 'export.errors.failed', params: { message: errorMessage(error) } })
      } finally {
        activeRun = null
      }
    },

    cancel(): void {
      if (this.phase === 'running') activeRun?.cancel()
    },

    /** Takes one finished export as a sample of this computer's speed for its codec family. */
    learnCalibration(codec: string, predictedSeconds: number, elapsedMs: number): void {
      const family = familyOf(codec)
      const next = updateCalibration(this.calibration[family], predictedSeconds, elapsedMs / 1000)
      if (next === this.calibration[family]) return
      this.calibration = { ...this.calibration, [family]: next }
      writeCalibration(this.calibration)
    },

    /** Takes one finished GIF as a sample of its size per pixel and frame and of this computer's speed. */
    learnGifCalibration(bytes: number, predictedSeconds: number, elapsedMs: number, width: number, height: number, frames: number): void {
      const next: GifCalibration = {
        bytesPerPixel: learnGifBytesPerPixel(this.gifCalibration.bytesPerPixel, bytes, width, height, frames),
        speed: updateCalibration(this.gifCalibration.speed, predictedSeconds, elapsedMs / 1000)
      }
      this.gifCalibration = next
      writeGifCalibration(next)
    },

    /** Offers the finished file: a save dialog where the browser has one, else a download. */
    async save(): Promise<void> {
      const blob = resultBlob
      const info = this.result
      if (!blob || !info) return
      // Called straight from the click, before any await, so the browser still sees the user gesture.
      const picker = window as unknown as FilePickerWindow
      if (typeof picker.showSaveFilePicker === 'function') {
        try {
          const type: { description: string; accept: Record<string, string[]> } =
            info.extension === 'gif'
              ? { description: 'GIF', accept: { 'image/gif': ['.gif'] } }
              : { description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }
          const handle = await picker.showSaveFilePicker({ suggestedName: info.fileName, types: [type] })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          return
        } catch (error) {
          if (isAbort(error)) return
        }
      }
      downloadBlob(blob, info.fileName)
    },

    /** Back to the settings, from the error, cancelled or done state. */
    reset(): void {
      if (this.phase === 'running') return
      resultBlob = null
      this.result = null
      this.error = null
      this.progress = null
      this.phase = 'ready'
    }
  }
})
