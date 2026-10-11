<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import turtleUrl from '../../assets/photos/turtle.jpg'
import { changedMask, storedShares } from '../../core/learn/demo'
import {
  changeKinds,
  INSIDE_CHANGE,
  NEWLY_COVERED,
  polygonMask,
  removeSubject,
  renderFlipbook,
  shiftMask,
  UNCOVERED,
  type Polygon
} from '../../core/learn/flipbook'
import { formatNumber } from '../numberFormat'

const W = 320
const H = 180
const SOURCE_W = 1600
const SOURCE_H = 894
const FRAMES = 12
const THRESHOLD = 12
const KEYFRAME_OPTIONS = [2, 4, 8, 12]
// Pixels the turtle swims per frame, for the motion slider (0 = still). Big enough that both edges show.
const MOTION_SHIFT = [0, 6, 12, 18, 24]
// Outline of the turtle in the 1600 x 894 photo, drawn a little generously.
const TURTLE: Polygon = [
  [190, 545], [200, 500], [250, 462], [330, 440], [345, 420], [400, 372], [480, 333], [580, 300],
  [700, 282], [820, 280], [930, 296], [975, 312], [1000, 318], [1060, 310], [1120, 312], [1180, 322],
  [1225, 350], [1238, 385], [1220, 430], [1175, 458], [1115, 476], [1070, 492], [1058, 530], [1050, 580],
  [1025, 630], [985, 668], [930, 690], [870, 696], [820, 680], [760, 672], [700, 700], [640, 705],
  [575, 702], [560, 678], [600, 650], [690, 612], [770, 575], [830, 530], [880, 500], [920, 480],
  [900, 470], [800, 455], [690, 455], [560, 470], [430, 500], [320, 540], [240, 570]
]
const ACCENT = [109, 76, 245]
const LIGHT_ACCENT = [236, 222, 255]

