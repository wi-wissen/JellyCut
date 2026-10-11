<script lang="ts">
import { defineComponent } from 'vue'
import { seekPlan } from '../../core/learn/demo'
import { MICROS_PER_SECOND, type Micros } from '../../core/time'
import { formatNumber } from '../numberFormat'

const FPS = 30
const TARGET_SECONDS = 30
const INTERVALS = [4, 6, 8, 12]
const TICKS = [0, 10, 20, 30]

// Shows why a jump needs the keyframe before the target: the player starts there and rebuilds the frames.
export default defineComponent({
  name: 'SeekDemo',
  data() {
    return {
      intervalIndex: 2,
      jumped: false,
      intervals: INTERVALS,
      ticks: TICKS,
      target: TARGET_SECONDS
    }
  },
  computed: {
    everySeconds(): number {
      return INTERVALS[this.intervalIndex]!
    },
    plan(): { keyframeSeconds: number; frames: number; keyframe: Micros } {
      const plan = seekPlan(TARGET_SECONDS * MICROS_PER_SECOND, this.everySeconds * MICROS_PER_SECOND, FPS)
      return { keyframeSeconds: plan.keyframe / MICROS_PER_SECOND, frames: plan.framesToDecode, keyframe: plan.keyframe }
    },
    keyframeMarks(): number[] {
      const marks: number[] = []
      for (let s = 0; s < TARGET_SECONDS; s += this.everySeconds) marks.push(s)
      return marks
    },
    segmentStyle(): Record<string, string> {
      const start = (this.plan.keyframeSeconds / TARGET_SECONDS) * 100
      return { left: `${start}%`, width: `${100 - start}%` }
    },
    playheadStyle(): Record<string, string> {
      return { left: this.jumped ? '100%' : '0%' }
    },
    resultText(): string {
      if (this.plan.frames === 0) return this.$t('help.compression.seek.resultDirect', { target: TARGET_SECONDS })
      return this.$t('help.compression.seek.resultPlan', {
        keyframe: formatNumber(this.plan.keyframeSeconds, 0),
        frames: formatNumber(this.plan.frames, 0),
        target: TARGET_SECONDS
      })
    }
  },
  methods: {
    pct(seconds: number): string {
      return `${(seconds / TARGET_SECONDS) * 100}%`
    },
    tickLabel(seconds: number): string {
      return this.$t('units.seconds', { value: formatNumber(seconds, 0) })
    }
  }
})
</script>

<template>
  <div class="space-y-5 rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <fieldset class="m-0 border-0 p-0">
      <legend class="text-sm font-semibold">{{ $t('help.compression.seek.intervalLabel') }}</legend>
      <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label
          v-for="(seconds, index) in intervals"
          :key="seconds"
          class="relative flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-panel2 px-3 text-sm font-semibold text-fg has-[:checked]:border-fill has-[:checked]:bg-panel has-[:checked]:ring-2 has-[:checked]:ring-fill has-[:focus-visible]:ring-2"
        >
          <input v-model.number="intervalIndex" type="radio" name="seek-interval" :value="index" class="sr-only" />
          <span>{{ $t('help.compression.seek.every', { n: seconds }) }}</span>
        </label>
      </div>
    </fieldset>

    <div class="pt-2">
      <div class="relative h-16">
        <div class="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-panel2" aria-hidden="true"></div>
        <div
          class="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-txt/50 transition-[left,width] duration-500 motion-reduce:transition-none"
          :style="segmentStyle"
          aria-hidden="true"
        ></div>
        <span
          v-for="seconds in keyframeMarks"
          :key="seconds"
          class="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-fill"
          :style="{ left: pct(seconds) }"
          aria-hidden="true"
        ></span>
        <span
          class="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-fg transition-[left] duration-700 motion-reduce:transition-none"
          :style="{ left: jumped ? pct(target) : '0%' }"
          aria-hidden="true"
        ></span>
      </div>
      <div class="relative mt-1 h-5 text-xs text-muted" aria-hidden="true">
        <span v-for="tick in ticks" :key="tick" class="absolute -translate-x-1/2" :style="{ left: pct(tick) }">{{ tickLabel(tick) }}</span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="inline-flex min-h-11 items-center rounded-lg bg-fill px-4 font-semibold text-fill-fg"
        @click="jumped = !jumped"
      >
        {{ jumped ? $t('help.compression.seek.reset') : $t('help.compression.seek.jump', { target: target }) }}
      </button>
    </div>

    <p class="rounded-lg bg-panel2 p-3 text-sm leading-relaxed" aria-live="polite" data-stat="seek">{{ resultText }}</p>
  </div>
</template>
