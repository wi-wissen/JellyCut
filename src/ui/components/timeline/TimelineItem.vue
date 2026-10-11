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
    /** Vertical drag between overlay lanes: the bar follows the pointer by this many pixels. */
    offsetY: { type: Number, default: 0 },
    selected: { type: Boolean, default: false },
    interactive: { type: Boolean, default: true },
    handles: { type: Boolean, default: false },
    startLabel: { type: String, default: '' },
    endLabel: { type: String, default: '' },
    /** Stacking row in a multi-row lane; the bar sits in that row, inset by 4 px like a single row. */
    row: { type: Number, default: 0 },
    laneHeight: { type: Number, default: 38 },
    /** Space between the lane edge and the bar; 4 px on a mouse lane, 2 px on a touch lane (44 px bar). */
    inset: { type: Number, default: 4 },
    /** Touch lanes: the selected bar shows a "more" button, since a long press is already the move gesture. */
    moreButton: { type: Boolean, default: false }
  },
  emits: {
    select: () => true,
    'body-down': (event: PointerEvent) => event instanceof PointerEvent,
    'handle-down': (edge: TrimEdge, event: PointerEvent) => (edge === 'start' || edge === 'end') && event instanceof PointerEvent,
    'context-menu': (event: MouseEvent) => event instanceof MouseEvent,
    more: (button: HTMLElement) => button instanceof HTMLElement
  },
  computed: {
    moreLabel(): string {
      return this.$t('polish.menu.more')
    },
    bodyStyle(): Record<string, string | undefined> {
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
        // Room for the "more" button on touch lanes.
        paddingRight: this.moreButton && this.selected ? '48px' : undefined,
        // The selection ring is its own element (jc-bar__ring), so the bar keeps one clean radius.
        boxShadow: this.selected ? 'none' : 'inset 0 0 0 1px var(--jc-panel)'
      }
    },
    rootStyle(): Record<string, string | number> {
      const shift = this.offset || this.offsetY ? `translate(${this.offset}px, ${this.offsetY}px)` : ''
      const lifted = this.lifted
      return {
        left: `${this.left}px`,
        width: `${Math.max(this.width, 0)}px`,
        top: `${this.row * this.laneHeight + this.inset}px`,
        height: `${this.laneHeight - 2 * this.inset}px`,
        transform: lifted ? `${shift} scale(1.04)`.trim() : shift || 'none',
        filter: lifted || this.offsetY ? 'drop-shadow(0 6px 10px rgb(0 0 0 / 0.35))' : 'none',
        // The selected bar stays on top of any bars it overlaps in the same row.
        zIndex: this.offset || this.offsetY || lifted ? 10 : this.selected ? 2 : 'auto'
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
    /** Right click or the context-menu key opens the item menu. A touch long press is a move, never a menu. */
    onContextMenu(event: MouseEvent) {
      event.preventDefault()
      if (presses.has(this)) return
      this.$emit('context-menu', event)
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
    onMore(event: MouseEvent) {
      this.$emit('more', event.currentTarget as HTMLElement)
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
  <div
    class="jc-bar absolute"
    :class="{ 'pointer-events-none': !interactive }"
    :style="rootStyle"
    :data-kind="variant"
    :data-lifted="lifted ? 'true' : undefined"
    :data-selected="selected ? 'true' : undefined"
  >
    <button
      v-if="interactive"
      type="button"
      class="flex h-full w-full touch-none select-none items-center overflow-hidden rounded-md px-2.5 text-left text-[11px] font-semibold [-webkit-touch-callout:none]"
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

    <span class="jc-bar__ring pointer-events-none absolute inset-0 rounded-md" aria-hidden="true" />

    <template v-if="handles && selected">
      <div
        class="jc-bar__handle absolute inset-y-0 left-[2px] flex w-[7px] cursor-ew-resize touch-none items-center justify-center"
        :title="startLabel"
        :data-handle="'start'"
        aria-hidden="true"
        @pointerdown="onHandleDown('start', $event)"
      >
        <span class="jc-bar__grip" />
      </div>
      <div
        class="jc-bar__handle absolute inset-y-0 right-[2px] flex w-[7px] cursor-ew-resize touch-none items-center justify-center"
        :title="endLabel"
        :data-handle="'end'"
        aria-hidden="true"
        @pointerdown="onHandleDown('end', $event)"
      >
        <span class="jc-bar__grip" />
      </div>
    </template>

    <button
      v-if="interactive && moreButton && selected"
      type="button"
      class="jc-item-more absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md"
      :aria-label="moreLabel"
      aria-haspopup="menu"
      data-role="item-more"
      @pointerdown.stop
      @click.stop="onMore"
    >
      <svg viewBox="0 0 24 24" class="size-5" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/*
 * One ring for every state, same radius as the bar. Selected: 2 px lime ring inside the bar edge and a 2 px
 * contrast ring outside. Keyboard focus: a 2 px violet ring outside (replaces the contrast ring), so it differs
 * from the selection but is just as round.
 */
.jc-bar__ring {
  box-shadow: none;
}
/* The ring below replaces the global focus outline. */
.jc-bar > button:focus-visible {
  outline: none;
}
.jc-bar[data-selected] .jc-bar__ring {
  box-shadow:
    inset 0 0 0 2px var(--jc-signal),
    0 0 0 2px var(--jc-sel-halo);
}
.jc-bar:has(> button:focus-visible) .jc-bar__ring {
  box-shadow: 0 0 0 2px var(--jc-fill);
}
.jc-bar[data-selected]:has(> button:focus-visible) .jc-bar__ring {
  box-shadow:
    inset 0 0 0 2px var(--jc-signal),
    0 0 0 2px var(--jc-fill);
}
/* The handle is a short rounded grip inside the ring; the 7 px wide element around it is the hit area. */
.jc-bar__grip {
  width: 3px;
  height: 55%;
  max-height: 20px;
  border-radius: 9999px;
  background: #fff;
  box-shadow: 0 0 0 1px rgb(20 18 31 / 0.45);
  pointer-events: none;
}
</style>
