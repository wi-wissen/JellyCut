import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec
} from 'mediabunny'
import { clampSamples, mixSegmentInto, type Pcm } from '../../core/audio/pcm'
import { planAudioSegments, type AudioSegment } from '../../core/audio/mix'
import { AUDIO_BITRATE, outputSize, totalFrames, videoBitrate, type ExportOptions } from '../../core/export/presets'
import { emptyPhases, estimateCodecOf, profileExport, type PhaseSeconds } from '../../core/export/estimate'
import { ExportEta } from '../../core/export/eta'
import type { Project } from '../../core/project/types'
import { buildScene, planTimeline, type PlannedTimeline } from '../../core/render/scene'
import { frameStart, type Micros } from '../../core/time'
import { ExactFrameProvider } from '../media/frames'
import { Compositor } from '../render/compositor'
import { sceneFrames } from '../render/sceneFrames'

export interface ExportRequest {
  project: Project
  /** Files by asset id. Assets without a file are skipped (their clips render as background only). */
  files: Record<string, File>
  options: ExportOptions
}

export interface ExportProgress {
  frame: number
  totalFrames: number
  /** 0..1 */
  fraction: number
  elapsedMs: number
  /** Estimated remaining time, null while too little has been done to tell. Smoothed, see ExportEta. */
  etaMs: number | null
  /** Seconds spent so far per phase (measured on the main loop). */
  phases?: PhaseSeconds
}

export interface ExportResult {
  blob: Blob
  mimeType: string
  extension: 'mp4'
  videoCodec: string
  audioCodec: string | null
  frames: number
  elapsedMs: number
  /** Measured seconds per phase, for the calibration and the details of the dialog. */
  phases: PhaseSeconds
}

/** Set by the page: while the tab is hidden the browser throttles the export, so its progress is not timed. */
export interface ExportControl {
  hidden: boolean
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelled'
  }
}

export class ExportUnsupported extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportUnsupported'
  }
}

const OUT_RATE = 48_000
const OUT_CHANNELS = 2
/** Audio is mixed and written in blocks of this length to keep memory bounded on long projects. */
const AUDIO_CHUNK: Micros = 5_000_000
/** Extra source audio decoded around a block so interpolation at the edges has neighbours. */
const AUDIO_PAD: Micros = 50_000

/** Which codecs this browser can encode for the given output; used to decide before the dialog offers anything. */
export async function checkEncoders(width: number, height: number, bitrate: number) {
  const video = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height, bitrate })
  const audio = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: OUT_CHANNELS, sampleRate: OUT_RATE, bitrate: AUDIO_BITRATE })
  return { video, audio }
}

export async function runExport(
  req: ExportRequest,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  control: ExportControl = { hidden: false }
): Promise<ExportResult> {
  const started = performance.now()
  const { project, options } = req
  const planned = planTimeline(project)
  const duration = planned.duration
  if (duration <= 0) throw new ExportUnsupported('The project is empty.')

  const { width, height } = outputSize(project.format.ratio, options.resolution)
  const fps = options.fps
  const frames = totalFrames(duration, fps)
  const bitrate = videoBitrate(width, height, fps, options.quality)
  const codecs = await checkEncoders(width, height, bitrate)
  if (!codecs.video) throw new ExportUnsupported('This browser cannot encode video. Please use Chrome or Edge.')

  const segments = planAudioSegments(project, planned).filter((s) => req.files[s.assetId])
  const audioCodec = segments.length > 0 ? codecs.audio : null

  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })
  const canvas = new OffscreenCanvas(width, height)
  const compositor = new Compositor(canvas)
  compositor.resize(width, height)
  const videoSource = new CanvasSource(canvas, { codec: codecs.video, bitrate, keyFrameInterval: 2 })
  output.addVideoTrack(videoSource, { frameRate: fps })
  let audioSource: AudioSampleSource | null = null
  if (audioCodec) {
    audioSource = new AudioSampleSource({ codec: audioCodec, bitrate: AUDIO_BITRATE })
    output.addAudioTrack(audioSource)
  }

  const provider = createFrameProvider(project, req.files)
  const audioReader = new AudioReader(req.files)
  const frameDuration = 1 / fps
  const measured = emptyPhases()
  const profile = profileExport({
    project,
    planned,
    width,
    height,
    fps,
    durationMicros: duration,
    kind: 'mp4',
    codec: estimateCodecOf(codecs.video),
    withWeights: true
  })
  const eta = new ExportEta(profile.frameWeights, frames)
  const writeAudio = async (source: AudioSampleSource, from: Micros, to: Micros): Promise<void> => {
    const a0 = performance.now()
    await writeAudioChunk(source, audioReader, segments, from, to)
    measured.audio += (performance.now() - a0) / 1000
  }

  try {
    await output.start()
    measured.fixed += (performance.now() - started) / 1000
    let audioCursor: Micros = 0
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new ExportCancelled()
      const t = frameStart(i, fps)

      if (audioSource) {
        // Keep audio roughly in step with video so the muxer never has to buffer far ahead.
        while (audioCursor < duration && audioCursor <= t) {
          const end = Math.min(audioCursor + AUDIO_CHUNK, duration)
          await writeAudio(audioSource, audioCursor, end)
          audioCursor = end
        }
      }

      await drawFrame(compositor, provider, project, planned, t, measured)
      const e0 = performance.now()
      await videoSource.add(t / 1_000_000, frameDuration)
      measured.encode += (performance.now() - e0) / 1000

      if ((i & 7) === 0 || i === frames - 1) {
        const elapsedMs = performance.now() - started
        const done = i + 1
        onProgress({
          frame: done,
          totalFrames: frames,
          fraction: done / frames,
          elapsedMs,
          etaMs: eta.update(elapsedMs, done, control.hidden),
          phases: { ...measured }
        })
      }
    }
    if (audioSource) {
      while (audioCursor < duration) {
        const end = Math.min(audioCursor + AUDIO_CHUNK, duration)
        await writeAudio(audioSource, audioCursor, end)
        audioCursor = end
      }
    }
    if (signal.aborted) throw new ExportCancelled()
    const f0 = performance.now()
    await output.finalize()
    measured.fixed += (performance.now() - f0) / 1000
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined)
    throw error
  } finally {
    compositor.dispose()
    audioReader.dispose()
    await provider.dispose()
  }

  const buffer = target.buffer
  if (!buffer) throw new Error('The encoder produced no data.')
  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    mimeType: 'video/mp4',
    extension: 'mp4',
    videoCodec: codecs.video,
    audioCodec,
    frames,
    elapsedMs: performance.now() - started,
    phases: measured
  }
}

