import { VideoSampleSink, type EncodedPacketSink, type InputVideoTrack, type VideoSample } from 'mediabunny'
import { frameEnd } from '../../core/media/frameLookup'
import { keyAtOrBefore } from '../../core/media/keyList'
import {
  MAX_RUNS,
  firstMissing,
  frameBytes,
  passFraction,
  pickRun,
  thumbSize,
  wantsFull,
  wantsThumb,
  type FullContext,
  type ScanWant
} from '../../core/media/scanPlan'
import type { TimedCache, TimedEntry } from '../../core/media/timedCache'
import type { Micros } from '../../core/time'
import { readKeyTimes } from './keyframes'

export type CachedFrame = HTMLCanvasElement | OffscreenCanvas

export interface SparseCaches {
  full: TimedCache<CachedFrame>
  thumbs: TimedCache<CachedFrame>
}

/** One forward decode from a keyframe. Kept so the next lookup behind it continues instead of starting over. */
interface Run {
  key: Micros
  iterator: AsyncGenerator<VideoSample, void, undefined>
  /** The sample after the last delivered frame (read ahead to know where the delivered frame ends). */
  pending: VideoSample | null
  nextStart: Micros
  done: boolean
  lastThumb: Micros | null
  /** Running average of the distance between the pictures passed so far. */
  spacing: Micros
  lastStart: Micros | null
}

/** What the caller of `warm` wants kept; a lookup inside this window is served by the same pass. */
export interface ScanHint {
  want: ScanWant
  options: WarmOptions
}

export interface WarmOptions {
  onProgress?: (fraction: number) => void
  /** Checked between frames; a stale pass stops and leaves its run in place for later. */
  stale?: () => boolean
}

interface AdvanceOptions extends WarmOptions {
  /** Decode only: leave nothing in the caches (positioning a run). */
  discard?: boolean
}

const micros = (seconds: number): Micros => Math.round(seconds * 1_000_000)

function newCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height)
}

/**
 * Random access for files with few keyframes (MediaRecorder WebM: one keyframe at the start). The decoder can only go
 * forward, so every frame passed on the way leaves a small picture, the frames just before a looked-up time stay at
 * full size, and runs (decoder positions) are kept: a lookup behind a run's position continues it. Work on one asset
 * is serialised, so two callers never decode the same stretch twice.
 */
export class SparseReader {
  private sink: VideoSampleSink
  private keys: Promise<Micros[]> | null = null
  private runs: Run[] = []
  private chain: Promise<unknown> = Promise.resolve()
  private disposed = false
  /** Frames decoded for the caches (visible for tests and diagnostics). */
  decoded = 0
  passes = 0

  constructor(
    private group: string,
    track: InputVideoTrack,
    private packets: EncodedPacketSink,
    private caches: SparseCaches,
    private hint: () => ScanHint | null
  ) {
    this.sink = new VideoSampleSink(track)
  }

  get runCount(): number {
    return this.runs.length
  }

  /** Jobs waiting for their turn; background work gives way as soon as there is one. */
  private queued = 0

  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    this.queued++
    const run = (): Promise<T> => {
      this.queued--
      return job()
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    return result
  }

  private keyList(): Promise<Micros[]> {
    this.keys ??= readKeyTimes(this.packets)
    return this.keys
  }

  /** The frame shown at `lookup`, decoded forward from the keyframe before it (or taken from the cache). */
  frameAt(lookup: Micros): Promise<TimedEntry<CachedFrame> | null> {
    return this.exclusive(async () => {
      let hit = this.caches.full.at(this.group, lookup)
      if (hit || this.disposed) return hit
      // A lookup inside the window of a pending `warm` runs that pass first: one forward decode serves both.
      const hint = this.hint()
      if (hint && lookup >= hint.want.thumbFrom && lookup <= hint.want.thumbTo) {
        await this.pass(hint.want, hint.options)
        hit = this.caches.full.at(this.group, lookup)
        if (hit) return hit
      }
      if (!(await this.reach(lookup, lookup, hint?.want ?? null, true))) return null
      return this.caches.full.at(this.group, lookup)
    })
  }

  /** Makes sure the caches hold the wanted window (one forward pass if they do not). Always true: the file is sparse. */
  warm(want: ScanWant, options: WarmOptions = {}): Promise<boolean> {
    return this.exclusive(async () => {
      await this.pass(want, options)
      return true
    })
  }

  private async pass(want: ScanWant, options: WarmOptions): Promise<boolean> {
    if (this.disposed || options.stale?.()) return false
    const { thumbs, full } = this.caches
    let moved = false
    // The big pictures first, with the run that stops right behind them (a later step continues from there) ...
    const missingFull = firstMissing((t) => full.has(this.group, t), want.fullFrom, want.fullTo, want.step)
    if (missingFull !== null) {
      this.passes++
      moved = await this.reach(missingFull, want.fullTo, want, false, options)
    }
    // ... then the thumbnails ahead of the cut, with whichever run is closest behind them.
    const missingThumb = firstMissing((t) => thumbs.has(this.group, t) || full.has(this.group, t), want.thumbFrom, want.thumbTo, want.step)
    if (missingThumb !== null && !options.stale?.()) {
      this.passes++
      moved = (await this.reach(missingThumb, want.thumbTo, want, false, options)) || moved
    }
    // The run that fetched the thumbnails ended ahead of the cut; put a second one behind the pictures for stepping.
    if (moved && !options.stale?.()) void this.park(want)
    return moved
  }

