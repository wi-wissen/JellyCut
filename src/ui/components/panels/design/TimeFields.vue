<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { secondsToMicros, type Micros } from '../../../../core/time'

/** Start and duration in seconds, the same two fields for text and every overlay. Emits a patch with micros. */
export default defineComponent({
  name: 'TimeFields',
  props: {
    start: { type: Number as PropType<Micros>, required: true },
    duration: { type: Number as PropType<Micros>, required: true }
  },
  emits: {
    patch: (patch: { start?: Micros; duration?: Micros }) => Object.values(patch).every((v) => Number.isFinite(v))
  },
  computed: {
    startSeconds(): number {
      return Math.round(this.start / 100_000) / 10
    },
    durationSeconds(): number {
      return Math.round(this.duration / 100_000) / 10
    }
  },
  methods: {
    onStart(event: Event): void {
      this.$emit('patch', { start: secondsToMicros(Number((event.target as HTMLInputElement).value)) })
    },
    onDuration(event: Event): void {
      this.$emit('patch', { duration: secondsToMicros(Number((event.target as HTMLInputElement).value)) })
    }
  }
})
</script>

<template>
  <div class="grid grid-cols-2 gap-2">
    <div class="flex flex-col gap-1">
      <label :for="`time-start-${start}-${duration}`" class="text-xs font-semibold text-muted">{{ $t('design.start') }}</label>
      <input
        :id="`time-start-${start}-${duration}`"
        type="number"
        min="0"
        step="0.1"
        class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg [font-variant-numeric:tabular-nums]"
        :value="startSeconds"
        @change="onStart"
      />
    </div>
    <div class="flex flex-col gap-1">
      <label :for="`time-duration-${start}-${duration}`" class="text-xs font-semibold text-muted">{{ $t('design.duration') }}</label>
      <input
        :id="`time-duration-${start}-${duration}`"
        type="number"
        min="0.1"
        step="0.1"
        class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg [font-variant-numeric:tabular-nums]"
        :value="durationSeconds"
        @change="onDuration"
      />
    </div>
  </div>
</template>
