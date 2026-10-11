<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ColorPicker from './ColorPicker.vue'
import RangeField from './RangeField.vue'
import { useEditorStore } from '../../stores/editor'
import { LINE_WIDTHS, type LineWidthId } from '../../../core/timeline/overlayCatalog'

/**
 * Pen settings. Drawing stays on after each stroke, until "Done" or until another tab is opened.
 * The pointer work happens in PlayerOverlay while drawing is on.
 */
export default defineComponent({
  name: 'DrawPanel',
  components: { Icon, ColorPicker, RangeField },
  data() {
    // Bar heights in the pen buttons: a hint of the width, not the real size.
    return { widths: Object.keys(LINE_WIDTHS) as LineWidthId[], bars: { thin: 2, medium: 4, thick: 7 } as Record<LineWidthId, number> }
  },
  computed: {
    ...mapState(useEditorStore, ['overlayColor', 'penWidth', 'penOpacity', 'penCap', 'drawing', 'strokeCount']),
    opacityPercent(): number {
      return Math.round(this.penOpacity * 100)
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['setDrawing', 'setOverlayColor', 'setPenWidth', 'setPenOpacity', 'applyMarkerPreset', 'undoLastStroke']),
    widthName(id: LineWidthId): string {
      return this.$t(`overlays.penWidths.${id}`)
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-sm font-bold">{{ $t('tabs.draw') }}</h2>

    <button
      type="button"
      class="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-bold"
      :class="drawing ? 'bg-signal text-signal-fg' : 'bg-fill text-fill-fg hover:opacity-90'"
      :aria-pressed="drawing"
      @click="setDrawing(!drawing)"
    >
      <Icon :name="drawing ? 'check' : 'draw'" class="size-4" />
      {{ drawing ? $t('overlays.done') : $t('overlays.startDrawing') }}
    </button>
    <p class="text-xs leading-relaxed text-muted">{{ drawing ? $t('overlays.drawHintOn') : $t('overlays.drawHint') }}</p>

    <div class="flex flex-col gap-3 border-t border-line pt-3">
      <ColorPicker :model-value="overlayColor" :group-label="$t('design.colour')" @update="setOverlayColor" />

      <div class="flex flex-col gap-2">
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
            <span class="inline-block w-6 rounded-full" :style="{ height: `${bars[width]}px`, background: 'currentColor' }" aria-hidden="true" />
            {{ widthName(width) }}
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <RangeField
          :label="$t('overlays3.penOpacity')"
          :model-value="opacityPercent"
          :min="0"
          :max="100"
          :display="`${opacityPercent}%`"
          @update="(percent: number) => setPenOpacity(percent / 100)"
        />
        <button
          type="button"
          class="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold"
          :class="penCap === 'flat' ? 'bg-fill text-fill-fg' : 'bg-panel2 text-fg hover:bg-panel'"
          :aria-pressed="penCap === 'flat'"
          @click="applyMarkerPreset"
        >
          {{ $t('overlays3.markerPreset') }}
        </button>
      </div>

      <div class="flex flex-col gap-2">
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
      </div>
    </div>
  </div>
</template>
