<script lang="ts">
import { defineComponent } from 'vue'
import { rawVideoBytes } from '../../core/learn/demo'
import { formatNumber } from '../numberFormat'

const RESOLUTIONS = [
  { id: 'hd', width: 1280, height: 720 },
  { id: 'fullHd', width: 1920, height: 1080 },
  { id: 'uhd', width: 3840, height: 2160 }
]
const FPS_OPTIONS = [15, 24, 30, 60]
// A typical compressed video: 10 megabit per second.
const COMPRESSED_BYTES_PER_SECOND = 1_250_000

// Live calculation of the size of a video without compression, with sliders.
export default defineComponent({
  name: 'RawSizeCalculator',
  data() {
    return {
      resolutions: RESOLUTIONS,
      fpsOptions: FPS_OPTIONS,
      resolutionIndex: 1,
      fpsIndex: 2,
      seconds: 60
    }
  },
  computed: {
    resolution(): (typeof RESOLUTIONS)[number] {
      return RESOLUTIONS[this.resolutionIndex]!
    },
    fps(): number {
      return FPS_OPTIONS[this.fpsIndex]!
    },
    bytes(): number {
      return rawVideoBytes(this.resolution.width, this.resolution.height, this.fps, this.seconds)
    },
    compressedBytes(): number {
      return COMPRESSED_BYTES_PER_SECOND * this.seconds
    },
    compressedShare(): number {
      return Math.max((this.compressedBytes / this.bytes) * 100, 0.6)
    },
    factor(): number {
      return Math.round(this.bytes / this.compressedBytes)
    }
  },
  methods: {
    size(bytes: number): string {
      if (bytes >= 1e9) return this.$t('help.compression.calc.gb', { value: formatNumber(bytes / 1e9, 1) })
      if (bytes >= 1e6) return this.$t('help.compression.calc.mb', { value: formatNumber(bytes / 1e6, 0) })
      return this.$t('help.compression.calc.kb', { value: formatNumber(bytes / 1e3, 0) })
    },
    number(value: number): string {
      return formatNumber(value, 0)
    }
  }
})
</script>

<template>
  <div class="space-y-5 rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <fieldset class="m-0 border-0 p-0">
      <legend class="text-sm font-semibold">{{ $t('help.compression.calc.resolutionLabel') }}</legend>
      <div class="mt-2 grid grid-cols-3 gap-2">
        <label
          v-for="(option, index) in resolutions"
          :key="option.id"
          class="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg border border-line bg-panel2 px-2 py-1 text-center text-fg has-[:checked]:border-fill has-[:checked]:bg-panel has-[:checked]:ring-2 has-[:checked]:ring-fill has-[:focus-visible]:ring-2"
        >
          <input v-model.number="resolutionIndex" type="radio" name="calc-resolution" :value="index" class="sr-only" />
          <span class="text-sm font-semibold">{{ $t(`help.compression.calc.resolutions.${option.id}`) }}</span>
          <span class="text-xs text-muted">{{ number(option.width) }} × {{ number(option.height) }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset class="m-0 border-0 p-0">
      <legend class="text-sm font-semibold">{{ $t('help.compression.calc.fpsLabel') }}</legend>
      <div class="mt-2 grid grid-cols-4 gap-2">
        <label
          v-for="(option, index) in fpsOptions"
          :key="option"
          class="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-panel2 px-2 text-sm font-semibold text-fg has-[:checked]:border-fill has-[:checked]:bg-panel has-[:checked]:ring-2 has-[:checked]:ring-fill has-[:focus-visible]:ring-2"
        >
          <input v-model.number="fpsIndex" type="radio" name="calc-fps" :value="index" class="sr-only" />
          <span>{{ number(option) }}</span>
        </label>
      </div>
    </fieldset>

    <label class="block">
      <span class="flex items-center justify-between gap-3 text-sm font-semibold">
        {{ $t('help.compression.calc.secondsLabel') }}
        <output class="tabular-nums text-muted">{{ $t('units.seconds', { value: number(seconds) }) }}</output>
      </span>
      <input v-model.number="seconds" type="range" min="1" max="600" step="1" class="mt-2 block h-11 w-full accent-fill" />
    </label>

    <div class="rounded-xl bg-panel2 p-4">
      <p class="text-sm text-muted">{{ $t('help.compression.calc.resultLabel') }}</p>
      <p class="mt-1 text-3xl font-bold tabular-nums text-fg" data-stat="raw" aria-live="polite">{{ size(bytes) }}</p>
      <p class="mt-2 font-mono text-sm text-muted">
        {{ $t('help.compression.calc.formula', { width: number(resolution.width), height: number(resolution.height), fps: number(fps), seconds: number(seconds), bytes: number(bytes) }) }}
      </p>
    </div>

    <div class="space-y-3">
      <div>
        <p class="flex justify-between gap-2 text-sm"><span>{{ $t('help.compression.calc.rawBar') }}</span><span class="font-semibold tabular-nums">{{ size(bytes) }}</span></p>
        <div class="mt-1 h-4 rounded-full bg-panel2"><div class="h-4 rounded-full bg-txt/70" style="width: 100%"></div></div>
      </div>
      <div>
        <p class="flex justify-between gap-2 text-sm"><span>{{ $t('help.compression.calc.compressedBar') }}</span><span class="font-semibold tabular-nums">{{ size(compressedBytes) }}</span></p>
        <div class="mt-1 h-4 rounded-full bg-panel2"><div class="h-4 rounded-full bg-fill transition-[width] duration-300 motion-reduce:transition-none" :style="{ width: `${compressedShare}%` }"></div></div>
      </div>
      <p class="text-sm text-muted" data-stat="factor">{{ $t('help.compression.calc.factor', { factor: number(factor) }) }}</p>
    </div>
  </div>
</template>
