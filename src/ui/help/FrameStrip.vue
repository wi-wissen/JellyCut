<script lang="ts">
import { defineComponent } from 'vue'
import turtleUrl from '../../assets/photos/turtle.jpg'
import { demoWaveform, frameAt } from '../../core/learn/demo'
import { MICROS_PER_SECOND, type Micros } from '../../core/time'
import { formatNumber } from '../numberFormat'

// A 2-second excerpt: 12 pictures of 1/6 second each. Strip, time axis and sound share this span.
const FPS = 6
const CLIP_FRAMES = 12
// One frame in whole microseconds, rounded up so that n frames always land on frame n.
const FRAME: Micros = Math.ceil(MICROS_PER_SECOND / FPS)
const LAST_FRAME = CLIP_FRAMES - 1
const DURATION: Micros = CLIP_FRAMES * FRAME
const BARS = 120
const AXIS_SECONDS = [0, 0.5, 1, 1.5, 2]

// Scrubbable strip of pictures and sound. Times stay whole microseconds; only the display is formatted.
export default defineComponent({
  name: 'FrameStrip',
  data() {
    return {
      position: 0 as Micros,
      dragging: false,
      thumbs: Array.from({ length: CLIP_FRAMES }, (_, i) => i),
      thumbCount: CLIP_FRAMES,
      bars: demoWaveform(BARS).map((h, i) => ({ x: i, h: h * 36 })),
      lastFrame: LAST_FRAME,
      axis: AXIS_SECONDS,
      turtleUrl
    }
  },
  computed: {
    frame(): number {
      return Math.min(LAST_FRAME, frameAt(this.position, FPS))
    },
    // The playhead sits on the left edge of its picture, which is also the time shown.
    percent(): number {
      return (this.frame / CLIP_FRAMES) * 100
    },
    timeText(): string {
      return formatNumber(this.position / MICROS_PER_SECOND, 2)
    },
    valueText(): string {
      return this.$t('help.container.frames.time', { time: this.timeText, frame: this.frame + 1 })
    }
  },
  methods: {
    axisLabel(seconds: number): string {
      return this.$t('units.seconds', { value: formatNumber(seconds, 1) })
    },
    setFromPointer(clientX: number, element: HTMLElement): void {
      const rect = element.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      this.setFrame(Math.min(LAST_FRAME, Math.floor(ratio * CLIP_FRAMES)))
    },
    setFrame(frame: number): void {
      this.position = Math.min(LAST_FRAME, Math.max(0, frame)) * FRAME
    },
    down(event: PointerEvent): void {
      this.dragging = true
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      this.setFromPointer(event.clientX, event.currentTarget as HTMLElement)
    },
    move(event: PointerEvent): void {
      if (this.dragging) this.setFromPointer(event.clientX, event.currentTarget as HTMLElement)
    },
    up(): void {
      this.dragging = false
    },
    key(event: KeyboardEvent): void {
      const steps: Record<string, number> = {
        ArrowRight: 1,
        ArrowUp: 1,
        ArrowLeft: -1,
        ArrowDown: -1,
        PageUp: FPS,
        PageDown: -FPS
      }
      if (event.key in steps) {
        event.preventDefault()
        this.setFrame(this.frame + steps[event.key]!)
      } else if (event.key === 'Home') {
        event.preventDefault()
        this.setFrame(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        this.setFrame(LAST_FRAME)
      }
    }
  }
})
</script>

<template>
  <div class="rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <div
      role="slider"
      tabindex="0"
      :aria-label="$t('help.container.frames.sliderLabel')"
      aria-orientation="horizontal"
      aria-valuemin="0"
      :aria-valuemax="lastFrame"
      :aria-valuenow="frame"
      :aria-valuetext="valueText"
      class="relative min-h-11 touch-none select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-fill"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @keydown="key"
    >
      <div class="flex h-16 overflow-hidden rounded-lg bg-panel2">
        <div
          v-for="i in thumbs"
          :key="i"
          class="h-full min-w-0 flex-1 bg-cover transition-[opacity,transform] duration-200 motion-reduce:transition-none"
          :class="i === frame ? 'scale-y-105 opacity-100' : 'opacity-80'"
          :style="{
            backgroundImage: `url(${turtleUrl})`,
            backgroundSize: 'auto 100%',
            backgroundPosition: `${(i / (thumbCount - 1)) * 100}% 50%`
          }"
        ></div>
      </div>
      <svg class="mt-2 h-12 w-full" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect v-for="bar in bars" :key="bar.x" :x="bar.x + 0.2" :y="20 - bar.h / 2" width="0.6" :height="bar.h" rx="0.3" style="fill: var(--jc-wave)" />
      </svg>
      <div class="pointer-events-none absolute -inset-y-1 w-0.5 bg-fill" :style="{ left: `${percent}%` }" aria-hidden="true"></div>
    </div>
    <div class="mt-1 flex justify-between text-xs tabular-nums text-muted" aria-hidden="true">
      <span v-for="seconds in axis" :key="seconds">{{ axisLabel(seconds) }}</span>
    </div>
    <p class="mt-3 text-sm text-muted">{{ $t('help.container.frames.clip') }}</p>
    <p class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <span>{{ $t('help.container.frames.hint') }}</span>
      <output class="font-mono font-semibold tabular-nums text-fg" aria-hidden="true">{{ valueText }}</output>
    </p>
  </div>
</template>
