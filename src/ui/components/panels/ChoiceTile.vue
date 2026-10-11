<script lang="ts">
import { defineComponent } from 'vue'

/** One choice in a tile grid (filters, transitions). The selected tile has a thick frame and a check badge. */
export default defineComponent({
  name: 'ChoiceTile',
  props: {
    label: { type: String, required: true },
    selected: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    /** Tailwind aspect class of the picture area. */
    aspect: { type: String, default: 'aspect-video' },
    /** Extra words for screen readers, read after the label. */
    description: { type: String, default: '' }
  },
  emits: ['choose']
})
</script>

<template>
  <button
    type="button"
    class="jc-tile flex flex-col gap-1.5 rounded-lg text-left disabled:opacity-50"
    :aria-pressed="selected ? 'true' : 'false'"
    :disabled="disabled"
    @click="$emit('choose')"
  >
    <span
      class="relative block w-full overflow-hidden rounded-lg border-[3px] bg-stage"
      :class="[aspect, selected ? 'border-fill' : 'border-transparent']"
    >
      <slot />
      <span
        v-if="selected"
        class="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-fill text-fill-fg shadow"
        aria-hidden="true"
      >
        <svg viewBox="0 0 12 12" class="size-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.5 6.2 5 8.5 9.5 3.5" />
        </svg>
      </span>
    </span>
    <span class="flex items-center text-xs font-semibold text-fg">{{ label }}<span v-if="description" class="sr-only">, {{ description }}</span></span>
  </button>
</template>
