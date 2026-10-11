<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ChoiceTile from './ChoiceTile.vue'
import { useEditorStore } from '../../stores/editor'
import { REGION_SHAPES } from '../../../core/timeline/overlayCatalog'
import type { RegionOverlay } from '../../../core/project/types'

/** Blur and pixelate areas: the shape for new areas, then one tap per area at the playhead. */
export default defineComponent({
  name: 'RegionPanel',
  components: { Icon, ChoiceTile },
  data() {
    return { shapes: REGION_SHAPES }
  },
  computed: {
    ...mapState(useEditorStore, ['regionShape'])
  },
  methods: {
    ...mapActions(useEditorStore, ['addRegionAtPlayhead', 'setRegionShape']),
    shapeName(shape: RegionOverlay['shape']): string {
      return this.$t(`overlays3.regionShape.${shape}`)
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-sm font-bold">{{ $t('tabs.region') }}</h2>
    <p class="text-xs leading-relaxed text-muted">{{ $t('overlays2.regionHint') }}</p>

    <div class="flex flex-col gap-2">
      <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('design.areaShape') }}</span>
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-panel2 p-[3px]" role="group" :aria-label="$t('design.areaShape')">
        <button
          v-for="shape in shapes"
          :key="shape"
          type="button"
          class="min-h-11 rounded-md text-xs font-semibold"
          :class="regionShape === shape ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
          :aria-pressed="regionShape === shape"
          @click="setRegionShape(shape)"
        >
          {{ shapeName(shape) }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2.5" role="group" :aria-label="$t('tabs.region')">
      <ChoiceTile :label="$t('overlays2.blurAction')" aspect="aspect-[4/3]" @choose="addRegionAtPlayhead('blur')">
        <span class="absolute inset-0 bg-[linear-gradient(135deg,#ff5ca8,#ffe14d_50%,#3ab0ff)]" aria-hidden="true" />
        <span class="absolute inset-[18%] rounded-lg bg-white/10 backdrop-blur-md" aria-hidden="true" />
      </ChoiceTile>
      <ChoiceTile :label="$t('overlays2.pixelateAction')" aspect="aspect-[4/3]" @choose="addRegionAtPlayhead('pixelate')">
        <span class="absolute inset-0 bg-[linear-gradient(135deg,#3ab0ff,#ffe14d_50%,#ff5ca8)]" aria-hidden="true" />
        <span class="absolute inset-[18%] grid grid-cols-3 grid-rows-3 overflow-hidden rounded-lg" aria-hidden="true">
          <span v-for="n in 9" :key="n" class="bg-white/20 odd:bg-white/0" />
        </span>
      </ChoiceTile>
    </div>
  </div>
</template>
