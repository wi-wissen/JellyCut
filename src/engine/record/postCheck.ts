import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input } from 'mediabunny'
import { LevelAccumulator, meanLuma, type RecordingCheck } from '../../core/record/signal'

/** Only the start of the file is decoded: a quarter of a minute of sound and a few pictures are enough to tell. */
const MAX_AUDIO_SECONDS = 15
const FRAME_TIMES = [0.3, 1, 2]
const FRAME_SIZE = 16

/**
 * Measures the finished recording the way the editor will read it (same decoder as import, preview and export), so
 * "the file is silent" and "the file is black" are facts about the file and not guesses from the live meters.
 * Never throws: a file that cannot be measured returns null.
 */
export async function checkRecording(file: File): Promise<RecordingCheck | null> {
  let input: Input | null = null
  try {
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const result: RecordingCheck = {
      hasAudioTrack: false,
      audioPeak: 0,
      audioRms: 0,
      audioSeconds: 0,
      hasVideoTrack: false,
      frameLuma: []
    }

    const audio = await input.getPrimaryAudioTrack()
    if (audio && (await audio.canDecode())) {
      result.hasAudioTrack = true
      const levels = new LevelAccumulator()
      const sink = new AudioSampleSink(audio)
      for await (const sample of sink.samples(0, MAX_AUDIO_SECONDS)) {
        const channels: Float32Array[] = []
        for (let c = 0; c < sample.numberOfChannels; c++) {
          const plane = new Float32Array(sample.numberOfFrames)
          sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
          channels.push(plane)
        }
        levels.push(channels)
        result.audioSeconds = Math.max(result.audioSeconds, sample.timestamp + sample.duration)
        sample.close()
      }
      result.audioPeak = levels.peak
      result.audioRms = levels.rms
    } else if (audio) {
      // A track the browser cannot decode cannot be judged; treat it as present and audible.
      result.hasAudioTrack = true
      result.audioPeak = 1
    }

    const video = await input.getPrimaryVideoTrack()
    if (video && (await video.canDecode()) && typeof document !== 'undefined') {
      result.hasVideoTrack = true
      const sink = new CanvasSink(video, { width: FRAME_SIZE, height: FRAME_SIZE, fit: 'fill' })
      const scratch = document.createElement('canvas')
      scratch.width = FRAME_SIZE
      scratch.height = FRAME_SIZE
      const context = scratch.getContext('2d', { willReadFrequently: true })
      if (context) {
        for (const time of FRAME_TIMES) {
          const wrapped = await sink.getCanvas(time)
          if (!wrapped) continue
          context.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, FRAME_SIZE, FRAME_SIZE)
          result.frameLuma.push(meanLuma(context.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data))
        }
      }
    }
    return result
  } catch {
    return null
  } finally {
    input?.dispose()
  }
}
