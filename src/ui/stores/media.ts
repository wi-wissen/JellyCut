import { defineStore } from 'pinia'
import { createIdGenerator, nextId } from '../../core/timeline/ids'
import { projectIds } from '../../core/timeline/ops'
import { addAsset, addMusic, appendClip, assetFromProbe } from '../../core/timeline/insert'
import type { Asset, Project } from '../../core/project/types'
import { secondsToMicros, MICROS_PER_SECOND, type Micros } from '../../core/time'
import { ExactFrameProvider, type DecodedFrame } from '../../engine/media/frames'
import { isImageFile, probeFile, type MediaInfo, type ProbeProblem } from '../../engine/media/probe'
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
  type WorkFolderHandle
} from '../../platform/workFolder'
import { chooseWorkFolder } from '../../platform/projectFiles'
import { useEditorStore } from './editor'

export type MediaStatus = 'ready' | 'missing' | 'unsupported'

/** How a file was found: by name and size, by size and length, by its path in the work folder, or by the user. */
export type LinkBasis = RelinkReason | 'path' | 'manual'

const THUMB_WIDTH = 320
const THUMB_QUALITY = 0.8
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
let rememberedFolder: WorkFolderHandle | null = null

/** Frame source for media in this session. Call it each time: the instance is replaced when media is reset. */
export function getFrameProvider(): ExactFrameProvider {
  return provider
}

/** The File behind an asset in this session, if it was imported (or re-linked) here. */
export function getAssetFile(assetId: string): File | undefined {
  return files.get(assetId)
}

/** Used assets that have no file in this session, in project order. */
export function missingUsedAssets(project: Project, status: Record<string, MediaStatus | undefined>): Asset[] {
  const used = usedAssetIds(project)
  return project.assets.filter((a) => used.has(a.id) && status[a.id] !== 'ready')
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

    /** The remembered work folder. Null when none is remembered. */
    folder: null as { name: string; permission: FolderPermission } | null
  }),
  getters: {
    /** Assets without a File (for example after a reload) count as missing. */
    statusOf: (state) => (assetId: string): MediaStatus => state.status[assetId] ?? 'missing',
    missingCount(state): number {
      return missingUsedAssets(useEditorStore().project, state.status).length
    }
  },
  actions: {
    /** Probes the files and adds them to the project in one undo step. Never throws. */
    async importFiles(list: File[], relPaths: (string | null)[] = []): Promise<void> {
      if (list.length === 0) return
      this.importing++
      try {
        const editor = useEditorStore()
        const nextAssetId = createIdGenerator('asset-')
        const imported: { asset: Asset; info: MediaInfo; file: File }[] = []
        for (const [index, file] of list.entries()) {
          try {
            const info = await probeFile(file)
            const relPath = relPaths[index] ?? file.name
            const asset = assetFromProbe(info, nextAssetId(projectIds(editor.project)), relPath)
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
    markMissingFor(project: Project): void {
      resetFiles()
      pool.clear()
      const status: Record<string, MediaStatus> = {}
      for (const asset of project.assets) status[asset.id] = 'missing'
      this.status = status
      this.problems = {}
      this.thumbnails = {}
      this.lastImportError = null
      this.resetRelink()

      const missing = missingUsedAssets(project, status).map((a) => a.id)
      this.relinkListIds = missing
      this.needsRelink = missing.length > 0
      this.relinkOpen = missing.length > 0
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
        await this.applyAutomatically(true)
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

    async forgetWorkFolder(): Promise<void> {
      await forgetFolder()
      rememberedFolder = null
      useEditorStore().workFolderName = null
      this.folder = null
    },

    /** Sets the file for one asset the user picked. Null on success, otherwise an i18n key. */
    async applyManualMatch(assetId: string, file: File): Promise<string | null> {
      const asset = useEditorStore().project.assets.find((a) => a.id === assetId)
      if (!asset) return 'relink.errors.unknown'
      this.relinkRejected = { ...this.relinkRejected, [assetId]: '' }
      delete this.relinkRejected[assetId]
      const info = await probeFile(file)
      const error = mismatchFor(asset, info)
      if (error) {
        this.relinkRejected = { ...this.relinkRejected, [assetId]: error }
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
    async applyAutomatically(fromFolder = false): Promise<void> {
      void fromFolder
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
          if (result.ok) batch.push({ asset, file: result.file, basis: match.reason })
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
      const plan = planRelink(project, this.status, candidates)
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
