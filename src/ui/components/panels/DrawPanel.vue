<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ColorPicker from './ColorPicker.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { useEditorStore } from '../../stores/editor'
import { LINE_WIDTHS, type LineWidthId } from '../../../core/timeline/overlayCatalog'

/** Pen settings and the drawing switch. The pointer work happens in PlayerOverlay while drawing is on. */
export default defineComponent({
  name: 'DrawPanel',
  components: { Icon, ColorPicker, ToggleSwitch },
  data() {
    // Bar heights in the pen buttons: a hint of the width, not the real size.
    return { widths: Object.keys(LINE_WIDTHS) as LineWidthId[], bars: { thin: 2, medium: 4, thick: 7 } as Record<LineWidthId, number> }
  },
  computed: {
    ...mapState(useEditorStore, ['overlayColor', 'penWidth', 'drawing', 'strokeCount'])
  },
  methods: {
    ...mapActions(useEditorStore, ['setDrawing', 'setOverlayColor', 'setPenWidth', 'undoLastStroke']),
    widthName(id: LineWidthId): string {
      return this.$t(`overlays.penWidths.${id}`)
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays.drawPanel') }}</h2>
    <ToggleSwitch
      :label="$t('overlays.drawToggle')"
      :state-text="drawing ? $t('overlays.drawOn') : $t('overlays.drawOff')"
      :checked="drawing"
      @toggle="setDrawing(!drawing)"
    />
    <p class="text-[11px] text-muted">{{ $t('overlays.drawHint') }}</p>

    <section class="flex flex-col gap-2 border-t border-line pt-3">
      <ColorPicker
        :model-value="overlayColor"
        :group-label="$t('overlays.color')"
        @update="setOverlayColor"
      />
    </section>

    <section class="flex flex-col gap-2 border-t border-line pt-3">
      <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays.penWidth') }}</span>
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-panel2 p-[3px]" role="group" :aria-label="$t('overlays.penWidth')">
        <button
          v-for="width in widths"
          :key="width"
          type="button"
          class="flex min-h-11 items-center justify-center gap-1.5 rounded-md text-xs font-semibold"
          :class="penWidth === width ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
          :aria-pressed="penWidth === width"
          @click="setPenWidth(width)"
        >
          <span
            class="inline-block w-6 rounded-full"
            :style="{ height: `${bars[width]}px`, background: 'currentColor' }"
            aria-hidden="true"
          />
          {{ widthName(width) }}
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-2 border-t border-line pt-3">
      <button
        type="button"
        class="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-panel2 text-sm font-semibold text-fg hover:bg-panel disabled:opacity-45"
        :disabled="strokeCount === 0"
        @click="undoLastStroke"
      >
        <Icon name="undo" class="size-4" />
        {{ $t('overlays.undoStroke') }}
      </button>
      <p v-if="strokeCount === 0" class="text-[11px] text-muted">{{ $t('overlays.noStrokes') }}</p>
    </section>
  </div>
</template>
