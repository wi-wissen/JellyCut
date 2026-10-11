<script lang="ts">
import { defineComponent } from 'vue'

let sequence = 0

export default defineComponent({
  name: 'RangeField',
  props: {
    label: { type: String, required: true },
    modelValue: { type: Number, required: true },
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    step: { type: Number, default: 1 },
    /** Text shown next to the label and announced as the slider's value. */
    display: { type: String, required: true }
  },
  emits: {
    update: (value: number) => Number.isFinite(value),
    /** The drag or key press ended; the parent closes the undo step. */
    commit: () => true
  },
  data() {
    sequence += 1
    return { uid: `jc-range-${sequence}` }
  },
  computed: {
    percent(): number {
      const span = this.max - this.min
      if (span <= 0) return 0
      return Math.min(100, Math.max(0, ((this.modelValue - this.min) / span) * 100))
    }
  },
  methods: {
    onInput(event: Event): void {
      this.$emit('update', Number((event.target as HTMLInputElement).value))
    }
  }
})
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <div class="flex items-baseline justify-between gap-2">
      <label :for="uid" class="text-[13px] font-semibold">{{ label }}</label>
      <span class="shrink-0 text-xs [font-variant-numeric:tabular-nums] text-muted">{{ display }}</span>
    </div>
    <input
      :id="uid"
      type="range"
      class="jc-range h-11 w-full"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :aria-valuetext="display"
      :style="{ '--jc-p': percent + '%' }"
      @input="onInput"
      @change="$emit('commit')"
    />
  </div>
</template>

<style scoped>
.jc-range {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  margin: 0;
}
.jc-range::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--jc-fill) var(--jc-p), var(--jc-line) var(--jc-p));
}
.jc-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -7px;
  border-radius: 50%;
  border: 2px solid var(--jc-fill);
  background: var(--jc-signal);
}
.jc-range::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--jc-fill) var(--jc-p), var(--jc-line) var(--jc-p));
}
.jc-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--jc-fill);
  background: var(--jc-signal);
}
</style>
