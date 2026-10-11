<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ColorPicker from './ColorPicker.vue'
import { useEditorStore } from '../../stores/editor'
import { SHAPE_KINDS } from '../../../core/timeline/overlayCatalog'
import { STICKER_SHAPES } from '../../../core/render/stickerShapes'
import type { ShapeOverlay } from '../../../core/project/types'

/** Stickers, shapes, blur areas and pictures; each click adds one item at the playhead and selects it for editing. */
export default defineComponent({
  name: 'StickerPanel',
  components: { Icon, ColorPicker },
  data() {
    return { stickers: STICKER_SHAPES, shapes: SHAPE_KINDS }
  },
  computed: {
    ...mapState(useEditorStore, ['overlayColor', 'project']),
    /** Library images and videos can be placed as pictures; audio cannot. */
    pictureAssets() {
      return this.project.assets.filter((a) => a.kind !== 'audio')
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['addVectorStickerAtPlayhead', 'addShapeAtPlayhead', 'addRegionAtPlayhead', 'addMediaAtPlayhead', 'setOverlayColor']),
    stickerName(id: string): string {
      return this.$t(`overlays3.sticker.${id}`)
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
        @click="addVectorStickerAtPlayhead(sticker.id)"
      >
        <svg viewBox="0 0 24 24" class="size-8" aria-hidden="true">
          <path
            :d="sticker.d"
            :fill="sticker.kind === 'fill' ? 'currentColor' : 'none'"
            :stroke="sticker.kind === 'line' ? 'currentColor' : 'none'"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill-rule="evenodd"
          />
        </svg>
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

    <section class="flex flex-col gap-2 border-t border-line pt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays2.regionsTitle') }}</h3>
      <p class="text-[11px] text-muted">{{ $t('overlays2.regionHint') }}</p>
      <div class="grid grid-cols-2 gap-2" role="group" :aria-label="$t('overlays2.regionsTitle')">
        <button
          type="button"
          class="flex min-h-11 items-center justify-center rounded-lg bg-panel2 px-2 text-center text-xs font-semibold text-fg hover:bg-panel"
          @click="addRegionAtPlayhead('blur')"
        >
          {{ $t('overlays2.blurAction') }}
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center justify-center rounded-lg bg-panel2 px-2 text-center text-xs font-semibold text-fg hover:bg-panel"
          @click="addRegionAtPlayhead('pixelate')"
        >
          {{ $t('overlays2.pixelateAction') }}
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-2 border-t border-line pt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays2.picturesTitle') }}</h3>
      <p class="text-[11px] text-muted">{{ $t('overlays2.pictureHint') }}</p>
      <p v-if="pictureAssets.length === 0" class="text-[11px] text-muted">{{ $t('overlays2.noPictures') }}</p>
      <ul v-else class="flex flex-col gap-1.5">
        <li v-for="asset in pictureAssets" :key="asset.id">
          <button
            type="button"
            class="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg bg-panel2 px-2 text-left text-xs text-fg hover:bg-panel"
            :aria-label="$t('overlays2.addPicture', { name: asset.name })"
            :title="$t('overlays2.addPicture', { name: asset.name })"
            @click="addMediaAtPlayhead(asset.id)"
          >
            <span class="truncate font-semibold">{{ asset.name }}</span>
            <span class="shrink-0 text-[11px] text-muted">{{ $t(`overlays2.pictureKind.${asset.kind}`) }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
