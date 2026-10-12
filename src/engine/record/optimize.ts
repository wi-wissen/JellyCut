import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  VideoSampleSource,
  WebMOutputFormat,
  canEncodeVideo,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoCodec
} from 'mediabunny'
import {
  KEYFRAME_INTERVAL_SECONDS,
  judgeOptimized,
  maxFrameGap,
  maxKeyGap,
  planOptimization,
  type Measure,
  type OptimizeKeep,
  type OptimizeSkip
} from '../../core/record/optimize'
import { meanLuma } from '../../core/record/signal'

export interface OptimizeOptions {
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** `file` is the optimised copy, or null with the reason the raw file stays. Never throws. */
export interface OptimizeResult {
  file: File | null
  reason: 'optimized' | OptimizeSkip | OptimizeKeep
  /** What was measured, for diagnostics and tests. */
  measured?: { before: Measure; after: Measure }
}

// Early in the file only: a lookup deep in a keyframe-less recording would decode everything before it.
const LUMA_TIMES = [0.05, 0.4, 0.9]
const LUMA_SIZE = 16
/** Share of the progress bar for the re-encode; the rest is the check of the result. */
const ENCODE_SHARE = 0.94
/** Output timestamps must increase; a repeated one (seen in Firefox recordings) moves on by this many seconds. */
const MIN_STEP_SECONDS = 0.001

function hasVideoEncoder(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
}

async function sampleLuma(track: InputVideoTrack, duration: number): Promise<number[]> {
  const sink = new CanvasSink(track, { width: LUMA_SIZE, height: LUMA_SIZE, fit: 'fill' })
  const scratch = new OffscreenCanvas(LUMA_SIZE, LUMA_SIZE)
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  const out: number[] = []
  if (!ctx) return out
  for (const time of LUMA_TIMES) {
    if (time >= duration) break
    const wrapped = await sink.getCanvas(time)
    if (!wrapped) continue
    ctx.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, LUMA_SIZE, LUMA_SIZE)
    out.push(meanLuma(ctx.getImageData(0, 0, LUMA_SIZE, LUMA_SIZE).data))
  }
  return out
}

export interface PacketScan {
  durationSeconds: number
  /** Timestamps (seconds) of all pictures and of the keyframes among them, from the packet headers only. */
  times: number[]
  keys: number[]
}

export async function scanPackets(file: File): Promise<PacketScan | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const durationSeconds = await input.computeDuration()
    const keys: number[] = []
    const times: number[] = []
    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      times.push(packet.timestamp)
      if (packet.type === 'key') keys.push(packet.timestamp)
    }
    return { durationSeconds, times, keys }
  } catch {
    return null
  } finally {
    input.dispose()
  }
}

/** Length, picture count, keyframe spacing and brightness of a file, read the way the editor will read it. */
export async function measureVideo(file: File): Promise<Measure | null> {
  const scan = await scanPackets(file)
  if (!scan) return null
  const { durationSeconds, times, keys } = scan
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const luma = (await track.canDecode()) ? await sampleLuma(track, durationSeconds) : []
    return {
      durationSeconds,
      frames: times.length,
      maxKeyGapSeconds: maxKeyGap(keys, durationSeconds),
      maxFrameGapSeconds: maxFrameGap(times),
      luma
    }
  } catch {
    return null
  } finally {
    input.dispose()
  }
}

async function pickCodec(candidates: string[], width: number, height: number, bitrate: number): Promise<VideoCodec | null> {
  for (const codec of candidates as VideoCodec[]) {
    if (await canEncodeVideo(codec, { width, height, bitrate }).catch(() => false)) return codec
  }
  return null
}

/** Copies the sound packets as they are (no second generation of loss), in step with the picture. */
async function copyAudio(track: InputAudioTrack, source: EncodedAudioPacketSource, stop: () => boolean): Promise<void> {
  const config = await track.getDecoderConfig()
  const sink = new EncodedPacketSink(track)
  let first = true
  for await (const packet of sink.packets()) {
    if (stop()) return
    await source.add(packet, first && config ? { decoderConfig: config } : undefined)
    first = false
  }
}

/**
 * Re-encodes the picture of a decoded stream with a keyframe every second. Every frame is passed on once, so the
 * count stays the same. The length of a frame is the distance to the next one: MediaRecorder writes 0 for the last
 * frame of each cluster, which Mediabunny's own Conversion drops as "outside the range" (one frame per second).
 */
