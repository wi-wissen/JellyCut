import { defineStore } from 'pinia'
import { createIdGenerator, nextId } from '../../core/timeline/ids'
import { projectIds } from '../../core/timeline/ops'
import { addAsset, addMusic, appendClip, assetFromProbe } from '../../core/timeline/insert'
import type { Asset, Project } from '../../core/project/types'
import { secondsToMicros, type Micros } from '../../core/time'
import { ExactFrameProvider, type DecodedFrame } from '../../engine/media/frames'
import { isImageFile, probeFile, type MediaInfo, type ProbeProblem } from '../../engine/media/probe'
import { useEditorStore } from './editor'

export type MediaStatus = 'ready' | 'missing' | 'unsupported'

const THUMB_WIDTH = 320
const THUMB_QUALITY = 0.8
const THUMB_MAX_TIME: Micros = secondsToMicros(1)

// Files are kept outside Pinia state: they are large and must never be proxied by Vue.
const files = new Map<string, File>()
let provider = new ExactFrameProvider()

/** Frame source for media in this session. Call it each time: the instance is replaced when media is reset. */
export function getFrameProvider(): ExactFrameProvider {
  return provider
}

/** The File behind an asset in this session, if it was imported (or re-linked) here. */
export function getAssetFile(assetId: string): File | undefined {
  return files.get(assetId)
}

function rebuildProvider(): void {
  const old = provider
  provider = new ExactFrameProvider()
  for (const [id, file] of files) provider.setFile(id, file, isImageFile(file))
  old.dispose().catch(() => undefined)
}

function registerFile(assetId: string, file: File): void {
  const reused = files.has(assetId)
  files.set(assetId, file)
  // A reused id (after an undo, or in another document) must not return frames cached for the old file.
  if (reused) rebuildProvider()
  else provider.setFile(assetId, file, isImageFile(file))
}

function resetFiles(): void {
  files.clear()
  rebuildProvider()
}

function thumbnailFrom(frame: DecodedFrame): string {
  const width = Math.min(THUMB_WIDTH, frame.width)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(1, Math.round((frame.height * width) / frame.width))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas is not available')
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', THUMB_QUALITY)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Time whose frame represents the asset in the library: one second in, or the middle of short clips. */
function thumbnailTime(asset: Asset): Micros {
  if (asset.kind !== 'video') return 0
  return Math.min(THUMB_MAX_TIME, Math.floor(asset.duration / 2))
}

export const useMediaStore = defineStore('media', {
  state: () => ({
    status: {} as Record<string, MediaStatus>,
    problems: {} as Record<string, ProbeProblem[]>,
    thumbnails: {} as Record<string, string>,
    importing: 0,
    lastImportError: null as string | null
  }),
  getters: {
    /** Assets without a File (for example after a reload) count as missing. */
    statusOf: (state) => (assetId: string): MediaStatus => state.status[assetId] ?? 'missing'
  },
  actions: {
    /** Probes the files and adds them to the project in one undo step. Never throws. */
    async importFiles(list: File[]): Promise<void> {
      if (list.length === 0) return
      this.importing++
      try {
        const editor = useEditorStore()
        const nextAssetId = createIdGenerator('asset-')
        const imported: { asset: Asset; info: MediaInfo; file: File }[] = []
        for (const file of list) {
          try {
            const info = await probeFile(file)
            const asset = assetFromProbe(info, nextAssetId(projectIds(editor.project)), file.name)
            imported.push({ asset, info, file })
          } catch (e) {
            this.lastImportError = errorMessage(e)
          }
        }
        if (imported.length === 0) return

        let project = editor.project
        for (const { asset } of imported) project = addAsset(project, asset)
        for (const { asset, info, file } of imported) {
          registerFile(asset.id, file)
          if (info.problems.length === 0) {
            this.status[asset.id] = 'ready'
          } else {
            this.status[asset.id] = 'unsupported'
            this.problems[asset.id] = info.problems
          }
          if (this.status[asset.id] === 'ready') delete this.problems[asset.id]
        }
        editor.commitProject(project)

        for (const { asset } of imported) {
          if (this.statusOf(asset.id) !== 'ready') continue
          try {
            const frame = await getFrameProvider().getFrame(asset.id, thumbnailTime(asset))
            if (frame) this.thumbnails[asset.id] = thumbnailFrom(frame)
          } catch (e) {
            this.lastImportError = errorMessage(e)
          }
        }
      } catch (e) {
        this.lastImportError = errorMessage(e)
      } finally {
        this.importing--
      }
    },

    /** Puts a ready asset on the timeline: video and images as a clip, audio as music at the playhead. */
    addToTimeline(assetId: string): void {
      if (this.statusOf(assetId) !== 'ready') return
      const editor = useEditorStore()
      const asset = editor.project.assets.find((a) => a.id === assetId)
      if (!asset) return
      try {
        const taken = projectIds(editor.project)
        if (asset.kind === 'audio') {
          editor.commitProject(addMusic(editor.project, assetId, nextId(taken, 'music-'), editor.playheadMicros))
        } else {
          editor.commitProject(appendClip(editor.project, assetId, nextId(taken, 'clip-')))
        }
      } catch (e) {
        this.lastImportError = errorMessage(e)
      }
    },

    /**
     * Called when a document replaces the current one (new, opened or restored). Its files are not
     * available in this session, so every asset of the project starts out missing.
     */
    markMissingFor(project: Project): void {
      resetFiles()
      const status: Record<string, MediaStatus> = {}
      for (const asset of project.assets) status[asset.id] = 'missing'
      this.status = status
      this.problems = {}
      this.thumbnails = {}
      this.lastImportError = null
    },

    dismissImportError(): void {
      this.lastImportError = null
    }
  }
})
