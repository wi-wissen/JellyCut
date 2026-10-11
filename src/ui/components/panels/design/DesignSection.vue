<script lang="ts">
import { defineComponent } from 'vue'

/** One titled block of an item's settings. Text and every overlay kind use the same blocks in the same order. */
export default defineComponent({
  name: 'DesignSection',
  props: {
    title: { type: String, required: true },
    first: { type: Boolean, default: false }
  }
})
</script>

<template>
  <section class="flex flex-col gap-2" :class="first ? 'pt-1' : 'border-t border-line pt-3'">
    <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ title }}</h3>
    <slot />
  </section>
</template>
