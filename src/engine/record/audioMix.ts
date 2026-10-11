/**
 * Web Audio helpers for the recorder.
 *
 * The recorder only mixes when two sources exist (the voice and the share's own sound), because one MediaRecorder
 * file carries one audio track. With a single source its track is recorded as it is, with no Web Audio in between:
 * a suspended AudioContext produces digital silence (seen in Firefox when the context was not started by a click),
 * and that silence would be recorded without any error.
 */

export interface RecordingContext {
  context: AudioContext
  /** Context states seen so far, "running@0": for the technical details. */
  states: string[]
  /** Resolves true once the context runs, false when it still does not after `ms`. */
  whenRunning(ms: number): Promise<boolean>
  close(): void
}

/**
 * Creates the context and starts it. Call it synchronously from the click that starts the recording (before any
 * await): browsers only let a context run when it is created or resumed during a user gesture.
 */
export function createRecordingContext(now: () => number): RecordingContext | null {
  if (typeof AudioContext === 'undefined') return null
  try {
    const context = new AudioContext()
    const states: string[] = []
    const t0 = now()
    const note = (): void => {
      states.push(`${context.state}@${Math.round(now() - t0)}`)
    }
    note()
    context.addEventListener('statechange', note)
    const resume = (): void => {
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
    }
    resume()
    // Any later gesture on the page (the Stop click is one, a keypress too) may also unlock a context that stayed suspended.
    const retry = (): void => resume()
    window.addEventListener('pointerdown', retry, true)
    window.addEventListener('keydown', retry, true)
    return {
      context,
      states,
      whenRunning: (ms) =>
        new Promise<boolean>((resolve) => {
          if (context.state === 'running') return resolve(true)
          const done = (value: boolean): void => {
            clearTimeout(timer)
            context.removeEventListener('statechange', check)
            resolve(value)
          }
          const check = (): void => {
            if (context.state === 'running') done(true)
          }
          const timer = setTimeout(() => done(context.state === 'running'), ms)
          context.addEventListener('statechange', check)
          resume()
        }),
      close: () => {
        window.removeEventListener('pointerdown', retry, true)
        window.removeEventListener('keydown', retry, true)
        context.removeEventListener('statechange', note)
        void context.close().catch(() => undefined)
      }
    }
  } catch {
    return null
  }
}

/** Mixes the microphone and the share's own sound into one audio track. */
export interface AudioMix {
  track: MediaStreamTrack
  close(): void
}

export function createAudioMix(context: AudioContext, microphone: MediaStreamTrack, system: MediaStreamTrack[]): AudioMix | null {
  try {
    const destination = context.createMediaStreamDestination()
    const nodes: AudioNode[] = [destination]
    const connect = (tracks: MediaStreamTrack[]): void => {
      if (tracks.length === 0) return
      const source = context.createMediaStreamSource(new MediaStream(tracks))
      source.connect(destination)
      nodes.push(source)
    }
    connect([microphone])
    connect(system)
    const track = destination.stream.getAudioTracks()[0]
    if (!track) return null
    return {
      track,
      close: () => {
        track.stop()
        for (const node of nodes) {
          try {
            node.disconnect()
          } catch {
            // already disconnected
          }
        }
      }
    }
  } catch {
    return null
  }
}

/** A level meter on one microphone track. The analyser is a dead end: nothing is played or recorded through it. */
export interface Meter {
  stop(): void
}

const METER_MS = 50

/**
 * Samples the RMS level every 50 ms from a timer (not requestAnimationFrame: that stops when the tab is in the
 * background, which is exactly where it is while another window is being recorded).
 */
export function startLevelMeter(context: AudioContext, track: MediaStreamTrack, onLevel: (level: number) => void): Meter | null {
  try {
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    const source = context.createMediaStreamSource(new MediaStream([track]))
    source.connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += value * value
      onLevel(Math.min(1, Math.sqrt(sum / samples.length)))
    }, METER_MS)
    return {
      stop() {
        clearInterval(timer)
        try {
          source.disconnect()
        } catch {
          // already disconnected
        }
      }
    }
  } catch {
    return null
  }
}
