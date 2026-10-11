<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ColorPicker from './ColorPicker.vue'
import { useEditorStore } from '../../stores/editor'
import { SHAPE_KINDS, STICKERS } from '../../../core/timeline/overlayCatalog'
import type { ShapeOverlay } from '../../../core/project/types'

/** Stickers and shapes; each click adds one item at the playhead and selects it for editing. */
export default defineComponent({
  name: 'StickerPanel',
  components: { Icon, ColorPicker },
  data() {
    return { stickers: STICKERS, shapes: SHAPE_KINDS }
  },
  computed: {
    ...mapState(useEditorStore, ['overlayColor'])
  },
  methods: {
    ...mapActions(useEditorStore, ['addStickerAtPlayhead', 'addShapeAtPlayhead', 'setOverlayColor']),
    stickerName(id: string): string {
      return this.$t(`overlays.stickerNames.${id}`)
    },
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
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays.panel') }}</h2>
    <p class="text-[11px] text-muted">{{ $t('overlays.stickerHint') }}</p>
    <div class="grid grid-cols-4 gap-2" role="group" :aria-label="$t('overlays.panel')">
      <button
        v-for="sticker in stickers"
        :key="sticker.id"
        type="button"
        class="flex aspect-square min-h-11 items-center justify-center rounded-lg bg-panel2 text-[26px] leading-none hover:bg-panel"
        :aria-label="stickerName(sticker.id)"
        :title="stickerName(sticker.id)"
        @click="addStickerAtPlayhead(sticker.emoji)"
      >
        <span aria-hidden="true">{{ sticker.emoji }}</span>
      </button>
    </div>

    <section class="flex flex-col gap-2 border-t border-line pt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays.shapes') }}</h3>
      <p class="text-[11px] text-muted">{{ $t('overlays.shapeHint') }}</p>
      <div class="grid grid-cols-3 gap-2" role="group" :aria-label="$t('overlays.shapes')">
        <button
          v-for="shape in shapes"
          :key="shape"
          type="button"
          class="flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg bg-panel2 text-xs font-semibold text-fg hover:bg-panel"
          :aria-label="shapeName(shape)"
          @click="addShapeAtPlayhead(shape)"
        >
          <Icon :name="shapeIcon(shape)" class="size-4" />
          <span class="max-w-full truncate">{{ shapeName(shape) }}</span>
        </button>
      </div>
      <ColorPicker
        :model-value="overlayColor"
        :group-label="$t('overlays.color')"
        @update="setOverlayColor"
      />
    </section>
  </div>
</template>
