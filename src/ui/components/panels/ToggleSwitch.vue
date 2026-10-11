<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'ToggleSwitch',
  props: {
    label: { type: String, required: true },
    /** Text shown beside the switch when it is on or off. */
    stateText: { type: String, required: true },
    checked: { type: Boolean, required: true }
  },
  emits: {
    toggle: () => true
  }
})
</script>

<template>
  <div class="flex min-h-11 items-center justify-between gap-3">
    <span class="text-[13px] font-semibold">{{ label }}</span>
    <button
      type="button"
      role="switch"
      class="flex min-h-11 items-center gap-2 rounded-full px-1 text-xs text-muted"
      :aria-checked="checked"
      :aria-label="label"
      @click="$emit('toggle')"
    >
      <span class="text-[12px]">{{ stateText }}</span>
      <span
        class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
        :class="checked ? 'bg-fill' : 'bg-line'"
        aria-hidden="true"
      >
        <span
          class="absolute left-0.5 size-5 rounded-full bg-white shadow transition-transform"
          :class="checked ? 'translate-x-5' : 'translate-x-0'"
        />
      </span>
    </button>
  </div>
</template>
