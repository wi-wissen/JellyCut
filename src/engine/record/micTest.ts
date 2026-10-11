import { describeMicrophones, type MicOption } from '../../core/record/devices'
import { createRecordingContext, startLevelMeter } from './audioMix'

/** Constraints for a microphone, shared by the recorder and the test so both open the same device the same way. */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true }

export function microphoneConstraints(deviceId: string | null): MediaTrackConstraints {
  return deviceId ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } } : AUDIO_CONSTRAINTS
}

/** Input devices as the browser lists them now. Labels are empty until a microphone permission was granted. */
export async function listMicrophones(): Promise<MicOption[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return describeMicrophones(devices)
  } catch {
    return []
  }
}

/** True when the permission is known to be granted already (Chromium and Firefox 120+); false when unknown or not granted. */
export async function microphonePermissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

export interface MicTest {
  /** The device that is really open, '' when the browser does not say. */
  deviceId: string
  /** False while the audio context is suspended: a flat meter then says nothing about the microphone. */
  running(): boolean
  stop(): void
}

export interface MicTestOptions {
  deviceId: string | null
  onLevel: (level: number) => void
  /** The device ended by itself (unplugged). */
  onEnded?: () => void
}

/**
 * Opens the microphone only to show its level, before any recording. Call it from a click (or when the permission is
 * already granted) so the context may start. Throws the browser's error (NotAllowedError, NotFoundError, ...).
 */
export async function startMicTest(options: MicTestOptions): Promise<MicTest> {
  // Created before the permission prompt: a click can unlock it, the prompt's answer may come too late for that.
  const recordingContext = createRecordingContext(() => performance.now())
  let stream: MediaStream
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(options.deviceId), video: false })
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      if (!options.deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw e
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false })
    }
  } catch (e) {
    recordingContext?.close()
    throw e
  }
  const track = stream.getAudioTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    recordingContext?.close()
    throw new DOMException('no audio track', 'NotFoundError')
  }
  const onEnded = (): void => options.onEnded?.()
  track.addEventListener('ended', onEnded)
  const meter = recordingContext ? startLevelMeter(recordingContext.context, track, options.onLevel) : null
  if (recordingContext) void recordingContext.whenRunning(500)
  return {
    deviceId: track.getSettings().deviceId ?? '',
    running: () => recordingContext?.context.state === 'running',
    stop() {
      track.removeEventListener('ended', onEnded)
      meter?.stop()
      stream.getTracks().forEach((t) => t.stop())
      recordingContext?.close()
    }
  }
}
