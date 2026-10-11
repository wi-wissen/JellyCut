import type { Scene } from '../../core/render/types'
import { loadAnimatedSheet, missingSceneSheets } from './stickerAnimations'

// Hashed asset URLs (the build precaches them). The glob also works inside the export worker.
const URLS = import.meta.glob<string>('../../assets/stickers/*.webp', { eager: true, query: '?url', import: 'default' })

const urlOf = new Map<string, string>()
for (const [path, url] of Object.entries(URLS)) urlOf.set(path.replace(/^.*\/(.+)\.webp$/, '$1'), url)

/** URL of a sticker file (for the gallery's <img>), or an empty string for an unknown id. */
export function stickerImageUrl(id: string): string {
  return urlOf.get(id) ?? ''
}

const bitmaps = new Map<string, ImageBitmap>()
const loading = new Map<string, Promise<void>>()

/** fetch + createImageBitmap, so it works in a worker (no DOM Image there). A failed load is retried on the next request. */
function load(id: string): Promise<void> {
  const known = loading.get(id)
  if (known) return known
  const url = urlOf.get(id)
  if (!url) return Promise.resolve()
  const promise = fetch(url)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      bitmaps.set(id, bitmap)
    })
    .catch(() => {
      loading.delete(id)
    })
  loading.set(id, promise)
  return promise
}

/** The decoded picture, or null while it is still loading (the load starts here). */
export function stickerBitmap(id: string): ImageBitmap | null {
  const hit = bitmaps.get(id)
  if (hit) return hit
  void load(id)
  return null
}

/**
 * Waits until every picture sticker on screen in this scene is decoded, so a paused frame and an export frame are
 * complete. The sheets of animated stickers are awaited too; one that cannot be loaded leaves the still picture.
 */
export async function loadSceneStickers(scene: Scene): Promise<void> {
  const ids = new Set<string>()
  for (const layer of scene.overlays) {
    if (layer.item.kind === 'sticker' && layer.item.imageId !== undefined && !bitmaps.has(layer.item.imageId)) ids.add(layer.item.imageId)
  }
  await Promise.all([...[...ids].map(load), ...missingSceneSheets(scene).map(loadAnimatedSheet)])
}
