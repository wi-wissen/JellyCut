<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import ChoiceTile from './ChoiceTile.vue'
import ColorPicker from './ColorPicker.vue'
import { useEditorStore } from '../../stores/editor'
import { STICKER_SHAPES } from '../../../core/render/stickerShapes'

/** Gallery of the built-in vector stickers. A tap adds one at the playhead, drawn in the colour below. */
export default defineComponent({
  name: 'StickerPanel',
  components: { ChoiceTile, ColorPicker },
  data() {
    return { stickers: STICKER_SHAPES }
  },
  computed: {
    ...mapState(useEditorStore, ['overlayColor'])
  },
  methods: {
    ...mapActions(useEditorStore, ['addVectorStickerAtPlayhead', 'setOverlayColor']),
    stickerName(id: string): string {
      return this.$t(`overlays3.sticker.${id}`)
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-sm font-bold">{{ $t('tabs.sticker') }}</h2>
    <p class="text-xs leading-relaxed text-muted">{{ $t('overlays.stickerHint') }}</p>
    <div class="grid grid-cols-3 gap-2.5" role="group" :aria-label="$t('tabs.sticker')">
      <ChoiceTile
        v-for="sticker in stickers"
        :key="sticker.id"
        :label="stickerName(sticker.id)"
        aspect="aspect-square"
        @choose="addVectorStickerAtPlayhead(sticker.id)"
      >
        <span class="absolute inset-0 flex items-center justify-center p-[22%]" :style="{ color: overlayColor }" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="size-full">
            <path
              :d="sticker.d"
              :fill="sticker.kind === 'fill' ? 'currentColor' : 'none'"
              :stroke="sticker.kind === 'line' ? 'currentColor' : 'none'"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill-rule="evenodd"
            />
          </svg>
        </span>
      </ChoiceTile>
    </div>
    <div class="border-t border-line pt-3">
      <ColorPicker :model-value="overlayColor" :group-label="$t('design.colour')" @update="setOverlayColor" />
    </div>
  </div>
</template>
