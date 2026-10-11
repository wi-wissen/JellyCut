import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { AssetKind } from '../../core/project/types'
import { secondsToMicros, type Micros } from '../../core/time'

export type ProbeProblem = 'unsupported-format' | 'cannot-decode-video' | 'cannot-decode-audio' | 'no-media'

export interface MediaInfo {
  kind: AssetKind
  name: string
  size: number
  /** Whole microseconds; images have 0. */
  duration: Micros
  /** Display size after rotation (what the user sees). */
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  videoCodec: string | null
  audioCodec: string | null
  /** Empty when the browser can use the file. */
  problems: ProbeProblem[]
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'])

function extension(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extension(file.name))
}

async function probeImage(file: File): Promise<MediaInfo> {
  const base: MediaInfo = {
    kind: 'image', name: file.name, size: file.size, duration: 0, hasAudio: false,
    videoCodec: null, audioCodec: null, problems: []
  }
  try {
    const bitmap = await createImageBitmap(file)
    const info = { ...base, width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return info
  } catch {
    return { ...base, problems: ['unsupported-format'] }
  }
}

/**
 * Reads container metadata only. Never decodes frames, so a 50 minute file is ready in moments.
 */
export async function probeFile(file: File): Promise<MediaInfo> {
  if (isImageFile(file)) return probeImage(file)

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    if (!video && !audio) {
      return {
        kind: 'video', name: file.name, size: file.size, duration: 0, hasAudio: false,
        videoCodec: null, audioCodec: null, problems: ['no-media']
      }
    }

    const durationSeconds = await input.computeDuration()
    const problems: ProbeProblem[] = []
    let width: number | undefined
    let height: number | undefined
    let fps: number | undefined
    let videoCodec: string | null = null
    let audioCodec: string | null = null

    if (video) {
      videoCodec = await video.getCodec()
      width = await video.getDisplayWidth()
      height = await video.getDisplayHeight()
      const stats = await video.computePacketStats(100)
      fps = stats.averagePacketRate > 0 ? Math.round(stats.averagePacketRate * 1000) / 1000 : undefined
      if (!(await video.canDecode())) problems.push('cannot-decode-video')
    }
    if (audio) {
      audioCodec = await audio.getCodec()
      if (!(await audio.canDecode())) problems.push('cannot-decode-audio')
    }

    return {
      kind: video ? 'video' : 'audio',
      name: file.name,
      size: file.size,
      duration: secondsToMicros(durationSeconds),
      width, height, fps,
      hasAudio: audio !== null,
      videoCodec, audioCodec,
      problems
    }
  } catch {
    return {
      kind: 'video', name: file.name, size: file.size, duration: 0, hasAudio: false,
      videoCodec: null, audioCodec: null, problems: ['unsupported-format']
    }
  } finally {
    input.dispose()
  }
}
