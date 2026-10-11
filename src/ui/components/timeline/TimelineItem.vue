<script lang="ts">
import { defineComponent, type PropType } from 'vue'

export type TimelineItemVariant = 'video' | 'text' | 'music' | 'audio'
export type TrimEdge = 'start' | 'end'

/** One bar in a lane. Position and size are pixels; the parent owns all pointer logic except the press itself. */
export default defineComponent({
  name: 'TimelineItem',
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
    endLabel: { type: String, default: '' }
  },
  emits: {
    select: () => true,
    'body-down': (event: PointerEvent) => event instanceof PointerEvent,
    'handle-down': (edge: TrimEdge, event: PointerEvent) => (edge === 'start' || edge === 'end') && event instanceof PointerEvent
  },
  computed: {
    bodyStyle(): Record<string, string> {
      const background = {
        video: `var(--jc-track-video-${this.tone})`,
        text: 'var(--jc-fill)',
        music: 'var(--jc-music)',
        audio:
          'repeating-linear-gradient(90deg, color-mix(in srgb, var(--jc-wave) 60%, transparent) 0 3px, transparent 3px 6px), color-mix(in srgb, var(--jc-wave) 22%, var(--jc-panel2))'
      }[this.variant]
      return {
        background,
        color: this.variant === 'audio' ? 'var(--jc-fg)' : '#ffffff',
        boxShadow: this.selected
          ? 'inset 0 0 0 2px var(--jc-signal)'
          : 'inset 0 0 0 1px var(--jc-panel)'
      }
    },
    rootStyle(): Record<string, string | number> {
      return {
        left: `${this.left}px`,
        width: `${Math.max(this.width, 0)}px`,
        transform: this.offset ? `translateX(${this.offset}px)` : 'none',
        zIndex: this.offset ? 10 : 'auto'
      }
    }
  },
  methods: {
    onBodyDown(event: PointerEvent) {
      event.stopPropagation()
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      this.$emit('body-down', event)
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
  <div class="absolute inset-y-1" :class="{ 'pointer-events-none': !interactive }" :style="rootStyle" :data-kind="variant">
    <button
      v-if="interactive"
      type="button"
      class="flex h-full w-full touch-none items-center overflow-hidden rounded-md px-2 text-left text-[11px] font-semibold"
      :style="bodyStyle"
      :aria-label="ariaLabel || label"
      :aria-pressed="selected"
      :title="label"
      @pointerdown="onBodyDown"
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
