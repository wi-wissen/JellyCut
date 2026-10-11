<script lang="ts">
import { defineComponent, type PropType } from 'vue'

export default defineComponent({
  name: 'Callout',
  props: {
    kind: { type: String as PropType<'note' | 'tip'>, default: 'note' }
  },
  computed: {
    label(): string {
      return this.kind === 'tip' ? this.$t('help.common.tip') : this.$t('help.common.note')
    }
  }
})
</script>

<template>
  <aside class="flex gap-3 rounded-xl border border-line border-l-4 border-l-txt bg-panel p-4 text-base leading-relaxed" :aria-label="label">
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="mt-0.5 size-5 shrink-0 text-txt" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path v-if="kind === 'tip'" d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM19 16v4M17 18h4" />
      <path v-else d="M6 3h12v18l-6-4-6 4z" />
    </svg>
    <div class="min-w-0">
      <p class="font-bold text-txt">{{ label }}</p>
      <div class="mt-1 space-y-2"><slot /></div>
    </div>
  </aside>
</template>