// Turns the photo into a short flipbook: the turtle moves, the background stays the same.
export default defineComponent({
  name: 'Flipbook',
  data() {
    return {
      ready: false,
      frameIndex: 0,
      keyframeIndex: 1,
      motion: 2,
      playing: false,
      timer: 0,
      frames: markRaw([]) as Uint8ClampedArray[],
      // Per frame and pixel: a changeKinds value, 0 where the pixel did not change.
      kinds: markRaw([]) as Uint8Array[],
      frameCount: FRAMES,
      width: W,
      height: H,
      total: W * H,
      pixels: null as { source: Uint8ClampedArray; background: Uint8ClampedArray; mask: Uint8Array } | null
    }
  },
  computed: {
    keyframeEvery(): number {
      return KEYFRAME_OPTIONS[this.keyframeIndex]!
    },
    counts(): number[] {
      return this.kinds.map((kind) => kind.reduce((n, v) => n + (v ? 1 : 0), 0))
    },
    shares(): number[] {
      return storedShares(this.counts, this.total, this.keyframeEvery)
    },
    isKeyframe(): boolean {
      return this.frameIndex % this.keyframeEvery === 0
    },
    changed(): number {
      return this.counts[this.frameIndex] ?? 0
    },
    bands(): { newly: number; uncovered: number; inside: number } {
      const out = { newly: 0, uncovered: 0, inside: 0 }
      const kind = this.kinds[this.frameIndex]
      if (!kind) return out
      for (const v of kind) {
        if (v === NEWLY_COVERED) out.newly++
        else if (v === UNCOVERED) out.uncovered++
        else if (v === INSIDE_CHANGE) out.inside++
      }
      return out
    },
    swatches(): Record<string, string> {
      return {
        newly: `rgb(${ACCENT.join(' ')})`,
        uncovered: `rgb(${LIGHT_ACCENT.join(' ')})`,
        inside: `rgba(${ACCENT.join(', ')}, 0.55)`
      }
    },
    totalPercent(): number {
      const sum = this.shares.reduce((a, b) => a + b, 0)
      return this.shares.length ? (sum / this.shares.length) * 100 : 0
    },
    keyframeCount(): number {
      return this.shares.filter((_, k) => k % this.keyframeEvery === 0).length
    }
  },
  watch: {
    frameIndex() {
      this.draw()
    },
    keyframeIndex() {
      this.draw()
    },
    motion() {
      this.build()
    }
  },
  async mounted() {
    const image = new Image()
    image.src = turtleUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0, W, H)
    const source = ctx.getImageData(0, 0, W, H).data
    const scaled: Polygon = TURTLE.map(([x, y]) => [(x * W) / SOURCE_W, (y * H) / SOURCE_H])
    const mask = polygonMask(W, H, scaled)
    this.pixels = markRaw({ source, background: removeSubject(source, W, H, mask), mask })
    this.ready = true
    this.build()
  },
  beforeUnmount() {
    this.stop()
  },
  methods: {
    build(): void {
      if (!this.pixels) return
      const { source, background, mask } = this.pixels
      const shift = MOTION_SHIFT[this.motion]!
      const shifts = Array.from({ length: FRAMES }, (_, k) => k * shift)
      const frames = renderFlipbook(source, background, mask, W, H, shifts)
      const covers = shifts.map((dx) => shiftMask(mask, W, H, dx))
      // Every pixel is compared with the same pixel in the frame before, so the uncovered background counts too.
      const kinds: Uint8Array[] = [new Uint8Array(W * H)]
      for (let k = 1; k < frames.length; k++) {
        const changed = changedMask(frames[k - 1]!, frames[k]!, THRESHOLD)
        kinds.push(changeKinds(changed, covers[k - 1]!, covers[k]!))
      }
      this.frames = markRaw(frames)
      this.kinds = markRaw(kinds)
      this.draw()
    },
    draw(): void {
      if (!this.ready) return
      const frame = this.frames[this.frameIndex]
      const kind = this.kinds[this.frameIndex]
      if (!frame || !kind) return
      const key = this.isKeyframe
      const live = new ImageData(W, H)
      const stored = new ImageData(W, H)
      for (let p = 0; p < W * H; p++) {
        const i = p * 4
        const r = frame[i]!
        const g = frame[i + 1]!
        const b = frame[i + 2]!
        const k = kind[p]!
        if (key || k) {
          stored.data.set([r, g, b, 255], i)
        }
        if (key) {
          live.data.set([r, g, b, 255], i)
        } else if (k === NEWLY_COVERED) {
          live.data.set([...ACCENT, 255], i)
        } else if (k === UNCOVERED) {
          live.data.set([...LIGHT_ACCENT, 255], i)
        } else if (k === INSIDE_CHANGE) {
          live.data.set([0.5 * r + 0.5 * ACCENT[0]!, 0.5 * g + 0.5 * ACCENT[1]!, 0.5 * b + 0.5 * ACCENT[2]!, 255].map(Math.round), i)
        } else {
          const gray = 0.3 * r + 0.59 * g + 0.11 * b
          live.data.set([0.45 * r + 0.55 * gray, 0.45 * g + 0.55 * gray, 0.45 * b + 0.55 * gray, 255].map(Math.round), i)
        }
      }
      ;(this.$refs.live as HTMLCanvasElement).getContext('2d')!.putImageData(live, 0, 0)
      ;(this.$refs.stored as HTMLCanvasElement).getContext('2d')!.putImageData(stored, 0, 0)
    },
    togglePlay(): void {
      if (this.playing) this.stop()
      else {
        this.playing = true
        this.timer = window.setInterval(() => {
          this.frameIndex = (this.frameIndex + 1) % FRAMES
        }, 450)
      }
    },
    stop(): void {
      window.clearInterval(this.timer)
      this.playing = false
    },
    format(value: number, digits = 0): string {
      return formatNumber(value, digits)
    },
    barLabel(k: number): string {
      return this.$t('help.compression.flip.barLabel', {
        n: k + 1,
        percent: this.format(this.shares[k]! * 100),
        kind: this.$t(k % this.keyframeEvery === 0 ? 'help.compression.flip.kindKey' : 'help.compression.flip.kindChange')
      })
    }
  }
})
</script>

