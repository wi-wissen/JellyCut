import { describe, expect, it } from 'vitest'
import { chooseMicrophone, cleanDeviceLabel, describeMicrophones } from './devices'

const dev = (deviceId: string, label = '', kind = 'audioinput') => ({ kind, deviceId, label })

describe('describeMicrophones', () => {
  it('keeps inputs, drops outputs and the duplicate "communications" entry, and marks the default', () => {
    const list = describeMicrophones([
      dev('default', 'Default - Headset'),
      dev('communications', 'Communications - Headset'),
      dev('a', 'Headset'),
      dev('spk', 'Speakers', 'audiooutput')
    ])
    expect(list.map((o) => o.id)).toEqual(['default', 'a'])
    expect(list.map((o) => o.isDefault)).toEqual([true, false])
  })

  it('treats the first device as the default where the browser lists no "default" entry (Firefox)', () => {
    const list = describeMicrophones([dev('x', 'Mic A'), dev('y', 'Mic B')])
    expect(list.map((o) => o.isDefault)).toEqual([true, false])
  })

  it('keeps empty labels (no permission yet) and numbers them', () => {
    const list = describeMicrophones([dev('x'), dev('y')])
    expect(list.map((o) => [o.label, o.unnamed])).toEqual([['', 1], ['', 2]])
  })
})

describe('chooseMicrophone', () => {
  const options = describeMicrophones([dev('default', 'Default - A'), dev('a', 'A'), dev('b', 'B')])
  it('prefers the remembered device when it is still there', () => {
    expect(chooseMicrophone(options, 'b')).toBe('b')
  })
  it('falls back to the default when the remembered device is gone, and to null without devices', () => {
    expect(chooseMicrophone(options, 'unplugged')).toBe('default')
    expect(chooseMicrophone(options, null)).toBe('default')
    expect(chooseMicrophone([], 'b')).toBeNull()
  })
})

describe('cleanDeviceLabel', () => {
  it('removes the browser default prefix', () => {
    expect(cleanDeviceLabel('Default - Realtek Audio')).toBe('Realtek Audio')
    expect(cleanDeviceLabel('USB Mic')).toBe('USB Mic')
  })
})
