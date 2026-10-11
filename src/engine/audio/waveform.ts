import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'
import { createPeakAccumulator, type Waveform } from '../../core/audio/peaks'

export interface WaveformProgress {
  /** 0..1, based on decoded time versus the file duration. */
  fraction: number
}

/**
 * Decodes the audio of a file once, streaming, and keeps only peak values (a 50 minute recording
 * would be over 1 GB as raw samples). Returns null when the file has no decodable audio.
 */
export async function computeWaveform(
  file: File,
  onProgress?: (p: WaveformProgress) => void,
  signal?: AbortSignal
): Promise<Waveform | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return null
    const total = (await input.computeDuration()) || 1
    const sink = new AudioSampleSink(track)
    let accumulator: ReturnType<typeof createPeakAccumulator> | null = null
    let rate = 0
    let lastReport = 0
    for await (const sample of sink.samples()) {
      if (signal?.aborted) {
        sample.close()
        return null
      }
      if (!accumulator || rate !== sample.sampleRate) {
        if (accumulator) {
          sample.close()
          break
        }
        rate = sample.sampleRate
        accumulator = createPeakAccumulator(rate)
      }
      const channels: Float32Array[] = []
      for (let c = 0; c < sample.numberOfChannels; c++) {
        const plane = new Float32Array(sample.numberOfFrames)
        sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
        channels.push(plane)
      }
      accumulator.push(channels)
      const end = sample.timestamp + sample.duration
      sample.close()
      if (onProgress && end - lastReport > 1) {
        lastReport = end
        onProgress({ fraction: Math.min(1, end / total) })
      }
    }
    onProgress?.({ fraction: 1 })
    return accumulator ? accumulator.finish() : null
  } finally {
    input.dispose()
  }
}