<template>
  <div class="space-y-5 rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <div class="grid gap-4 sm:grid-cols-2">
      <figure class="m-0">
        <canvas
          ref="live"
          :width="width"
          :height="height"
          role="img"
          :aria-label="$t('help.compression.flip.liveLabel', { n: frameIndex + 1 })"
          class="block aspect-video w-full rounded-lg bg-panel2"
        ></canvas>
        <figcaption class="mt-2 text-sm text-muted">{{ $t('help.compression.flip.liveCaption') }}</figcaption>
        <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm" :aria-label="$t('help.compression.flip.legendLabel')">
          <li class="flex items-center gap-2">
            <span class="size-3 shrink-0 rounded-sm" :style="{ background: swatches.newly }" aria-hidden="true"></span>
            <span>{{ $t('help.compression.flip.legend.newly') }}</span>
            <span class="tabular-nums text-muted" data-stat="newly">{{ format(bands.newly) }}</span>
          </li>
          <li class="flex items-center gap-2">
            <span class="size-3 shrink-0 rounded-sm" :style="{ background: swatches.uncovered }" aria-hidden="true"></span>
            <span>{{ $t('help.compression.flip.legend.uncovered') }}</span>
            <span class="tabular-nums text-muted" data-stat="uncovered">{{ format(bands.uncovered) }}</span>
          </li>
          <li class="flex items-center gap-2">
            <span class="size-3 shrink-0 rounded-sm" :style="{ background: swatches.inside }" aria-hidden="true"></span>
            <span>{{ $t('help.compression.flip.legend.inside') }}</span>
            <span class="tabular-nums text-muted" data-stat="inside">{{ format(bands.inside) }}</span>
          </li>
        </ul>
      </figure>
      <figure class="m-0">
        <canvas
          ref="stored"
          :width="width"
          :height="height"
          role="img"
          :aria-label="isKeyframe ? $t('help.compression.flip.storedKeyLabel') : $t('help.compression.flip.storedChangeLabel')"
          class="block aspect-video w-full rounded-lg bg-panel2"
        ></canvas>
        <figcaption class="mt-2 text-sm text-muted">
          {{ isKeyframe ? $t('help.compression.flip.storedKeyCaption') : $t('help.compression.flip.storedChangeCaption') }}
        </figcaption>
      </figure>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="inline-flex min-h-11 min-w-28 items-center justify-center rounded-lg bg-fill px-4 font-semibold text-fill-fg"
        @click="togglePlay"
      >
        {{ playing ? $t('help.compression.flip.pause') : $t('help.compression.flip.play') }}
      </button>
      <p class="text-sm font-semibold" data-stat="changed">
        {{ $t('help.compression.flip.changed', { count: format(changed), total: format(total) }) }}
      </p>
    </div>

    <label class="block">
      <span class="flex items-center justify-between gap-3 text-sm font-semibold">
        {{ $t('help.compression.flip.frameLabel') }}
        <output class="tabular-nums text-muted">{{ frameIndex + 1 }} / {{ frameCount }}</output>
      </span>
      <input v-model.number="frameIndex" type="range" min="0" :max="frameCount - 1" step="1" class="mt-2 block h-11 w-full accent-fill" />
    </label>

    <label class="block">
      <span class="flex items-center justify-between gap-3 text-sm font-semibold">
        {{ $t('help.compression.flip.keyframeLabel') }}
        <output class="tabular-nums text-muted" data-stat="keyframe">{{ $t('help.compression.flip.keyframeValue', { n: keyframeEvery }) }}</output>
      </span>
      <input v-model.number="keyframeIndex" type="range" min="0" max="3" step="1" class="mt-2 block h-11 w-full accent-fill" />
    </label>

    <label class="block">
      <span class="flex items-center justify-between gap-3 text-sm font-semibold">
        {{ $t('help.compression.flip.motionLabel') }}
        <output class="text-muted">{{ $t(`help.compression.flip.motionLevels.${motion}`) }}</output>
      </span>
      <input
        v-model.number="motion"
        type="range"
        min="0"
        max="4"
        step="1"
        :aria-valuetext="$t(`help.compression.flip.motionLevels.${motion}`)"
        class="mt-2 block h-11 w-full accent-fill"
      />
    </label>

    <div>
      <p class="text-sm font-semibold">{{ $t('help.compression.flip.chartLabel') }}</p>
      <ol class="mt-2 flex h-32 items-end gap-1.5 rounded-lg bg-panel2 p-2">
        <li v-for="(share, k) in shares" :key="k" class="flex h-full min-w-0 flex-1 items-end">
          <span class="sr-only">{{ barLabel(k) }}</span>
          <span
            class="block w-full rounded-t transition-[height] duration-300 motion-reduce:transition-none"
            :class="[k % keyframeEvery === 0 ? 'bg-fill' : 'bg-txt/60', k === frameIndex ? 'ring-2 ring-fg' : '']"
            :style="{ height: `${Math.max(share * 100, 3)}%` }"
            aria-hidden="true"
          ></span>
        </li>
      </ol>
      <p class="mt-2 text-sm text-muted" data-stat="total">
        {{ $t('help.compression.flip.total', { percent: format(totalPercent), frames: frameCount, keyframes: keyframeCount }) }}
      </p>
    </div>
  </div>
</template>
