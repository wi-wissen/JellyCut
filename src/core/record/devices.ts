// Microphone choices for the picker. Labels are only filled in by the browser after the permission was granted;
// an empty label gets a numbered name in the UI (`unnamed` is the running number). No DOM.

export interface DeviceInfoLike {
  kind: string
  deviceId: string
  label: string
}

export interface MicOption {
  id: string
  /** Browser label, '' while the permission is missing. */
  label: string
  /** 1-based position, for the "Microphone 2" fallback name. */
  unnamed: number
  /** The system default input ("default" id). */
  isDefault: boolean
}

/**
 * Inputs only. Chromium adds virtual "default" and "communications" entries that repeat a real device; the
 * "default" one is kept (it is what the browser uses without a choice, and marks the default) and
 * "communications" is dropped as a duplicate. Firefox has neither and marks nothing: the first device is the default.
 */
export function describeMicrophones(devices: readonly DeviceInfoLike[]): MicOption[] {
  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
  return inputs.map((d, i) => ({
    id: d.deviceId,
    label: d.label,
    unnamed: i + 1,
    isDefault: d.deviceId === 'default' || (i === 0 && !inputs.some((x) => x.deviceId === 'default'))
  }))
}

/** The remembered device when it is still plugged in, else the default, else the first one, else null. */
export function chooseMicrophone(options: readonly MicOption[], remembered: string | null): string | null {
  if (remembered && options.some((o) => o.id === remembered)) return remembered
  return (options.find((o) => o.isDefault) ?? options[0])?.id ?? null
}

/** Chromium labels the default entry "Default - Realtek ..."; the UI marks the default itself, so the prefix goes. */
export function cleanDeviceLabel(label: string): string {
  return label.replace(/^(default|standard|standardmäßig|par défaut)\s*[-–]\s*/i, '').trim()
}
