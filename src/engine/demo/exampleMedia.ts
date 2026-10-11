import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec
} from 'mediabunny'
import {
  EXAMPLE_FPS,
  EXAMPLE_HEIGHT,
  EXAMPLE_WIDTH,
  exampleFrameCount,
  exampleScene,
  percentOf,
  rgbCss,
  type ExampleClipSpec,
  type ExampleScene
} from '../../core/demo/example'
import { renderMelody } from '../../core/demo/melody'
import { frameStart, MICROS_PER_SECOND } from '../../core/time'

const VIDEO_BITRATE = 3_000_000
const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_CHANNELS = 2
const AUDIO_BITRATE = 128_000
/** Frames drawn before the page gets a chance to paint and respond. */
const FRAMES_PER_SLICE = 4

/** This browser has no video encoder that can write the example. */
export class ExampleUnsupported extends Error {
  constructor() {
    super('This browser cannot encode the example video.')
    this.name = 'ExampleUnsupported'
  }
}

export class ExampleCancelled extends Error {
  constructor() {
    super('Example video cancelled.')
    this.name = 'ExampleCancelled'
  }
}

export interface ExampleEncoders {
  video: VideoCodec
  /** Null when no audio encoder exists; the clips are then made without sound. */
  audio: AudioCodec | null
}

export async function exampleEncoders(): Promise<ExampleEncoders | null> {
  const video = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {
    width: EXAMPLE_WIDTH,
    height: EXAMPLE_HEIGHT,
    bitrate: VIDEO_BITRATE
  })
  if (!video) return null
  const audio = await getFirstEncodableAudioCodec(['aac', 'opus'], {
    numberOfChannels: AUDIO_CHANNELS,
    sampleRate: AUDIO_SAMPLE_RATE,
    bitrate: AUDIO_BITRATE
  })
  return { video, audio }
}

export interface ExampleOptions {
  /** Called with the share of all frames drawn so far, 0..1. */
  onProgress: (fraction: number) => void
  signal: AbortSignal
}

/** Encodes the clips in order, one MP4 file each. Throws ExampleUnsupported, or ExampleCancelled when aborted. */
export async function createExampleFiles(clips: readonly ExampleClipSpec[], options: ExampleOptions): Promise<File[]> {
  const encoders = await exampleEncoders()
  if (!encoders) throw new ExampleUnsupported()
  const totalFrames = clips.reduce((sum, clip) => sum + exampleFrameCount(clip.seconds), 0)
  let doneFrames = 0
  const files: File[] = []
  for (const clip of clips) {
    const file = await encodeClip(clip, encoders, options.signal, () => {
      doneFrames++
      options.onProgress(percentOf(doneFrames, totalFrames) / 100)
    })
    files.push(file)
  }
  return files
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function encodeClip(
  clip: ExampleClipSpec,
  encoders: ExampleEncoders,
  signal: AbortSignal,
  onFrame: () => void
): Promise<File> {
  const canvas = new OffscreenCanvas(EXAMPLE_WIDTH, EXAMPLE_HEIGHT)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExampleUnsupported()

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const videoSource = new CanvasSource(canvas, { codec: encoders.video, bitrate: VIDEO_BITRATE, keyFrameInterval: 2 })
  output.addVideoTrack(videoSource, { frameRate: EXAMPLE_FPS })

  const melody = encoders.audio ? renderMelody(clip.melody, AUDIO_SAMPLE_RATE) : null
  const audioSource =
    encoders.audio && melody ? new AudioSampleSource({ codec: encoders.audio, bitrate: AUDIO_BITRATE }) : null
  if (audioSource) output.addAudioTrack(audioSource)

  await output.start()
  try {
    const frames = exampleFrameCount(clip.seconds)
    const duration = clip.seconds * MICROS_PER_SECOND
    for (let second = 0; second < clip.seconds; second++) {
      for (let index = second * EXAMPLE_FPS; index < Math.min(frames, (second + 1) * EXAMPLE_FPS); index++) {
        if (signal.aborted) throw new ExampleCancelled()
        const start = frameStart(index, EXAMPLE_FPS)
        drawScene(ctx, exampleScene(clip.palette, start, duration))
        await videoSource.add(start / MICROS_PER_SECOND, 1 / EXAMPLE_FPS)
        onFrame()
        if (index % FRAMES_PER_SLICE === 0) await yieldToPage()
      }
      if (audioSource && melody) await addAudioSecond(audioSource, melody, second)
    }
    videoSource.close()
    audioSource?.close()
    await output.finalize()
  } catch (error) {
    await output.cancel().catch(() => undefined)
    throw error
  }
  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('The example video was not written.')
  return new File([buffer], clip.name, { type: 'video/mp4' })
}

/** One second of the melody as a stereo sample; the mono melody is copied to both channels. */
async function addAudioSecond(source: AudioSampleSource, melody: Float32Array, second: number): Promise<void> {
  const start = second * AUDIO_SAMPLE_RATE
  const end = Math.min(melody.length, start + AUDIO_SAMPLE_RATE)
  const data = new Float32Array((end - start) * AUDIO_CHANNELS)
  for (let i = start; i < end; i++) {
    const value = melody[i] ?? 0
    const offset = (i - start) * AUDIO_CHANNELS
    data[offset] = value
    data[offset + 1] = value
  }
  const sample = new AudioSample({
    data,
    format: 'f32',
    numberOfChannels: AUDIO_CHANNELS,
    sampleRate: AUDIO_SAMPLE_RATE,
    timestamp: second
  })
  try {
    await source.add(sample)
  } finally {
    sample.close()
  }
}

function drawScene(ctx: OffscreenCanvasRenderingContext2D, scene: ExampleScene): void {
  const width = EXAMPLE_WIDTH
  const height = EXAMPLE_HEIGHT
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, rgbCss(scene.top))
  sky.addColorStop(1, rgbCss(scene.bottom))
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = rgbCss(scene.shape.color)
  ctx.beginPath()
  ctx.arc(scene.shape.x, scene.shape.y, scene.shape.radius, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 118px sans-serif'
  ctx.fillText(scene.title, width / 2, height * 0.34)
  ctx.font = 'bold 92px sans-serif'
  ctx.fillText(scene.counter, width / 2, height * 0.5)
  ctx.font = '600 48px sans-serif'
  ctx.fillText(scene.clock, width / 2, height * 0.88)
}
