import type { OverlayItem } from '../../core/project/types'
import type { Scene } from '../../core/render/types'
import { animatedSticker } from '../../core/render/stickerAnimations'

// Hashed asset URLs only: nothing is fetched until a sheet is asked for (the glob is eager, the values are strings).
// The service worker keeps these files out of its precache and caches them on first use (public/sw.js).
const URLS = import.meta.glob<string>('../../assets/stickers-animated/*.webp', { eager: true, query: '?url', import: 'default' })

const urlOf = new Map<string, string>()
for (const [path, url] of Object.entries(URLS)) urlOf.set(path.replace(/^.*\/sticker-anim-(.+)\.webp$/, '$1'), url)

/** URL of an animation sheet (for the gallery), or an empty string for an id without one. */
export function animatedSheetUrl(id: string): string {
  return urlOf.get(id) ?? ''
}

/** Decoded sheets stay while they are in use; the oldest go first (a sheet is about 3 MB decoded). */
const MAX_SHEETS = 24
const bitmaps = new Map<string, ImageBitmap>()
const loading = new Map<string, Promise<boolean>>()
const failedAt = new Map<string, number>()
/** After a failed load (offline, not cached) the still picture is shown and the next try waits this long. */
const RETRY_AFTER_MS = 10_000

/** fetch + createImageBitmap, so it works in a worker. Resolves to false when the sheet is not available. */
export function loadAnimatedSheet(id: string): Promise<boolean> {
  if (bitmaps.has(id)) return Promise.resolve(true)
  const known = loading.get(id)
  if (known) return known
  const url = urlOf.get(id)
  if (!url) return Promise.resolve(false)
  const failed = failedAt.get(id)
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(false)
  const promise = fetch(url)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      bitmaps.set(id, bitmap)
      failedAt.delete(id)
      while (bitmaps.size > MAX_SHEETS) {
        const oldest = bitmaps.keys().next().value
        if (oldest === undefined) break
        bitmaps.delete(oldest)
      }
      return true
    })
    .catch(() => {
      failedAt.set(id, Date.now())
      return false
    })
    .finally(() => {
      loading.delete(id)
    })
  loading.set(id, promise)
  return promise
}

/** The decoded sheet, or null while it is loading or unavailable (the load starts here). */
export function animatedSheetBitmap(id: string): ImageBitmap | null {
  const hit = bitmaps.get(id)
  if (hit) {
    // Most recently used goes last.
    bitmaps.delete(id)
    bitmaps.set(id, hit)
    return hit
  }
  void loadAnimatedSheet(id)
  return null
}

/** Sheets this scene plays that are not decoded yet; used to wait for them before a paused or exported frame. */
export function missingSceneSheets(scene: Scene): string[] {
  const ids = new Set<string>()
  for (const layer of scene.overlays) {
    const item = layer.item
    if (layer.frame !== undefined && item.kind === 'sticker' && item.imageId !== undefined && animatedSticker(item.imageId) && !bitmaps.has(item.imageId)) {
      ids.add(item.imageId)
    }
  }
  return [...ids]
}

/** Starts loading the sheets of the animated stickers in a project (opening a file, undo), so playback finds them decoded. */
export function warmAnimatedSheets(overlays: readonly OverlayItem[]): void {
  for (const item of overlays) {
    if (item.kind === 'sticker' && item.animated === true && item.imageId !== undefined) void loadAnimatedSheet(item.imageId)
  }
}
