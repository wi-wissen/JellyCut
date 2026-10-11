<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ChoiceTile from './ChoiceTile.vue'
import ColorPicker from './ColorPicker.vue'
import { useEditorStore } from '../../stores/editor'
import { SHAPE_KINDS } from '../../../core/timeline/overlayCatalog'
import type { ShapeOverlay } from '../../../core/project/types'

/** Frames, ellipses and arrows. A tap adds one at the playhead in the colour below. */
export default defineComponent({
  name: 'ShapePanel',
  components: { Icon, ChoiceTile, ColorPicker },
  data() {
    return { shapes: SHAPE_KINDS }
  },
  computed: {
    ...mapState(useEditorStore, ['overlayColor'])
  },
  methods: {
    ...mapActions(useEditorStore, ['addShapeAtPlayhead', 'setOverlayColor']),
    shapeName(shape: ShapeOverlay['shape']): string {
      return this.$t(`overlays.shape.${shape}`)
    },
    shapeIcon(shape: ShapeOverlay['shape']): string {
      return `shape${shape.charAt(0).toUpperCase()}${shape.slice(1)}`
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-sm font-bold">{{ $t('tabs.shape') }}</h2>
    <p class="text-xs leading-relaxed text-muted">{{ $t('overlays.shapeHint') }}</p>
    <div class="grid grid-cols-3 gap-2.5" role="group" :aria-label="$t('tabs.shape')">
      <ChoiceTile v-for="shape in shapes" :key="shape" :label="shapeName(shape)" aspect="aspect-square" @choose="addShapeAtPlayhead(shape)">
        <span class="absolute inset-0 flex items-center justify-center" :style="{ color: overlayColor }" aria-hidden="true">
          <Icon :name="shapeIcon(shape)" class="size-[46%]" />
        </span>
      </ChoiceTile>
    </div>
    <div class="border-t border-line pt-3">
      <ColorPicker :model-value="overlayColor" :group-label="$t('design.colour')" @update="setOverlayColor" />
    </div>
  </div>
</template>
