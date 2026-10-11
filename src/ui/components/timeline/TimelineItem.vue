<script lang="ts">
import { defineComponent, type PropType } from 'vue'

export type TimelineItemVariant = 'video' | 'text' | 'music' | 'audio' | 'overlay'
export type TrimEdge = 'start' | 'end'

/** A touch press starts a move only after holding still this long; a quicker drag scrolls the timeline. */
const LONG_PRESS_MS = 350
const LONG_PRESS_SLOP_PX = 8

interface PendingPress {
  pointerId: number
  x: number
  y: number
  element: HTMLElement
  event: PointerEvent
  timer: number
  block: (event: TouchEvent) => void
}

// Outside the component data: timers and listeners must not be wrapped in a reactive proxy.
const presses = new WeakMap<object, PendingPress>()

/** One bar in a lane. Position and size are pixels; the parent owns all pointer logic except the press itself. */
export default defineComponent({
  name: 'TimelineItem',
  data() {
    return { lifted: false }
  },
  props: {
    label: { type: String, required: true },
    ariaLabel: { type: String, default: '' },
    variant: { type: String as PropType<TimelineItemVariant>, required: true },
    tone: { type: Number as PropType<1 | 2 | 3>, default: 1 },
    left: { type: Number, required: true },
    width: { type: Number, required: true },
    offset: { type: Number, default: 0 },
    selected: { type: Boolean, default: false },
    interactive: { type: Boolean, default: true },
    handles: { type: Boolean, default: false },
    startLabel: { type: String, default: '' },
    endLabel: { type: String, default: '' },
    /** Stacking row in a multi-row lane; the bar sits in that row, inset by 4 px like a single row. */
    row: { type: Number, default: 0 },
    laneHeight: { type: Number, default: 38 },
    /** Space between the lane edge and the bar; 4 px on a mouse lane, 2 px on a touch lane (44 px bar). */
    inset: { type: Number, default: 4 }
  },
  emits: {
    select: () => true,
    'body-down': (event: PointerEvent) => event instanceof PointerEvent,
    'handle-down': (edge: TrimEdge, event: PointerEvent) => (edge === 'start' || edge === 'end') && event instanceof PointerEvent
  },
  computed: {
    bodyStyle(): Record<string, string> {
      // Colours per track are defined in tokens.css; see docs/ui-layout.md ("Track colours").
      const v = this.variant
      const background = {
        video: `var(--jc-track-video-${this.tone})`,
        text: 'var(--jc-track-text)',
        overlay: 'var(--jc-track-overlay)',
        music: 'var(--jc-track-music)',
        audio:
          'repeating-linear-gradient(90deg, color-mix(in srgb, var(--jc-wave) 35%, transparent) 0 3px, transparent 3px 6px), color-mix(in srgb, var(--jc-wave) 12%, var(--jc-panel2))'
      }[v]
      const color = {
        video: 'var(--jc-track-video-fg)',
        text: 'var(--jc-track-text-fg)',
        overlay: 'var(--jc-track-overlay-fg)',
        music: 'var(--jc-track-music-fg)',
        audio: 'var(--jc-track-audio-fg)'
      }[v]
      return {
        background,
        color,
        // Selection: a 2 px lime outline, with a thin dark line inside so it also shows on amber and lime-ish tracks.
        boxShadow: this.selected
          ? 'inset 0 0 0 2px var(--jc-signal), inset 0 0 0 3px var(--jc-signal-fg)'
          : 'inset 0 0 0 1px var(--jc-panel)'
      }
    },
    rootStyle(): Record<string, string | number> {
      const shift = this.offset ? `translateX(${this.offset}px)` : ''
      const lifted = this.lifted
      return {
        left: `${this.left}px`,
        width: `${Math.max(this.width, 0)}px`,
        top: `${this.row * this.laneHeight + this.inset}px`,
        height: `${this.laneHeight - 2 * this.inset}px`,
        transform: lifted ? `${shift} scale(1.04)`.trim() : shift || 'none',
        filter: lifted ? 'drop-shadow(0 6px 10px rgb(0 0 0 / 0.35))' : 'none',
        zIndex: this.offset || lifted ? 10 : 'auto'
      }
    }
  },
  beforeUnmount() {
    this.endPress()
  },
  methods: {
    onBodyDown(event: PointerEvent) {
      event.stopPropagation()
      const element = event.currentTarget as HTMLElement
      if (event.pointerType !== 'touch') {
        element.setPointerCapture(event.pointerId)
        this.$emit('body-down', event)
        return
      }
      // Touch: the press waits. Moving first lets the browser pan; holding still lifts the bar.
      this.endPress()
      const press: PendingPress = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        element,
        event,
        timer: window.setTimeout(() => this.lift(), LONG_PRESS_MS),
        block: (touch: TouchEvent) => touch.preventDefault()
      }
      presses.set(this, press)
    },
    /** Long press reached: the bar lifts, gives a short haptic tick and takes over the finger's drag. */
    lift() {
      const press = presses.get(this)
      if (!press) return
      this.lifted = true
      navigator.vibrate?.(10)
      press.element.setPointerCapture(press.pointerId)
      // Stops the browser from panning the timeline while the bar is carried.
      press.element.addEventListener('touchmove', press.block, { passive: false })
      this.$emit('body-down', press.event)
    },
    onPressMove(event: PointerEvent) {
      const press = presses.get(this)
      if (!press || press.pointerId !== event.pointerId || this.lifted) return
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) this.endPress()
    },
    /** A long press on touch must not open the system menu over the lifted bar. */
    onContextMenu(event: Event) {
      if (presses.has(this)) event.preventDefault()
    },
    onPressEnd(event: PointerEvent) {
      if (presses.get(this)?.pointerId === event.pointerId) this.endPress()
    },
    endPress() {
      const press = presses.get(this)
      if (!press) return
      window.clearTimeout(press.timer)
      press.element.removeEventListener('touchmove', press.block)
      presses.delete(this)
      this.lifted = false
    },
    onHandleDown(edge: TrimEdge, event: PointerEvent) {
      event.stopPropagation()
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      this.$emit('handle-down', edge, event)
    }
  }
})
</script>

<template>
  <div class="absolute" :class="{ 'pointer-events-none': !interactive }" :style="rootStyle" :data-kind="variant" :data-lifted="lifted ? 'true' : undefined">
    <button
      v-if="interactive"
      type="button"
      class="flex h-full w-full touch-none select-none items-center overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold [-webkit-touch-callout:none]"
      :style="bodyStyle"
      :aria-label="ariaLabel || label"
      :aria-pressed="selected"
      :title="label"
      @pointerdown="onBodyDown"
      @pointermove="onPressMove"
      @pointerup="onPressEnd"
      @pointercancel="onPressEnd"
      @contextmenu="onContextMenu"
      @click="$emit('select')"
    >
      <span class="truncate">{{ label }}</span>
    </button>
    <div v-else class="flex h-full w-full items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold" :style="bodyStyle">
      <span class="truncate">{{ label }}</span>
    </div>

    <template v-if="handles && selected">
      <div
        class="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize touch-none rounded-l-md bg-signal"
        :title="startLabel"
        :data-handle="'start'"
        aria-hidden="true"
        @pointerdown="onHandleDown('start', $event)"
      />
      <div
        class="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize touch-none rounded-r-md bg-signal"
        :title="endLabel"
        :data-handle="'end'"
        aria-hidden="true"
        @pointerdown="onHandleDown('end', $event)"
      />
    </template>
  </div>
</template>
