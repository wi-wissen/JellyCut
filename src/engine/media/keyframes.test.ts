import { beforeAll, describe, expect, it } from 'vitest'
import { KeyframeIndex } from './keyframes'

// The project has no Node typings, so the file system module is loaded without a static type.
const fixtures = new Map<string, File>()
beforeAll(async () => {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  for (const name of ['recorded-firefox-vp8.webm', 'recorded-chromium-vp9.webm', 'recorded-offset-vfr.webm']) {
    const bytes: Uint8Array<ArrayBuffer> = fs.readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url))
    fixtures.set(name, new File([bytes], name, { type: 'video/webm' }))
  }
})
const fixture = (name: string): File => fixtures.get(name)!

// MediaRecorder output: no cues, a cluster per second, a single keyframe at the start of the file.
describe.each([
  ['recorded-firefox-vp8.webm', 0],
  ['recorded-chromium-vp9.webm', 0],
  ['recorded-offset-vfr.webm', 300_000]
])('KeyframeIndex on %s', (name, firstKey) => {
  it('finds the keyframe before any time, in any order of lookups', async () => {
    const index = await KeyframeIndex.open(fixture(name))
    expect(index).not.toBeNull()
    for (const t of [2_400_000, 1_100_000, 1_900_000, 500_000, 2_200_000, 1_500_000]) {
      expect(await index!.before(t)).toBe(firstKey)
    }
    index!.dispose()
  })

  it('has no keyframe before the first one, and none after the only one', async () => {
    const index = await KeyframeIndex.open(fixture(name))
    expect(await index!.before(firstKey - 1)).toBeNull()
    expect(await index!.before(2_400_000)).toBe(firstKey)
    expect(await index!.after(2_000_000)).toBeNull()
    expect(await index!.after(firstKey - 1)).toBe(firstKey)
    expect(await index!.inRange(0, 2_500_000)).toEqual([firstKey])
    expect(await index!.inRange(2_000_000, 2_500_000)).toEqual([])
    index!.dispose()
  })
})
