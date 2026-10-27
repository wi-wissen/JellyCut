import { defineStore } from 'pinia'
import { withTimeout } from '../../core/async/timeout'
import { createIdGenerator, nextId } from '../../core/timeline/ids'
import { projectIds } from '../../core/timeline/ops'
import { addAsset, addMusic, appendClip, assetFromProbe } from '../../core/timeline/insert'
import type { Asset, AssetOrigin, Project } from '../../core/project/types'
import { secondsToMicros, MICROS_PER_SECOND, type Micros } from '../../core/time'
import { ElementFallback } from '../../engine/media/elementFallback'
import { ExactFrameProvider, type DecodedFrame } from '../../engine/media/frames'
import { isImageFile, probeFile, type MediaInfo, type ProbeProblem } from '../../engine/media/probe'
import { planFolderOpen, type FolderEntry } from '../../core/io/folderOpen'
import { parseProjectJson } from '../../core/project/schema'
import { type FileCandidate, type RelinkReason } from '../../core/io/relink'
import {
  candidateFromFile,
  describeRelinkSummary,
  planRelink,
  usedAssetIds,
  type RelinkPlan,
  type RelinkSummary
} from '../../core/io/relinkPlan'
import {
  activeWorkFolder,
  ensurePermission,
  findInWorkFolder,
  folderPermission,
  forgetFolder,
  loadFolder,
  pickFilesFromWorkFolder,
  scanFolder,
  setActiveWorkFolder,
  type FolderPermission,
  type ScannedFile,
  type WorkFolderHandle
} from '../../platform/workFolder'
import { chooseWorkFolder } from '../../platform/projectFiles'
import { createIdbMediaStore, newStoreKey, requestPersistentStorage, type MediaStore, type PersistState } from '../../platform/mediaStore'
import { droppedKeys, planSweep, storeKeysOf } from '../../core/io/storedMedia'
import { assetUsage, removeAsset as removeAssetFromProject, removeUnusedAssets } from '../../core/timeline/assetOps'
import { useEditorStore } from './editor'
import { planReconcile, RemovedMediaCache, REMOVED_MEDIA_LIMIT } from './removedMedia'

export type MediaStatus = 'ready' | 'missing' | 'unsupported'

/** How a file was found: by name and size, by size and length, by its path in the work folder, or by the user. */
export type LinkBasis = RelinkReason | 'path' | 'manual'

const THUMB_WIDTH = 320
const THUMB_QUALITY = 0.8
// A decoder that never answers must not keep an import (and the Record tab) waiting.
const THUMB_TIMEOUT_MS = 10_000
const THUMB_MAX_TIME: Micros = secondsToMicros(1)
const LENGTH_TOLERANCE: Micros = MICROS_PER_SECOND
const SCAN_MAX_DEPTH = 3
const SCAN_MAX_FILES = 5000
const PICK_ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov'
// Upper bound for the automatic apply loop; each round consumes at least one candidate.
const MAX_ROUNDS = 100

// Files are kept outside Pinia state: they are large and must never be proxied by Vue.
const files = new Map<string, File>()
let provider = new ExactFrameProvider()

/** Candidate files that were not used yet. Their File objects stay here, outside reactive state. */
interface PoolEntry {
  candidate: FileCandidate
  load: () => Promise<File>
  info?: MediaInfo
  fromFolder: boolean
}
const pool = new Map<string, PoolEntry>()
let poolSeq = 0

/** What a removed asset had, kept so an undo can bring it back as ready (see reconcileWith). */
interface RemovedMedia {
  file: File
  status: MediaStatus
  problems: ProbeProblem[]
  thumbnail: string | null
  storeKey?: string
}
const removedMedia = new RemovedMediaCache<RemovedMedia>(REMOVED_MEDIA_LIMIT)

// The browser's private copies of recordings and example videos; swapped for a fake in tests.
let storage: MediaStore = createIdbMediaStore()
export function setMediaStorage(next: MediaStore): void {
  storage = next
}
// Stored orphans younger than this may belong to another tab that is still saving its project.
const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000
// Store key per asset id of the open document, so a removed asset's copy can be found after it left the project.
const storeKeyById = new Map<string, string>()
// Counts documents, so a slow restore of an earlier one cannot touch the current one.
let documentSeq = 0
let rememberedFolder: WorkFolderHandle | null = null
/** Project files of a folder that holds several, waiting for the user's pick (handles stay out of the reactive state). */
let folderProjects = new Map<string, ScannedFile>()

/** Safety net for single pictures drawn outside the preview (fine cut view): the media element stands in when exact decoding fails. */
export const elementFallback = new ElementFallback()

/** Frame source for media in this session. Call it each time: the instance is replaced when media is reset. */
export function getFrameProvider(): ExactFrameProvider {
  return provider
}

/** The File behind an asset in this session, if it was imported (or re-linked) here. */
export function getAssetFile(assetId: string): File | undefined {
  return files.get(assetId)
}

