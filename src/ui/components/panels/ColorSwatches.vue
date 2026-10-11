<script lang="ts">
import { defineComponent, type PropType } from 'vue'

export const SWATCHES: readonly string[] = ['#ffffff', '#14121f', '#c6f432', '#ffe066', '#ff5ca8', '#6d4cf5']

export default defineComponent({
  name: 'ColorSwatches',
  props: {
    modelValue: { type: String, required: true },
    colors: { type: Array as PropType<readonly string[]>, default: () => SWATCHES },
    groupLabel: { type: String, required: true },
    customLabel: { type: String, required: true }
  },
  emits: {
    update: (hex: string) => /^#[0-9a-fA-F]{6}$/.test(hex),
    commit: () => true
  },
  methods: {
    same(a: string, b: string): boolean {
      return a.toLowerCase() === b.toLowerCase()
    }
  }
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="groupLabel">
    <button
      v-for="hex in colors"
      :key="hex"
      type="button"
      class="flex size-11 items-center justify-center rounded-lg hover:bg-panel2"
      :aria-pressed="same(modelValue, hex)"
      :aria-label="$t('text.swatch', { hex })"
      :title="hex"
      @click="$emit('update', hex)"
    >
      <span
        class="size-7 rounded-full border border-line"
        :class="same(modelValue, hex) ? 'ring-2 ring-fill ring-offset-2 ring-offset-panel' : ''"
        :style="{ background: hex }"
        aria-hidden="true"
      />
    </button>
    <label class="flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-panel2" :title="customLabel">
      <span class="sr-only">{{ customLabel }}</span>
      <input
        type="color"
        class="size-7 cursor-pointer rounded-full border border-line bg-transparent p-0"
        :value="modelValue"
        @input="$emit('update', ($event.target as HTMLInputElement).value)"
        @change="$emit('commit')"
      />
    </label>
  </div>
</template>
