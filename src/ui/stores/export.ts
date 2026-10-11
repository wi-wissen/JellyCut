import { defineStore } from 'pinia'
import type { AudioCodec, VideoCodec } from 'mediabunny'
import { exportFileName } from '../../core/export/filename'
import { missingAssetsInUse, type AssetStatusMap } from '../../core/export/format'
import {
  EXPORT_FPS,
  EXPORT_QUALITIES,
  EXPORT_RESOLUTIONS,
  defaultExportOptions,
  estimateFileSize,
  outputSize,
  videoBitrate,
  type ExportOptions
} from '../../core/export/presets'
import type { Project } from '../../core/project/types'
import { checkEncoders, ExportCancelled, ExportUnsupported, type ExportProgress } from '../../engine/export/exporter'
import { startExport, type RunningExport } from '../../engine/export/exportClient'
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
}

const STORAGE_KEY = 'jellycut.export'

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
    phase: 'idle' as ExportPhase,
    progress: null as ExportProgress | null,
    result: null as ExportResultInfo | null,
    error: null as ExportMessage | null,
    encoders: null as EncoderInfo | null,
    inWorker: false
  }),
  getters: {
    /** Estimated file size for the current options and the project length. */
    estimatedBytes(state): number {
      const editor = useEditorStore()
      return estimateFileSize(state.options, editor.project.format.ratio, editor.totalDuration)
    },
    missingNames(): string[] {
      return missingInProject(useEditorStore().project)
    },
    canStart(state): boolean {
      const editor = useEditorStore()
      return (
        state.phase === 'ready' &&
        state.encoders?.video != null &&
        editor.totalDuration > 0 &&
        missingInProject(editor.project).length === 0
      )
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
      if (this.phase !== 'ready' || activeRun !== null || this.encoders?.video == null) return
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

      const files: Record<string, File> = {}
      for (const asset of project.assets) {
        const file = getAssetFile(asset.id)
        if (file) files[asset.id] = file
      }
      const fileName = exportFileName(project.name, 'mp4')
      const options = { ...this.options }
      // The state is reactive (Proxy objects cannot be posted to a worker), so the worker gets a plain copy.
      const snapshot = JSON.parse(JSON.stringify(project)) as Project

      this.progress = null
      this.error = null
      this.phase = 'running'
      try {
        const run = startExport({ project: snapshot, files, options }, FONT_SOURCES, (progress) => {
          this.progress = progress
        })
        activeRun = run
        this.inWorker = run.inWorker
        const result = await run.promise
        resultBlob = result.blob
        this.result = { size: result.blob.size, fileName }
        this.phase = 'done'
      } catch (error) {
        if (error instanceof ExportCancelled) this.phase = 'cancelled'
        else if (error instanceof ExportUnsupported) this.fail({ key: 'export.errors.unsupported', params: {} })
        else this.fail({ key: 'export.errors.failed', params: { message: errorMessage(error) } })
      } finally {
        activeRun = null
      }
    },

    cancel(): void {
      if (this.phase === 'running') activeRun?.cancel()
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
          const handle = await picker.showSaveFilePicker({
            suggestedName: info.fileName,
            types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }]
          })
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
