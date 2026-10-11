<script lang="ts">
import { defineComponent } from 'vue'
import turtleUrl from '../../assets/photos/turtle.jpg'
import { jumpSteps } from '../../core/learn/demo'
import { formatNumber } from '../numberFormat'

const FRAMES_TOTAL = 60
// The zoomed window of the film strip; it always reaches back far enough to the keyframe before the target.
const WINDOW = 16
const BEFORE = 11
const EVERY_OPTIONS = [4, 8, 12]
const DEFAULT_EVERY_INDEX = 1
const DEFAULT_TARGET = 23
const STEP_MS = 800
const IDLE = -1
// A keyframe is drawn twice as wide as a change picture.
const KEY_UNITS = 2
const CHANGE_UNITS = 1
const STAR = 'M12 2.5l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.3l-6.1 3.6 1.5-6.8L2.2 9.5l6.9-.7z'

interface Cell {
  frame: number
  key: boolean
  units: number
  start: number
}

// Film strip of numbered pictures: the player looks back to the keyframe, then rebuilds each picture up to the target.
export default defineComponent({
  name: 'SeekDemo',
  data() {
    return {
      everyIndex: DEFAULT_EVERY_INDEX,
      target: DEFAULT_TARGET,
      // IDLE, then 0 = looking back, 1 to rebuildCount = rebuilding one picture each, rebuildCount + 1 = finished.
      stage: IDLE,
      timer: 0,
      turtleUrl,
      everyOptions: EVERY_OPTIONS,
      maxTarget: FRAMES_TOTAL - 1,
      star: STAR
    }
  },
  computed: {
    every(): number {
      return EVERY_OPTIONS[this.everyIndex]!
    },
    plan(): { keyframe: number; rebuild: number[] } {
      return jumpSteps(this.target, this.every)
    },
    rebuildCount(): number {
      return this.plan.rebuild.length
    },
    finished(): boolean {
      return this.stage === this.rebuildCount + 1
    },
    running(): boolean {
      return this.stage >= 0 && !this.finished
    },
    windowStart(): number {
      return Math.max(0, Math.min(this.target - BEFORE, FRAMES_TOTAL - WINDOW))
    },
    windowEnd(): number {
      return Math.min(FRAMES_TOTAL, this.windowStart + WINDOW)
    },
    layout(): { cells: Cell[]; total: number; ellipsis: boolean; columns: string } {
      const ellipsis = this.windowStart > 0
      const cells: Cell[] = []
      let at = ellipsis ? 1 : 0
      for (let frame = this.windowStart; frame < this.windowEnd; frame++) {
        const key = frame % this.every === 0
        const units = key ? KEY_UNITS : CHANGE_UNITS
        cells.push({ frame, key, units, start: at })
        at += units
      }
      const widths = cells.map((c) => (c.key ? `${KEY_UNITS}fr` : `${CHANGE_UNITS}fr`))
      return { cells, total: at, ellipsis, columns: [...(ellipsis ? ['1fr'] : []), ...widths].join(' ') }
    },
    previewFrame(): number {
      if (this.stage < 0) return 0
      if (this.stage === 0) return this.plan.keyframe
      if (this.finished) return this.target
      return this.plan.rebuild[this.stage - 1]!
    },
    doneCount(): number {
      return this.stage <= 0 ? 0 : Math.min(this.stage, this.rebuildCount)
    },
    statusText(): string {
      const keyframe = formatNumber(this.plan.keyframe + 1, 0)
      const target = formatNumber(this.target + 1, 0)
      if (this.finished) return this.$t('help.compression.seek.doneText', { target })
      if (this.stage === 0) {
        if (this.rebuildCount === 0) return this.$t('help.compression.seek.resultDirect', { target })
        return this.$t('help.compression.seek.stepLook', { keyframe })
      }
      if (this.stage > 0) return this.$t('help.compression.seek.stepRebuild', { frame: formatNumber(this.previewFrame + 1, 0) })
      if (this.rebuildCount === 0) return this.$t('help.compression.seek.resultDirect', { target })
      return this.$t('help.compression.seek.resultPlan', {
        keyframe,
        frames: formatNumber(this.rebuildCount, 0),
        target
      })
    },
    counterText(): string {
      return this.$t('help.compression.seek.counter', { done: formatNumber(this.doneCount, 0), total: formatNumber(this.rebuildCount, 0) })
    },
    tradeoffText(): string {
      return this.$t(this.every === EVERY_OPTIONS[0] ? 'help.compression.seek.tradeoffMore' : 'help.compression.seek.tradeoffFewer')
    },
    previewCaption(): string {
      if (this.stage < 0) return this.$t('help.compression.seek.start')
      return this.$t('help.compression.seek.targetValue', { n: formatNumber(this.previewFrame + 1, 0) })
    },
    keyPercent(): number {
      return this.centreOf(this.plan.keyframe)
    },
    targetPercent(): number {
      return this.centreOf(this.target)
    },
    markerStyle(): Record<string, string> {
      const pct = this.targetPercent
      const transform = pct < 22 ? 'none' : pct > 78 ? 'translateX(-100%)' : 'translateX(-50%)'
      return { left: `${pct}%`, transform }
    },
    arrowStyle(): Record<string, string> {
      const from = this.keyPercent
      return { left: `${from}%`, width: `${this.targetPercent - from}%` }
    },
    arrowHeadStyle(): Record<string, string> {
      return { left: `${this.keyPercent}%` }
    }
  },
  watch: {
    target() {
      this.reset()
    },
    everyIndex() {
      this.reset()
    }
  },
  beforeUnmount() {
    this.clear()
  },
  methods: {
    centreOf(frame: number): number {
      const { cells, total } = this.layout
      const cell = cells.find((c) => c.frame === frame)
      return cell ? ((cell.start + cell.units / 2) / total) * 100 : 0
    },
    picturePosition(frame: number): string {
      return `${(frame / (FRAMES_TOTAL - 1)) * 100}% 50%`
    },
    pictureStyle(frame: number): Record<string, string> {
      return {
        backgroundImage: `url(${this.turtleUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: this.picturePosition(frame)
      }
    },
    cellLabel(cell: Cell): string {
      return this.$t(cell.key ? 'help.compression.seek.cardKey' : 'help.compression.seek.cardChange', {
        n: formatNumber(cell.frame + 1, 0)
      })
    },
    cardClass(cell: Cell): string[] {
      const classes = cell.key ? ['h-24', 'border-2', 'border-fill'] : ['h-12', 'border', 'border-line', 'bg-panel2']
      const rebuildIndex = this.plan.rebuild.indexOf(cell.frame)
      const active = this.stage >= 1 && rebuildIndex === this.stage - 1
      if (cell.frame === this.target) classes.push('ring-2', 'ring-fg', 'ring-offset-1', 'ring-offset-panel')
      if (active) classes.push('ring-2', 'ring-fill', 'scale-y-110')
      else if (this.stage >= 0 && rebuildIndex >= 0 && rebuildIndex < this.stage) classes.push(cell.key ? 'border-fill' : 'bg-fill/30')
      else if (this.running && rebuildIndex >= 0) classes.push('opacity-40')
      if (this.stage === 0 && cell.frame === this.plan.keyframe) classes.push('ring-2', 'ring-fill')
      return classes
    },
    reducedMotion(): boolean {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {
        return false
      }
    },
    play(): void {
      this.clear()
      if (this.reducedMotion()) {
        this.stage = this.rebuildCount + 1
        return
      }
      this.stage = 0
      this.timer = window.setInterval(() => {
        this.stage++
        if (this.stage >= this.rebuildCount + 1) this.clear()
      }, STEP_MS)
    },
    reset(): void {
      this.clear()
      this.stage = IDLE
    },
    clear(): void {
      window.clearInterval(this.timer)
      this.timer = 0
    }
  }
})
</script>

<template>
  <div class="space-y-5 rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <fieldset class="m-0 border-0 p-0">
      <legend class="text-sm font-semibold">{{ $t('help.compression.seek.intervalLabel') }}</legend>
      <div class="mt-2 grid grid-cols-3 gap-2">
        <label
          v-for="(every, index) in everyOptions"
          :key="every"
          class="relative flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-panel2 px-2 text-center text-sm font-semibold text-fg has-[:checked]:border-fill has-[:checked]:bg-panel has-[:checked]:ring-2 has-[:checked]:ring-fill has-[:focus-visible]:ring-2"
        >
          <input v-model.number="everyIndex" type="radio" name="seek-every" :value="index" class="sr-only" />
          <span>{{ $t('help.compression.seek.every', { n: every }) }}</span>
        </label>
      </div>
      <p class="mt-2 text-sm leading-relaxed text-muted" aria-live="polite" data-stat="tradeoff">{{ tradeoffText }}</p>
    </fieldset>

    <label class="block">
      <span class="flex items-center justify-between gap-3 text-sm font-semibold">
        {{ $t('help.compression.seek.targetLabel') }}
        <output class="tabular-nums text-muted">{{ $t('help.compression.seek.targetValue', { n: target + 1 }) }}</output>
      </span>
      <input v-model.number="target" type="range" min="1" :max="maxTarget" step="1" class="mt-2 block h-11 w-full accent-fill" />
    </label>

    <div class="relative pt-8">
      <span class="absolute left-0 top-0 whitespace-nowrap text-xs font-bold text-fill" :style="markerStyle">{{ $t('help.compression.seek.marker') }}</span>
      <span
        class="absolute top-6 -translate-x-1/2"
        :style="{ left: `${targetPercent}%`, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '7px solid var(--jc-fill)' }"
        aria-hidden="true"
      ></span>
      <div class="relative h-4">
        <template v-if="stage === 0 && rebuildCount > 0">
          <span class="absolute top-1/2 h-0.5 -translate-y-1/2 bg-fill" :style="arrowStyle" aria-hidden="true"></span>
          <span
            class="absolute top-1/2 -translate-y-1/2"
            :style="{ ...arrowHeadStyle, width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderRight: '8px solid var(--jc-fill)' }"
            aria-hidden="true"
          ></span>
        </template>
      </div>

      <div
        role="group"
        :aria-label="$t('help.compression.seek.stripLabel')"
        class="grid items-end"
        :style="{ gridTemplateColumns: layout.columns }"
      >
        <div v-if="layout.ellipsis" role="img" :aria-label="$t('help.compression.seek.earlier')" class="flex h-full items-end justify-center pb-5 text-lg text-muted">…</div>
        <div v-for="cell in layout.cells" :key="cell.frame" role="img" :aria-label="cellLabel(cell)" class="flex min-w-0 flex-col items-center">
          <div class="relative w-full rounded-md transition-[transform,opacity,box-shadow] duration-300 motion-reduce:transition-none" :class="cardClass(cell)" :style="cell.key ? pictureStyle(cell.frame) : {}">
            <svg v-if="cell.key" class="absolute right-0.5 top-0.5 size-3.5 drop-shadow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path :d="star" style="fill: var(--jc-track-text); stroke: var(--jc-track-text-fg); stroke-width: 1.5" />
            </svg>
            <span v-else class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-0.5" aria-hidden="true">
              <i class="size-1 rounded-full bg-fill"></i>
              <i class="size-1 rounded-full bg-fill"></i>
              <i class="size-1 rounded-full bg-fill"></i>
            </span>
          </div>
          <span class="mt-1 text-[11px] leading-none tabular-nums text-muted" aria-hidden="true">{{ cell.frame + 1 }}</span>
        </div>
      </div>
    </div>

    <ul class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <li class="flex items-center gap-2">
        <span class="inline-block h-5 w-3.5 rounded-sm border-2 border-fill bg-panel2" aria-hidden="true"></span>
        <span>{{ $t('help.compression.seek.legendKey') }}</span>
      </li>
      <li class="flex items-center gap-2">
        <span class="inline-block h-3 w-3.5 rounded-sm border border-line bg-panel2" aria-hidden="true"></span>
        <span>{{ $t('help.compression.seek.legendChange') }}</span>
      </li>
    </ul>

    <div class="flex flex-wrap items-center gap-4">
      <figure class="m-0 flex items-center gap-3">
        <div
          class="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg border border-line"
          :style="pictureStyle(previewFrame)"
          role="img"
          :aria-label="previewCaption"
        >
          <span v-if="finished" class="absolute left-2 top-2 rounded-md bg-signal px-2 py-0.5 text-xs font-bold text-signal-fg">{{ $t('help.compression.seek.done') }}</span>
        </div>
        <figcaption class="text-sm text-muted">{{ previewCaption }}</figcaption>
      </figure>
      <button
        type="button"
        class="inline-flex min-h-11 items-center rounded-lg bg-fill px-4 font-semibold text-fill-fg disabled:opacity-60"
        :disabled="running"
        @click="play"
      >
        {{ $t('help.compression.seek.jump') }}
      </button>
    </div>

    <div class="rounded-lg bg-panel2 p-3 text-sm leading-relaxed" aria-live="polite">
      <p class="font-semibold" data-stat="seek">{{ statusText }}</p>
      <p class="mt-1 tabular-nums text-muted" data-stat="counter">{{ counterText }}</p>
    </div>
  </div>
</template>
