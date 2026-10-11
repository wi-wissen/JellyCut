import type { Scene } from '../../core/render/types'
import type { Micros } from '../../core/time'
import type { ExactFrameProvider } from '../media/frames'
import type { FrameSource } from './compositor'
import { loadSceneStickers } from './stickerImages'

/**
 * Last say over a frame the exact path delivered (or failed to deliver). The paused preview uses it to fall back to
 * the media element; the export has none and keeps seeing errors.
 */
export type FrameRescue = (
  id: string,
  assetId: string,
  srcTime: Micros,
  frame: FrameSource | null,
  failed: boolean
) => Promise<FrameSource | null>

/**
 * Frames a scene needs, keyed by clip id for the video layers and by overlay id for picture-in-picture
 * items. Preview (paused) and export both use it, so a picture looks the same in both.
 */
export async function sceneFrames(scene: Scene, provider: ExactFrameProvider, rescue?: FrameRescue): Promise<Map<string, FrameSource>> {
  const frames = new Map<string, FrameSource>()
  await loadSceneStickers(scene)
  const fetch = async (id: string, assetId: string, srcTime: Micros, lane: string): Promise<FrameSource | null> => {
    let frame: FrameSource | null = null
    let failed = false
    try {
      frame = await provider.getFrame(assetId, srcTime, lane)
    } catch (e) {
      if (!rescue) throw e
      failed = true
    }
    return rescue ? rescue(id, assetId, srcTime, frame, failed) : frame
  }
  for (const [lane, layer] of scene.videos.entries()) {
    const frame = await fetch(layer.clipId, layer.assetId, layer.srcTime, String(lane))
    if (frame) frames.set(layer.clipId, frame)
  }
  for (const layer of scene.overlays) {
    if (layer.item.kind !== 'media') continue
    const frame = await fetch(layer.item.id, layer.item.assetId, layer.srcTime, `overlay:${layer.item.id}`)
    if (frame) frames.set(layer.item.id, frame)
  }
  return frames
}