// Assets of the built-in demo project. They never point at files the user imported, so there is nothing to re-link.
const DEMO_ASSET_ID = /^asset-(intro|beach|interview|music)$/

/** Whether the asset came from the user's own import (not from the built-in demo project). */
export function isUserAsset(asset: Asset): boolean {
  return !DEMO_ASSET_ID.test(asset.id)
}

/** Used user assets that have no file in this session, in project order. This is what re-linking is about. */
export function missingUsedAssets(project: Project, status: Record<string, MediaStatus | undefined>): Asset[] {
  const used = usedAssetIds(project)
  return project.assets.filter((a) => isUserAsset(a) && used.has(a.id) && status[a.id] !== 'ready')
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

/** The frame at the usual thumbnail time; streamed recordings can lack it, so the first frame is the fallback. */
async function thumbnailFrame(asset: Asset): Promise<DecodedFrame | null> {
  const time = thumbnailTime(asset)
  return (await getFrameProvider().getFrame(asset.id, time)) ?? (time > 0 ? getFrameProvider().getFrame(asset.id, 0) : null)
}

async function makeThumbnail(asset: Asset): Promise<string | null> {
  try {
    const frame = await getFrameProvider().getFrame(asset.id, thumbnailTime(asset))
    return frame ? thumbnailFrom(frame) : null
  } catch {
    return null
  }
}

/**
 * Why a file cannot stand in for the asset (an i18n key), or null when it fits. Images have no
 * length, so only the kind and the decodability are compared for them.
 */
function mismatchFor(asset: Asset, info: MediaInfo): string | null {
  if (info.problems.length > 0) return 'relink.errors.unsupported'
  if (info.kind !== asset.kind) return 'relink.errors.wrongFile'
  if (asset.kind !== 'image' && Math.abs(info.duration - asset.duration) > LENGTH_TOLERANCE) {
    return 'relink.errors.wrongFile'
  }
  return null
}

type Verified = { ok: true; file: File; info: MediaInfo } | { ok: false; error: string }

async function verifyEntry(asset: Asset, entry: PoolEntry): Promise<Verified> {
  const file = await entry.load()
  const info = entry.info ?? (await probeFile(file))
  const error = mismatchFor(asset, info)
  return error ? { ok: false, error } : { ok: true, file, info }
}

interface BatchItem {
  asset: Asset
  file: File
  basis: LinkBasis
  /** Path inside the work folder; stored on the asset so the project can find it again. */
  relPath?: string
}

/** Human-readable label for a candidate: the path for folder files, otherwise the name, numbered when ambiguous. */
function candidateLabels(): Record<string, string> {
  const base = new Map<string, string>()
  for (const [key, entry] of pool) base.set(key, entry.fromFolder ? entry.candidate.key : entry.candidate.name)
  const seen = new Map<string, number>()
  const labels: Record<string, string> = {}
  for (const [key, label] of base) {
    const count = (seen.get(label) ?? 0) + 1
    seen.set(label, count)
    labels[key] = count === 1 ? label : `${label} (${count})`
  }
  return labels
}

/** How many clips, music items and pictures use an asset. */
function usageCount(project: Project, assetId: string): number {
  const usage = assetUsage(project, assetId)
  return usage.clipIds.length + usage.musicIds.length + usage.overlayIds.length
}

export const useMediaStore = defineStore('media', {
  state: () => ({
    status: {} as Record<string, MediaStatus>,
    problems: {} as Record<string, ProbeProblem[]>,
    thumbnails: {} as Record<string, string>,
    importing: 0,
    lastImportError: null as string | null,

    /** Set when a document with used media is opened or restored. */
    needsRelink: false,
    /** Dialog visibility. Opened automatically once per document, then only by the user. */
    relinkOpen: false,
    /** Assets the dialog lists: the missing ones when it was opened, plus those resolved since. */
    relinkListIds: [] as string[],
    relinkPlan: null as RelinkPlan | null,
    relinkLabels: {} as Record<string, string>,
    /** Chosen candidate per ambiguous asset, applied with applyChoices(). */
    relinkChoices: {} as Record<string, string>,
    relinkReasons: {} as Record<string, LinkBasis>,
    /** i18n key per asset whose chosen file did not fit. */
    relinkRejected: {} as Record<string, string>,
    relinkBusy: false,
    relinkScanned: null as number | null,
    relinkNotice: null as string | null,

    /** Counts the swaps of an asset's file for an equivalent one (see replaceFile); the player re-reads the file when it changes. */
    fileRevision: {} as Record<string, number>,

    /** Bytes of every copy in this browser's private storage, by store key. */
    storedSizes: {} as Record<string, number>,
    /** Whether the browser agreed to keep the storage (see requestPersistentStorage). */
    persistence: 'unknown' as 'unknown' | PersistState,

    /** The remembered work folder. Null when none is remembered. */
    folder: null as { name: string; permission: FolderPermission } | null,

    /** A removal waiting for the user's confirmation because the asset is used on the timeline. */
    pendingRemoval: null as null | { assetId: string; name: string; clips: number; music: number; pictures: number },
    /** The last removal, offered with an Undo button until the next action. */
    removalNote: null as null | { key: string; params: Record<string, string | number> },
    /** What the work folder chosen last contains; shown in the library until dismissed. */
    folderNote: null as null | { key: string; params: Record<string, string | number> },
    /** Names of the project files to choose from when an opened folder holds more than one. */
    folderChoice: null as null | { folder: string; names: string[] }
  }),
  getters: {
    /** Assets without a File (for example after a reload) count as missing. */
    statusOf: (state) => (assetId: string): MediaStatus => state.status[assetId] ?? 'missing',
    missingCount(state): number {
      return missingUsedAssets(useEditorStore().project, state.status).length
    },
    /** Total size of the recordings and example videos kept in this browser. */
    storedBytes: (state): number => Object.values(state.storedSizes).reduce((sum, n) => sum + n, 0),
    /** Recordings of the open project that have a copy in this browser's storage (they exist nowhere else). */
    storedAssetCount(state): number {
      return useEditorStore().project.assets.filter((a) => a.origin === 'recording' && a.storeKey && state.storedSizes[a.storeKey] !== undefined).length
    },
    /** User assets that no clip, music item or picture-in-picture uses. */
    unusedCount(): number {
      const project = useEditorStore().project
      return project.assets.filter((a) => isUserAsset(a) && usageCount(project, a.id) === 0).length
    }
  },
  actions: {
    /** Probes the files and adds them to the project in one undo step. Never throws. */
    async importFiles(
      list: File[],
      relPaths: (string | null)[] = [],
      options: { durationHintSeconds?: number; origin?: AssetOrigin } = {}
    ): Promise<void> {
      if (list.length === 0) return
      this.importing++
      try {
        const editor = useEditorStore()
        const nextAssetId = createIdGenerator('asset-')
        const imported: { asset: Asset; info: MediaInfo; file: File }[] = []
        for (const [index, file] of list.entries()) {
          try {
            const info = await probeFile(file, options)
            const relPath = relPaths[index] ?? file.name
            const asset = assetFromProbe(info, nextAssetId(projectIds(editor.project)), relPath)
            if (options.origin) {
              asset.origin = options.origin
              asset.storeKey = newStoreKey()
            }
            imported.push({ asset, info, file })
          } catch (e) {
            this.lastImportError = errorMessage(e)
          }
        }
        if (imported.length === 0) return

        let project = editor.project
        for (const { asset } of imported) {
          project = addAsset(project, asset)
          removedMedia.take(asset.id)
        }
        for (const { asset, info, file } of imported) {
          registerFile(asset.id, file)
          if (asset.storeKey) storeKeyById.set(asset.id, asset.storeKey)
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
            const frame = await withTimeout(thumbnailFrame(asset), THUMB_TIMEOUT_MS, 'thumbnail')
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

    /** Imports files picked from the work folder; their paths inside the folder are kept. */
    async importFromWorkFolder(): Promise<void> {
      const picked = await pickFilesFromWorkFolder()
      if (!picked || picked.length === 0) return
      await this.importFiles(
        picked.map((p) => p.file),
        picked.map((p) => p.relPath)
      )
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
    markMissingFor(project: Project, previous?: Project): void {
      documentSeq++
      resetFiles()
      pool.clear()
      // Copies the replaced document no longer needs are deleted; those the new one refers to stay.
      const cleared = removedMedia.clear()
      const leaving = storeKeysOf(previous)
      for (const [, entry] of cleared) if (entry.storeKey) leaving.add(entry.storeKey)
      void this.purgeStored(droppedKeys(leaving, storeKeysOf(project)))
      storeKeyById.clear()
      for (const asset of project.assets) if (asset.storeKey) storeKeyById.set(asset.id, asset.storeKey)
      const status: Record<string, MediaStatus> = {}
      for (const asset of project.assets) status[asset.id] = 'missing'
      this.status = status
      this.problems = {}
      this.thumbnails = {}
      this.lastImportError = null
      this.resetRelink()

      // Media with a stored copy is not missing yet: restoreStored decides.
      const missing = missingUsedAssets(project, status).filter((a) => !a.storeKey).map((a) => a.id)
      this.relinkListIds = missing
      this.needsRelink = missing.length > 0
      this.relinkOpen = missing.length > 0
    },

    /**
     * Loads the stored copies of the project's recordings and example videos, so they are ready without
     * re-linking. What this browser does not have (a project file from another computer) joins the re-link list.
     */
    async restoreStored(project: Project, options: { sweep?: boolean } = {}): Promise<void> {
      const seq = documentSeq
      const wanted = project.assets.filter((a) => a.storeKey)
      const found: { asset: Asset; file: File }[] = []
      for (const asset of wanted) {
        const file = await storage.get(asset.storeKey as string)
        if (seq !== documentSeq) return
        if (file) found.push({ asset, file })
      }
      for (const { asset, file } of found) {
        registerFile(asset.id, file)
        this.status[asset.id] = 'ready'
        delete this.problems[asset.id]
      }
      const missing = missingUsedAssets(project, this.status)
      if (missing.length > 0 || this.relinkListIds.length > 0) {
        this.relinkListIds = [...new Set([...this.relinkListIds, ...missing.map((a) => a.id)])]
        this.needsRelink = missing.length > 0
        this.relinkOpen = this.relinkOpen || missing.length > 0
      }
      this.replan()
      await this.refreshStored()
      if (options.sweep) await this.sweepStored(project)
      // Thumbnails take a moment to decode; the library shows the tiles first.
      for (const { asset } of found) {
        void makeThumbnail(asset).then((thumbnail) => {
          if (thumbnail && seq === documentSeq && this.status[asset.id] === 'ready') this.thumbnails[asset.id] = thumbnail
        })
      }
    },

    /** Reads the sizes of the stored copies (for the size display and the discard warning). */
    async refreshStored(): Promise<void> {
      const list = await storage.list()
      this.storedSizes = Object.fromEntries(list.map((s) => [s.key, s.size]))
    },

    /** Debug and test accessor: the keys of every stored copy. */
    async storedKeys(): Promise<string[]> {
      return (await storage.list()).map((s) => s.key)
    },

    /** Deletes stored copies that nothing refers to any more (older than a day, see SWEEP_GRACE_MS). */
    async sweepStored(project: Project): Promise<void> {
      const stale = planSweep(await storage.list(), storeKeysOf(project), Date.now(), SWEEP_GRACE_MS)
      if (stale.length > 0) await this.purgeStored(stale)
    },

    /** Deletes stored copies unless the open project still refers to them. Never throws. */
    async purgeStored(keys: string[]): Promise<void> {
      if (keys.length === 0) return
      const inUse = storeKeysOf(useEditorStore().project)
      for (const key of keys) if (!inUse.has(key)) await storage.delete(key).catch(() => undefined)
      await this.refreshStored()
    },

    /**
     * Keeps the file of an asset made in the app (recording, example video) in this browser's private storage,
     * so it survives reloads. 'quota' and 'unavailable' leave the file in memory only.
     */
    async persistAsset(assetId: string): Promise<'stored' | 'quota' | 'unavailable' | 'skipped'> {
      const asset = useEditorStore().project.assets.find((a) => a.id === assetId)
      const file = files.get(assetId)
      if (!asset?.storeKey || !file) return 'skipped'
      const result = await storage.put(asset.storeKey, file)
      if (!result.ok) return result.reason
      this.storedSizes = { ...this.storedSizes, [asset.storeKey]: file.size }
      // Asked once, after the first copy; the answer arrives on its own.
      if (this.persistence === 'unknown') {
        this.persistence = 'denied'
        void requestPersistentStorage().then((state) => {
          this.persistence = state
        })
      }
      return 'stored'
    },

    /**
     * Swaps the file behind an asset for an equivalent one (same pictures and sound, better structure: the optimised
     * recording). The asset keeps its id, its entry in the project and its original size, so nothing on the timeline
     * changes and re-linking by the original file still matches. Only done when `previous` is still the asset's file.
     * The browser's stored copy is replaced too.
     */
    async replaceFile(assetId: string, file: File, previous: File): Promise<boolean> {
      const asset = useEditorStore().project.assets.find((a) => a.id === assetId)
      if (!asset || files.get(assetId) !== previous) return false
      registerFile(assetId, file)
      this.fileRevision = { ...this.fileRevision, [assetId]: (this.fileRevision[assetId] ?? 0) + 1 }
      if (asset.storeKey) await this.persistAsset(assetId)
      return true
    },

    resetRelink(): void {
      this.relinkPlan = null
      this.relinkLabels = {}
      this.relinkChoices = {}
      this.relinkReasons = {}
      this.relinkRejected = {}
      this.relinkBusy = false
      this.relinkScanned = null
      this.relinkNotice = null
    },

    openRelinkDialog(): void {
      this.relinkOpen = true
    },

    closeRelinkDialog(): void {
      this.relinkOpen = false
    },

    dismissImportError(): void {
      this.lastImportError = null
    },

    /**
     * Removes an asset with every clip and music item that uses it, in one undo step, and frees its file,
     * decoder, thumbnail and status. Returns false when the asset is unknown. Use requestRemoval from the UI.
     */
    removeAsset(assetId: string): boolean {
      const editor = useEditorStore()
      const before = editor.project
      const after = removeAssetFromProject(before, assetId)
      if (after === before) return false
      const name = before.assets.find((a) => a.id === assetId)?.name ?? ''
      const usage = assetUsage(before, assetId)
      editor.commitProject(after)
      const clips = usage.clipIds.length
      this.removalNote = clips > 0
        ? { key: 'relink.removed.withClips', params: { name, clips } }
        : { key: 'relink.removed.one', params: { name } }
      this.afterRemoval()
      return true
    },

    /** Asks first when the asset is used on the timeline; an unused asset is removed at once. */
    requestRemoval(assetId: string): void {
      const project = useEditorStore().project
      const asset = project.assets.find((a) => a.id === assetId)
      if (!asset) return
      const usage = assetUsage(project, assetId)
      if (usageCount(project, assetId) === 0) {
        this.removeAsset(assetId)
        return
      }
      this.pendingRemoval = { assetId, name: asset.name, clips: usage.clipIds.length, music: usage.musicIds.length, pictures: usage.overlayIds.length }
    },

    confirmRemoval(): void {
      const pending = this.pendingRemoval
      this.pendingRemoval = null
      if (pending) this.removeAsset(pending.assetId)
    },

    cancelRemoval(): void {
      this.pendingRemoval = null
    },

    /** Removes every unused user asset in one undo step. */
    removeUnused(): number {
      const editor = useEditorStore()
      const before = editor.project
      const after = removeUnusedAssets(before)
      if (after === before) return 0
      const removed = before.assets.filter((a) => !after.assets.some((b) => b.id === a.id)).map((a) => a.id)
      editor.commitProject(after)
      this.removalNote = { key: 'relink.removed.unused', params: { count: removed.length } }
      this.afterRemoval()
      return removed.length
    },

    /** Undoes the last removal (one undo step of the editor history). */
    undoRemoval(): void {
      useEditorStore().undo()
      this.removalNote = null
    },

    dismissRemovalNote(): void {
      this.removalNote = null
    },

    /**
     * Runs after every change of the document (commit, undo, redo). A file whose asset left the project is
     * kept in a small cache, with its thumbnail and status, so undo can bring it back. An asset that is in the
     * project again and has a cached file becomes ready at once. Everything else is left alone.
     */
    reconcileWith(project: Project): void {
      const inProject = new Set(project.assets.map((a) => a.id))
      const plan = planReconcile(project.assets.map((a) => a.id), files.keys(), removedMedia.ids())
      const leftStatus = Object.keys(this.status).filter((id) => !inProject.has(id))
      if (plan.evict.length === 0 && plan.restore.length === 0 && leftStatus.length === 0) return

      const gone = new Set([...plan.evict, ...leftStatus])
      for (const id of gone) {
        const file = files.get(id)
        if (file) {
          const dropped = removedMedia.put(id, {
            file,
            status: this.status[id] ?? 'ready',
            problems: this.problems[id] ?? [],
            thumbnail: this.thumbnails[id] ?? null,
            storeKey: storeKeyById.get(id)
          })
          // An undo cache entry that fell out is gone for good: its stored copy goes too.
          const freed = dropped.map(([, entry]) => entry.storeKey).filter((k): k is string => !!k)
          if (freed.length > 0) void this.purgeStored(freed)
          files.delete(id)
        }
        delete this.status[id]
        delete this.problems[id]
        delete this.thumbnails[id]
        delete this.relinkReasons[id]
        delete this.relinkRejected[id]
        delete this.relinkChoices[id]
      }
      // Rebuilding the provider disposes the decoders of the removed files.
      if (plan.evict.length > 0) rebuildProvider()

      for (const id of plan.restore) {
        const cached = removedMedia.take(id)
        if (!cached) continue
        registerFile(id, cached.file)
        if (cached.storeKey) storeKeyById.set(id, cached.storeKey)
        this.status[id] = cached.status
        if (cached.problems.length > 0) this.problems[id] = cached.problems
        if (cached.thumbnail) this.thumbnails[id] = cached.thumbnail
      }
      this.relinkListIds = this.relinkListIds.filter((id) => !gone.has(id))
      this.replan()
    },

    /** Ids of removed assets whose file is still kept for undo. */
    removedMediaIds(): string[] {
      return removedMedia.ids()
    },

    /** After a removal: nothing missing any more closes the dialog. */
    afterRemoval(): void {
      if (missingUsedAssets(useEditorStore().project, this.status).length === 0) this.relinkOpen = false
    },

    /**
     * Opens the native picker for media files to re-link. Call it straight from a click.
     * The chosen files are matched right away; see relinkFiles.
     */
    pickFiles(): void {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.accept = PICK_ACCEPT
      input.style.display = 'none'
      const finish = (): void => input.remove()
      input.addEventListener('change', () => {
        const picked = Array.from(input.files ?? [])
        finish()
        if (picked.length > 0) void this.relinkFiles(picked)
      })
      input.addEventListener('cancel', finish)
      document.body.append(input)
      input.click()
    },

    /** Lets the user pick one file for one missing asset (the tile's Re-link button). Call it straight from a click. */
    pickFileFor(assetId: string): void {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = PICK_ACCEPT
      input.style.display = 'none'
      const finish = (): void => input.remove()
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        finish()
        if (file) void this.applyManualMatch(assetId, file)
      })
      input.addEventListener('cancel', finish)
      document.body.append(input)
      input.click()
    },

    /**
     * Probes the given files and matches them to the missing assets by name and size, or by size and
     * length. Unambiguous matches are applied in one batch; the rest stays for the user to choose.
     */
    async relinkFiles(list: File[]): Promise<RelinkSummary> {
      this.relinkRejected = {}
      this.relinkNotice = null
      this.relinkBusy = true
      try {
        for (const file of list) {
          const info = await probeFile(file)
          const key = `file-${++poolSeq}`
          const candidate = candidateFromFile(file, key, info.duration)
          pool.set(key, { candidate, load: async () => file, info, fromFolder: false })
        }
        await this.applyAutomatically()
      } finally {
        this.relinkBusy = false
      }
      this.openIfStillMissing()
      return describeRelinkSummary(this.relinkPlan ?? planRelink(useEditorStore().project, this.status, []))
    },

    /**
     * Re-links from the work folder. The file at each asset's stored path is tried first; for the
     * rest the folder is scanned and matched by name and size, or by size and length.
     * Needs the user gesture that is also used to grant access.
     */
    async relinkFromWorkFolder(dirArg?: WorkFolderHandle): Promise<boolean> {
      const dir = dirArg ?? activeWorkFolder()
      this.relinkRejected = {}
      this.relinkNotice = null
      if (!dir) {
        this.relinkNotice = 'relink.folder.none'
        return false
      }
      if (!(await ensurePermission(dir))) {
        this.relinkNotice = 'relink.folder.noAccess'
        this.folder = { name: dir.name, permission: await folderPermission(dir) }
        return false
      }
      rememberedFolder = dir
      setActiveWorkFolder(dir)
      this.folder = { name: dir.name, permission: 'granted' }
      useEditorStore().workFolderName = dir.name

      this.relinkBusy = true
      this.relinkScanned = 0
      try {
        // 1. The path stored in the project: fast and exact when the folder was moved along.
        const byPath: BatchItem[] = []
        for (const asset of missingUsedAssets(useEditorStore().project, this.status)) {
          const file = await findInWorkFolder(dir, asset.relPath)
          if (!file) continue
          const info = await probeFile(file)
          if (mismatchFor(asset, info)) continue
          byPath.push({ asset, file, basis: 'path' })
        }
        await this.commitBatch(byPath)

        // 2. Everything else: scan the folder, keep only files whose size fits a missing asset.
        const remaining = missingUsedAssets(useEditorStore().project, this.status)
        if (remaining.length > 0) {
          const sizes = new Set(remaining.map((a) => a.size))
          const scanned = await scanFolder(dir, SCAN_MAX_DEPTH, SCAN_MAX_FILES, {
            onProgress: (found) => {
              this.relinkScanned = found
            }
          })
          for (const entry of scanned) {
            if (!sizes.has(entry.size)) continue
            const file = await entry.handle.getFile()
            const info = await probeFile(file)
            const key = entry.key
            pool.set(key, {
              candidate: candidateFromFile({ name: entry.name, size: entry.size }, key, info.duration),
              load: async () => file,
              info,
              fromFolder: true
            })
          }
        }
        await this.applyAutomatically()
      } finally {
        this.relinkBusy = false
        this.relinkScanned = null
      }
      this.openIfStillMissing()
      return true
    },

    /** Lets the user choose a work folder now, then re-links from it. Call it straight from a click. */
    async chooseFolderForRelink(): Promise<boolean> {
      let dir: WorkFolderHandle | null
      try {
        dir = (await chooseWorkFolder()) as WorkFolderHandle | null
      } catch {
        this.relinkNotice = 'relink.folder.pickFailed'
        return false
      }
      if (!dir) return false
      useEditorStore().workFolderName = dir.name
      return this.relinkFromWorkFolder(dir)
    },

    /** Re-reads the remembered folder and its permission state, for the project menu. */
    async refreshWorkFolder(): Promise<void> {
      const dir = activeWorkFolder() ?? rememberedFolder ?? (await loadFolder())
      if (!dir) {
        rememberedFolder = null
        this.folder = null
        return
      }
      rememberedFolder = dir
      const permission = await folderPermission(dir)
      if (permission === 'granted') setActiveWorkFolder(dir)
      this.folder = { name: dir.name, permission }
    },

    /**
     * Asks for access to the remembered folder again after a browser restart. Call it straight from a click.
     * Returns whether access was granted.
     */
    async grantWorkFolderAccess(): Promise<boolean> {
      const dir = rememberedFolder ?? activeWorkFolder()
      if (!dir) return false
      const granted = await ensurePermission(dir)
      if (granted) {
        setActiveWorkFolder(dir)
        useEditorStore().workFolderName = dir.name
      }
      this.folder = { name: dir.name, permission: granted ? 'granted' : 'prompt' }
      return granted
    },

    /**
     * Opens a folder like a project: its project file is loaded and the media are linked from the folder; without one a
     * new project is started from the folder's media. Saving writes into the folder. Call it straight from a click.
     */
    async openWorkFolder(): Promise<void> {
      this.folderNote = null
      let dir: WorkFolderHandle | null
      try {
        dir = (await chooseWorkFolder()) as WorkFolderHandle | null
      } catch {
        this.folderNote = { key: 'relink.folder.pickFailed', params: {} }
        return
      }
      if (!dir) return
      rememberedFolder = dir
      setActiveWorkFolder(dir)
      this.folder = { name: dir.name, permission: 'granted' }
      const editor = useEditorStore()
      editor.workFolderName = dir.name

      this.relinkBusy = true
      this.relinkScanned = 0
      let scanned: ScannedFile[]
      try {
        scanned = await scanFolder(dir, SCAN_MAX_DEPTH, SCAN_MAX_FILES, {
          onProgress: (found) => {
            this.relinkScanned = found
          }
        })
      } catch {
        this.folderNote = { key: 'relink.folder.pickFailed', params: {} }
        return
      } finally {
        this.relinkBusy = false
        this.relinkScanned = null
      }
      const byKey = new Map(scanned.map((f) => [f.key, f]))
      const plan = planFolderOpen(scanned)
      const projects = plan.projects.map((e: FolderEntry) => byKey.get(e.key)!)
      if (projects.length === 1) {
        await this.openFolderProject(dir, projects[0]!)
      } else if (projects.length > 1) {
        folderProjects = new Map(projects.map((f) => [f.name, f]))
        this.folderChoice = { folder: dir.name, names: projects.map((f) => f.name) }
      } else {
        await this.startFolderProject(dir, plan.media.map((e: FolderEntry) => byKey.get(e.key)!))
      }
    },

    /** Loads the project the user picked from a folder with several. */
    async chooseFolderProject(name: string): Promise<void> {
      const entry = folderProjects.get(name)
      const dir = activeWorkFolder()
      this.folderChoice = null
      folderProjects = new Map()
      if (entry && dir) await this.openFolderProject(dir, entry)
    },

    cancelFolderChoice(): void {
      this.folderChoice = null
      folderProjects = new Map()
    },

    async openFolderProject(dir: WorkFolderHandle, entry: ScannedFile): Promise<void> {
      const editor = useEditorStore()
      let text: string
      try {
        text = await (await entry.handle.getFile()).text()
      } catch (e) {
        editor.loadError = errorMessage(e)
        return
      }
      const result = parseProjectJson(text)
      if (!result.ok) {
        editor.loadError = result.errors.join('; ')
        return
      }
      editor.replaceDocument(result.project, { handle: entry.handle, name: entry.name })
      await this.relinkFromWorkFolder(dir)
      await this.linkUnusedFromFolder(dir)
      this.folderNote = { key: 'relink.folder.openedProject', params: { file: entry.name } }
    },

    /** Library files no clip uses yet are not part of the relink; the folder opening links them by their stored path too. */
    async linkUnusedFromFolder(dir: WorkFolderHandle): Promise<void> {
      const batch: BatchItem[] = []
      for (const asset of useEditorStore().project.assets) {
        if (!isUserAsset(asset) || this.statusOf(asset.id) === 'ready') continue
        const file = await findInWorkFolder(dir, asset.relPath)
        if (!file) continue
        try {
          const info = await probeFile(file)
          if (!mismatchFor(asset, info)) batch.push({ asset, file, basis: 'path' })
        } catch {
          // Unreadable: the asset stays missing and can be re-linked by hand.
        }
      }
      await this.commitBatch(batch)
    },

    /** A folder without a project file: new project named after the folder, with all its media imported. */
    async startFolderProject(dir: WorkFolderHandle, media: ScannedFile[]): Promise<void> {
      const editor = useEditorStore()
      editor.newProject(dir.name)
      if (media.length > 0) {
        const picked: { file: File; key: string }[] = []
        for (const entry of media) {
          try {
            picked.push({ file: await entry.handle.getFile(), key: entry.key })
          } catch {
            // A file that vanished since the scan is skipped.
          }
        }
        await this.importFiles(picked.map((p) => p.file), picked.map((p) => p.key))
      }
      this.folderNote =
        media.length > 0
          ? { key: 'relink.folder.chosenMedia', params: { name: dir.name, count: media.length } }
          : { key: 'relink.folder.chosenEmpty', params: { name: dir.name } }
    },

    dismissFolderNote(): void {
      this.folderNote = null
    },

    async forgetWorkFolder(): Promise<void> {
      await forgetFolder()
      rememberedFolder = null
      useEditorStore().workFolderName = null
      this.folder = null
      this.folderNote = null
    },

    /** Sets the file for one asset the user picked. Null on success, otherwise an i18n key. */
    async applyManualMatch(assetId: string, file: File): Promise<string | null> {
      const asset = useEditorStore().project.assets.find((a) => a.id === assetId)
      if (!asset) return 'relink.errors.unknown'
      delete this.relinkRejected[assetId]
      const info = await probeFile(file)
      const error = mismatchFor(asset, info)
      if (error) {
        this.relinkRejected = { ...this.relinkRejected, [assetId]: error }
        this.openIfStillMissing()
        return error
      }
      await this.commitBatch([{ asset, file, basis: 'manual' }])
      this.replan()
      this.openIfStillMissing()
      return null
    },

    /** Records which candidate the user picked for an ambiguous asset. */
    chooseCandidate(assetId: string, candidateKey: string): void {
      this.relinkChoices = { ...this.relinkChoices, [assetId]: candidateKey }
    },

    /** Applies the chosen candidates in one batch, then the automatic matches that became unambiguous. */
    async applyChoices(): Promise<void> {
      const project = useEditorStore().project
      const batch: BatchItem[] = []
      this.relinkRejected = {}
      for (const [assetId, key] of Object.entries(this.relinkChoices)) {
        const asset = project.assets.find((a) => a.id === assetId)
        const entry = pool.get(key)
        if (!asset || !entry || this.statusOf(assetId) === 'ready') continue
        pool.delete(key)
        const result = await verifyEntry(asset, entry)
        if (result.ok) batch.push({ asset, file: result.file, basis: 'manual' })
        else this.relinkRejected[assetId] = result.error
      }
      this.relinkChoices = {}
      await this.commitBatch(batch)
      await this.applyAutomatically()
      this.openIfStillMissing()
    },

    /** Applies matches until none is left; each round consumes at least one candidate. */
    async applyAutomatically(): Promise<void> {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const plan = this.replan()
        const ids = Object.keys(plan.matches)
        if (ids.length === 0) return
        const project = useEditorStore().project
        const batch: BatchItem[] = []
        for (const assetId of ids) {
          const match = plan.matches[assetId]
          const asset = project.assets.find((a) => a.id === assetId)
          const entry = match ? pool.get(match.candidateKey) : undefined
          if (!match || !asset || !entry) continue
          pool.delete(match.candidateKey)
          const result = await verifyEntry(asset, entry)
          const relPath = entry.fromFolder ? entry.candidate.key : undefined
          if (result.ok) batch.push({ asset, file: result.file, basis: match.reason, relPath })
          else this.relinkRejected[assetId] = result.error
        }
        await this.commitBatch(batch)
      }
      this.replan()
    },

    /** Recomputes the plan from the candidates that are still unused. */
    replan(): RelinkPlan {
      const candidates = Array.from(pool.values(), (entry) => entry.candidate)
      const project = useEditorStore().project
      const plan = planRelink({ ...project, assets: project.assets.filter(isUserAsset) }, this.status, candidates)
      this.relinkPlan = plan
      this.relinkLabels = candidateLabels()
      // Choices for assets that are no longer ambiguous or candidates that are gone are dropped.
      const kept: Record<string, string> = {}
      for (const [assetId, key] of Object.entries(this.relinkChoices)) {
        if (plan.ambiguous[assetId]?.includes(key)) kept[assetId] = key
      }
      this.relinkChoices = kept
      return plan
    },

    /** Registers files for their assets in one step, then regenerates their thumbnails. */
    async commitBatch(batch: BatchItem[]): Promise<void> {
      if (batch.length === 0) return
      for (const item of batch) {
        registerFile(item.asset.id, item.file)
        // A re-linked recording is kept in this browser again.
        if (item.asset.storeKey) void this.persistAsset(item.asset.id)
        this.status[item.asset.id] = 'ready'
        this.relinkReasons[item.asset.id] = item.basis
        delete this.problems[item.asset.id]
        delete this.relinkRejected[item.asset.id]
      }
      const editor = useEditorStore()
      const newPaths = new Map(batch.filter((b) => b.relPath !== undefined).map((b) => [b.asset.id, b.relPath as string]))
      const changed = [...newPaths].some(([id, path]) => editor.project.assets.find((a) => a.id === id)?.relPath !== path)
      if (changed) {
        const assets = editor.project.assets.map((a) => (newPaths.has(a.id) ? { ...a, relPath: newPaths.get(a.id) as string } : a))
        editor.commitProject({ ...editor.project, assets })
      }
      for (const item of batch) {
        const thumbnail = await makeThumbnail(item.asset)
        if (thumbnail) this.thumbnails[item.asset.id] = thumbnail
      }
    },

    /** Reopens the dialog when media is still missing after an action started outside it. */
    openIfStillMissing(): void {
      if (missingUsedAssets(useEditorStore().project, this.status).length > 0) this.relinkOpen = true
    }
  }
})