/** Frame source for every asset that has a file; assets without one render as background only. */
export function createFrameProvider(project: Project, files: Record<string, File>): ExactFrameProvider {
  const provider = new ExactFrameProvider()
  for (const asset of project.assets) {
    const file = files[asset.id]
    if (file) provider.setFile(asset.id, file, asset.kind === 'image')
  }
  return provider
}

/**
 * Draws the scene at time t onto the compositor. Shared by the MP4 and the GIF export. With `timing`, the
 * seconds spent waiting for frames (decode) and drawing are added to it.
 */
export async function drawFrame(
  compositor: Compositor,
  provider: ExactFrameProvider,
  project: Project,
  planned: PlannedTimeline,
  t: Micros,
  timing?: PhaseSeconds
): Promise<void> {
  const t0 = performance.now()
  const scene = buildScene(project, planned, t)
  const t1 = performance.now()
  const frames = await sceneFrames(scene, provider)
  const t2 = performance.now()
  compositor.draw(scene, frames)
  if (timing) {
    timing.decode += (t2 - t1) / 1000
    timing.draw += (t1 - t0 + performance.now() - t2) / 1000
  }
}

async function writeAudioChunk(
  source: AudioSampleSource,
  reader: AudioReader,
  segments: AudioSegment[],
  start: Micros,
  end: Micros
): Promise<void> {
  const length = Math.max(1, Math.round(((end - start) * OUT_RATE) / 1_000_000))
  const out = Array.from({ length: OUT_CHANNELS }, () => new Float32Array(length))
  for (const seg of segments) {
    if (seg.timelineEnd <= start || seg.timelineStart >= end) continue
    const from = Math.max(start, seg.timelineStart)
    const to = Math.min(end, seg.timelineEnd)
    const srcFrom = seg.srcStart + (from - seg.timelineStart) * seg.speed - AUDIO_PAD
    const srcTo = seg.srcStart + (to - seg.timelineStart) * seg.speed + AUDIO_PAD
    const pcm = await reader.read(seg.assetId, Math.max(0, srcFrom), srcTo)
    if (pcm) mixSegmentInto(out, start, OUT_RATE, seg, pcm)
  }
  clampSamples(out)
  const data = new Float32Array(length * OUT_CHANNELS)
  for (let c = 0; c < OUT_CHANNELS; c++) data.set(out[c]!, c * length)
  const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: OUT_CHANNELS, sampleRate: OUT_RATE, timestamp: start / 1_000_000 })
  try {
    await source.add(sample)
  } finally {
    sample.close()
  }
}

/** Decodes only the requested time range of an asset's audio into planar float PCM. */
class AudioReader {
  private sinks = new Map<string, Promise<{ input: Input; sink: AudioSampleSink } | null>>()

  constructor(private files: Record<string, File>) {}

  private open(assetId: string) {
    let entry = this.sinks.get(assetId)
    if (!entry) {
      entry = (async () => {
        const file = this.files[assetId]
        if (!file) return null
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
        const track = await input.getPrimaryAudioTrack()
        if (!track || !(await track.canDecode())) {
          input.dispose()
          return null
        }
        return { input, sink: new AudioSampleSink(track) }
      })()
      this.sinks.set(assetId, entry)
    }
    return entry
  }

  async read(assetId: string, from: Micros, to: Micros): Promise<Pcm | null> {
    const entry = await this.open(assetId)
    if (!entry) return null
    const parts: { channels: Float32Array[]; rate: number; startTime: Micros }[] = []
    for await (const sample of entry.sink.samples(from / 1_000_000, to / 1_000_000)) {
      const channels: Float32Array[] = []
      for (let c = 0; c < sample.numberOfChannels; c++) {
        const plane = new Float32Array(sample.numberOfFrames)
        sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
        channels.push(plane)
      }
      parts.push({ channels, rate: sample.sampleRate, startTime: sample.microsecondTimestamp })
      sample.close()
    }
    const first = parts[0]
    if (!first) return null
    const total = parts.reduce((n, p) => n + p.channels[0]!.length, 0)
    const merged = first.channels.map(() => new Float32Array(total))
    let offset = 0
    for (const part of parts) {
      part.channels.forEach((plane, c) => merged[c]!.set(plane, offset))
      offset += part.channels[0]!.length
    }
    return { sampleRate: first.rate, startTime: first.startTime, channels: merged }
  }

  dispose(): void {
    for (const entry of this.sinks.values()) void entry.then((e) => e?.input.dispose())
    this.sinks.clear()
  }
}
