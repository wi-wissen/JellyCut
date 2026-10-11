/** Mixes the microphone and the share's own sound (when the browser offers it) into one audio track. */
export interface AudioMix {
  track: MediaStreamTrack
  /** Retries after a suspended start (autoplay policy); call from a user gesture when possible. */
  resume(): void
  close(): void
}

const MIC_GAIN = 1
const SYSTEM_GAIN = 1

export function createAudioMix(microphone: MediaStream | null, system: MediaStreamTrack[]): AudioMix | null {
  if (typeof AudioContext === 'undefined') return null
  const micTracks = microphone?.getAudioTracks() ?? []
  if (micTracks.length === 0 && system.length === 0) return null
  try {
    const context = new AudioContext()
    const destination = context.createMediaStreamDestination()
    const connect = (tracks: MediaStreamTrack[], gain: number): void => {
      if (tracks.length === 0) return
      const node = context.createGain()
      node.gain.value = gain
      context.createMediaStreamSource(new MediaStream(tracks)).connect(node)
      node.connect(destination)
    }
    connect(micTracks, MIC_GAIN)
    connect(system, SYSTEM_GAIN)
    const track = destination.stream.getAudioTracks()[0]
    if (!track) {
      void context.close().catch(() => undefined)
      return null
    }
    const resume = (): void => {
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
    }
    context.addEventListener('statechange', resume)
    resume()
    return {
      track,
      resume,
      close: () => {
        context.removeEventListener('statechange', resume)
        track.stop()
        void context.close().catch(() => undefined)
      }
    }
  } catch {
    return null
  }
}