  /**
   * In the background: decodes (and discards) up to the big pictures with a run of its own, so the next step forward
   * continues from there instead of starting at the first keyframe. Gives way to any waiting request.
   */
  private park(want: ScanWant): Promise<void> {
    return this.exclusive(async () => {
      if (this.disposed || this.queued > 0) return
      const keys = await this.keyList()
      const key = keyAtOrBefore(keys, want.fullFrom) ?? keys[0]
      if (key === undefined) return
      if (pickRun(this.runs, key, want.fullFrom) >= 0) return
      await this.reach(want.fullFrom, want.fullFrom, null, false, { discard: true, stale: () => this.queued > 0 })
    })
  }

  /** Continues or starts a run so that the frame covering `target` was delivered, beginning at or before `needFrom`. */
  private async reach(needFrom: Micros, target: Micros, want: ScanWant | null, ring: boolean, options: AdvanceOptions = {}): Promise<boolean> {
    const keys = await this.keyList()
    const key = keyAtOrBefore(keys, needFrom) ?? keys[0]
    if (key === undefined) return false
    let index = pickRun(this.runs, key, needFrom)
    if (index < 0) {
      while (this.runs.length >= MAX_RUNS) this.closeRun(this.runs.shift())
      this.runs.push({ key, iterator: this.sink.samples(key / 1_000_000), pending: null, nextStart: key, done: false, lastThumb: null, spacing: 0, lastStart: null })
      index = this.runs.length - 1
    }
    const run = this.runs.splice(index, 1)[0]!
    // Most recently used last, so the oldest one is closed first.
    this.runs.push(run)
    return this.advance(run, target, want, ring, options)
  }

  private async advance(run: Run, target: Micros, want: ScanWant | null, ring: boolean, options: AdvanceOptions): Promise<boolean> {
    let moved = false
    const key = run.key
    while (!run.done) {
      if (this.disposed || options.stale?.()) break
      const current = run.pending ?? (await run.iterator.next()).value ?? null
      run.pending = null
      if (!current) {
        run.done = true
        break
      }
      const following = (await run.iterator.next()).value ?? null
      const start = micros(current.timestamp)
      const next = following ? micros(following.timestamp) : null
      try {
        if (!options.discard) {
          const end = frameEnd(start, micros(current.duration), next)
          this.keep(run, current, start, end, want, {
            covers: next === null || (next > target && start <= target),
            ringTarget: ring ? target : null,
            spacing: run.spacing
          })
        }
      } finally {
        current.close()
      }
      if (run.lastStart !== null && start > run.lastStart) {
        const gap = start - run.lastStart
        run.spacing = run.spacing === 0 ? gap : Math.round(run.spacing * 0.8 + gap * 0.2)
      }
      run.lastStart = start
      moved = true
      this.decoded++
      run.pending = following
      if (this.disposed) this.closeRun(run)
      run.done = following === null
      if (next !== null) run.nextStart = next
      options.onProgress?.(passFraction(key, start, target))
      if (next !== null && next > target) break
    }
    if (run.done) {
      // A finished run cannot deliver anything again; forget it.
      this.runs = this.runs.filter((r) => r !== run)
      this.closeRun(run)
    }
    return moved
  }

  private keep(run: Run, sample: VideoSample, start: Micros, end: Micros, want: ScanWant | null, context: FullContext): void {
    const width = sample.displayWidth
    const height = sample.displayHeight
    if (wantsFull(start, context, want)) {
      const canvas = newCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        sample.draw(ctx, 0, 0, width, height)
        this.caches.full.put(this.group, start, end, canvas, frameBytes(width, height))
      }
    }
    if (wantsThumb(start, run.lastThumb, want, context.ringTarget)) {
      const size = thumbSize(width, height)
      const small = newCanvas(size.width, size.height)
      const ctx = small.getContext('2d')
      if (ctx) {
        sample.draw(ctx, 0, 0, size.width, size.height)
        this.caches.thumbs.put(this.group, start, end, small, frameBytes(size.width, size.height))
        run.lastThumb = start
      }
    }
  }

  /** Ends a run's decoder and releases the picture it read ahead (an unclosed one is reported when it is collected). */
  private closeRun(run: Run | undefined): void {
    if (!run) return
    run.pending?.close()
    run.pending = null
    run.done = true
    void run.iterator.return().catch(() => undefined)
  }

  dispose(): void {
    this.disposed = true
    for (const run of this.runs) this.closeRun(run)
    this.runs = []
    this.caches.full.dropGroup(this.group)
    this.caches.thumbs.dropGroup(this.group)
  }
}
