<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { projectFit } from '../../core/project/format'
import type { FitMode } from '../../core/project/types'

/** Project-wide Fit / Fill choice. Used by the picture fit chip and the format popover. */
export default defineComponent({
  name: 'FitSwitch',
  computed: {
    ...mapState(useEditorStore, ['project']),
    fit(): FitMode {
      return projectFit(this.project)
    },
    options(): { value: FitMode; label: string }[] {
      return [
        { value: 'fit', label: this.$t('player.fitMode') },
        { value: 'fill', label: this.$t('player.fillMode') }
      ]
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['setProjectFit']),
    choose(fit: FitMode): void {
      if (fit !== this.fit) this.setProjectFit(fit)
    }
  }
})
</script>

<template>
  <section class="flex flex-col gap-2" data-role="fit-switch">
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('player.pictureFit.title') }}</h2>
    <div class="grid grid-cols-2 gap-1.5 rounded-lg bg-panel2 p-[3px]" role="radiogroup" :aria-label="$t('player.pictureFit.title')">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        class="min-h-11 rounded-md text-[13px] font-semibold"
        :class="fit === option.value ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
        :aria-checked="fit === option.value"
        @click="choose(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
    <p class="text-[12px] leading-snug text-fg">{{ $t('player.pictureFit.explain') }}</p>
    <p class="text-[11px] leading-snug text-muted">{{ $t('player.pictureFit.scope') }}</p>
  </section>
</template>