async function encodeVideo(
  track: InputVideoTrack,
  source: VideoSampleSource,
  durationSeconds: number,
  report: (fraction: number) => void,
  stop: () => boolean
): Promise<void> {
  const sink = new VideoSampleSink(track)
  let held: Awaited<ReturnType<VideoSampleSink['getSample']>> = null
  let lastTime = -Infinity
  let lastLength = 1 / 30
  const flush = async (length: number): Promise<void> => {
    if (!held) return
    held.setDuration(length)
    lastLength = length
    report(Math.min(1, (held.timestamp + length) / Math.max(durationSeconds, 0.001)))
    const sample = held
    held = null
    try {
      await source.add(sample)
    } finally {
      sample.close()
    }
  }
  try {
    for await (const sample of sink.samples()) {
      if (stop()) {
        sample.close()
        return
      }
      if (sample.timestamp <= lastTime) sample.setTimestamp(lastTime + MIN_STEP_SECONDS)
      if (held) await flush(Math.max(MIN_STEP_SECONDS, sample.timestamp - held.timestamp))
      lastTime = sample.timestamp
      held = sample
    }
    await flush(lastLength)
  } finally {
    held?.close()
  }
}

/**
 * Writes a recording once more as a well-formed file: a keyframe every second, the length and a seek index in the
 * header, timestamps in order. MediaRecorder output has one keyframe and no index, which makes every random access
 * (fine cut, scrubbing, export) decode from the start. The picture is re-encoded (about twice the source bitrate,
 * VP9 or VP8), the sound is copied. The result replaces the raw file only after it was measured against it (see
 * `judgeOptimized`); otherwise `file` is null and the raw file stays.
 */
export async function optimizeRecording(file: File, options: OptimizeOptions = {}): Promise<OptimizeResult> {
  const { onProgress, signal } = options
  if (signal?.aborted) return { file: null, reason: 'canceled' }
  if (!hasVideoEncoder()) return { file: null, reason: 'noEncoder' }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  let output: Output | null = null
  const stop = (): boolean => signal?.aborted === true
  try {
    const track = await input.getPrimaryVideoTrack()
    const before = track ? await measureVideo(file) : null
    const stats = track ? await track.computePacketStats(120).catch(() => null) : null
    const durationSeconds = before?.durationSeconds ?? 0
    const plan = planOptimization({
      durationSeconds,
      sourceBitrate: stats?.averageBitrate ?? (file.size * 8) / Math.max(1, durationSeconds),
      videoCodec: track?.codec ?? null,
      hasVideoEncoder: hasVideoEncoder(),
      sourceMaxKeyGapSeconds: before?.maxKeyGapSeconds ?? null,
      sourceMaxFrameGapSeconds: before?.maxFrameGapSeconds ?? null
    })
    if (typeof plan === 'string') return { file: null, reason: plan }
    if (!track || !before) return { file: null, reason: 'noVideo' }
    const codec = await pickCodec(plan.codecs, track.displayWidth, track.displayHeight, plan.bitrate)
    if (!codec) return { file: null, reason: 'noEncoder' }

    const format = plan.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
    const target = new BufferTarget()
    output = new Output({ format, target })
    const videoSource = new VideoSampleSource({ codec, bitrate: plan.bitrate, keyFrameInterval: KEYFRAME_INTERVAL_SECONDS })
    output.addVideoTrack(videoSource)
    const audioTrack = await input.getPrimaryAudioTrack()
    let audioSource: EncodedAudioPacketSource | null = null
    if (audioTrack?.codec) {
      // Sound that the new container cannot hold as it is stays with the raw file.
      if (!format.getSupportedAudioCodecs().includes(audioTrack.codec)) return { file: null, reason: 'unsupportedCodec' }
      audioSource = new EncodedAudioPacketSource(audioTrack.codec)
      output.addAudioTrack(audioSource)
    }
    await output.start()

    await Promise.all([
      encodeVideo(track, videoSource, durationSeconds, (f) => onProgress?.(f * ENCODE_SHARE), stop).then(() => videoSource.close()),
      audioSource && audioTrack ? copyAudio(audioTrack, audioSource, stop).then(() => audioSource.close()) : Promise.resolve()
    ])
    if (stop()) {
      await output.cancel().catch(() => undefined)
      return { file: null, reason: 'canceled' }
    }
    await output.finalize()
    const bytes = target.buffer
    if (!bytes) return { file: null, reason: 'failed' }

    const optimized = new File([bytes], file.name, { type: plan.container === 'mp4' ? 'video/mp4' : 'video/webm', lastModified: file.lastModified })
    const after = await measureVideo(optimized)
    if (stop()) return { file: null, reason: 'canceled' }
    if (!after) return { file: null, reason: 'mismatch' }
    const measured = { before, after }
    if (judgeOptimized(before, after) !== 'ok') return { file: null, reason: 'mismatch', measured }
    onProgress?.(1)
    return { file: optimized, reason: 'optimized', measured }
  } catch {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined)
    return { file: null, reason: stop() ? 'canceled' : 'failed' }
  } finally {
    input.dispose()
  }
}

