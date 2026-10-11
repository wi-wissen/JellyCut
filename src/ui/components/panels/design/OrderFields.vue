<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions } from 'pinia'
import Icon from '../../Icon.vue'
import { useEditorStore } from '../../../stores/editor'

/**
 * Stacking of the selected overlay. Text is always drawn above all overlays, so for text this only shows the hint.
 */
export default defineComponent({
  name: 'OrderFields',
  components: { Icon },
  props: {
    hintOnly: { type: Boolean, default: false }
  },
  data() {
    return {
      steps: [
        { direction: 'front', icon: 'orderFront', key: 'design.toFront' },
        { direction: 'forward', icon: 'orderUp', key: 'design.forward' },
        { direction: 'backward', icon: 'orderDown', key: 'design.backward' },
        { direction: 'back', icon: 'orderBack', key: 'design.toBack' }
      ] as const
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['stackSelectedOverlay'])
  }
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="hintOnly" class="text-[11px] text-muted">{{ $t('design.orderHint') }}</p>
    <template v-else>
      <div class="grid grid-cols-2 gap-2" role="group" :aria-label="$t('design.order')">
        <button
          v-for="step in steps"
          :key="step.direction"
          type="button"
          class="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-panel2 px-2 text-xs font-semibold text-fg hover:bg-panel"
          @click="stackSelectedOverlay(step.direction)"
        >
          <Icon :name="step.icon" class="size-4 shrink-0" />
          <span class="min-w-0 truncate">{{ $t(step.key) }}</span>
        </button>
      </div>
    </template>
  </div>
</template>
