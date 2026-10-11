import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { AssetKind } from '../../core/project/types'
import { TimeoutError, withTimeout } from '../../core/async/timeout'
import { pickDurationSeconds } from '../../core/media/duration'
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

/** Whole probe; a stalled demuxer or decoder check must not block an import forever. */
export const PROBE_TIMEOUT_MS = 30_000
/** canDecode asks the browser's decoder; some builds never answer for codecs they do not ship. */
const CAN_DECODE_TIMEOUT_MS = 5_000

export interface ProbeOptions {
  /** Length the caller knows (a recording's clock), used when the container has none. */
  durationHintSeconds?: number
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

async function canDecodeWithin(check: Promise<boolean>): Promise<boolean> {
  try {
    return await withTimeout(check, CAN_DECODE_TIMEOUT_MS, 'canDecode')
  } catch {
    return false
  }
}

async function attempt<T>(step: () => Promise<T>): Promise<T | null> {
  try {
    return await step()
  } catch {
    return null
  }
}

/**
 * Reads container metadata only. Never decodes frames, so a 50 minute file is ready in moments.
 * Throws a TimeoutError when the container cannot be read in time; other failures are reported as problems.
 */
export async function probeFile(file: File, options: ProbeOptions = {}): Promise<MediaInfo> {
  if (isImageFile(file)) return probeImage(file)
  return withTimeout(probeMedia(file, options), PROBE_TIMEOUT_MS, 'probe')
}

async function probeMedia(file: File, options: ProbeOptions): Promise<MediaInfo> {
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

    // MediaRecorder output (Firefox and Chromium) has no Duration element: fall back to the last packets.
    const durationSeconds = pickDurationSeconds([
      await attempt(() => input.computeDuration()),
      await attempt(() => (video ?? audio)!.computeDuration()),
      options.durationHintSeconds
    ])
    if (durationSeconds === null) throw new Error('the length of the file is unknown')
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
      const stats = await attempt(() => video.computePacketStats(100))
      fps = stats && stats.averagePacketRate > 0 ? Math.round(stats.averagePacketRate * 1000) / 1000 : undefined
      if (!(await canDecodeWithin(video.canDecode()))) problems.push('cannot-decode-video')
    }
    if (audio) {
      audioCodec = await audio.getCodec()
      if (!(await canDecodeWithin(audio.canDecode()))) problems.push('cannot-decode-audio')
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
  } catch (e) {
    if (e instanceof TimeoutError) throw e
    return {
      kind: 'video', name: file.name, size: file.size, duration: 0, hasAudio: false,
      videoCodec: null, audioCodec: null, problems: ['unsupported-format']
    }
  } finally {
    input.dispose()
  }
}
