import type { Scene } from '../../core/render/types'
import type { ExactFrameProvider } from '../media/frames'
import type { FrameSource } from './compositor'

/**
 * Frames a scene needs, keyed by clip id for the video layers and by overlay id for picture-in-picture
 * items. Preview (paused) and export both use it, so a picture looks the same in both.
 */
export async function sceneFrames(scene: Scene, provider: ExactFrameProvider): Promise<Map<string, FrameSource>> {
  const frames = new Map<string, FrameSource>()
  for (const [lane, layer] of scene.videos.entries()) {
    const frame = await provider.getFrame(layer.assetId, layer.srcTime, String(lane))
    if (frame) frames.set(layer.clipId, frame)
  }
  for (const layer of scene.overlays) {
    if (layer.item.kind !== 'media') continue
    const frame = await provider.getFrame(layer.item.assetId, layer.srcTime, `overlay:${layer.item.id}`)
    if (frame) frames.set(layer.item.id, frame)
  }
  return frames
}
