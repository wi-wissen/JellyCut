<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions, mapState } from 'pinia'
import BackLink from './BackLink.vue'
import RangeField from './RangeField.vue'
import ColorPicker from './ColorPicker.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import DesignSection from './design/DesignSection.vue'
import TimeFields from './design/TimeFields.vue'
import AnimationFields from './design/AnimationFields.vue'
import OrderFields from './design/OrderFields.vue'
import ItemActions from './design/ItemActions.vue'
import { useEditorStore } from '../../stores/editor'
import type { OverlayItem } from '../../../core/project/types'
import type { OverlayPatch } from '../../../core/timeline/overlayOps'
import { REFERENCE_HEIGHT, REGION_EFFECTS, REGION_SHAPES, SHAPE_KINDS } from '../../../core/timeline/overlayCatalog'
import type { Asset } from '../../../core/project/types'
import { STICKER_SHAPES } from '../../../core/render/stickerShapes'
import { stickerImageUrl } from '../../../engine/render/stickerImages'
import { PICTURE_SHAPES, pictureShapeOf, pictureShapePatch, type PictureShape } from '../../../core/timeline/mediaShape'

const DEFAULT_OUTLINE = '#14121f'
const SPEED_MIN = 25
const SPEED_MAX = 200

/**
 * Settings of one sticker, shape, stroke, blur area or picture. Sections in the same order as for text:
 * Content, Look, Time, Animation, Order, Actions. Size and turning are done with the handles in the preview.
 */
export default defineComponent({
  name: 'OverlayProperties',
  components: { BackLink, RangeField, ColorPicker, ToggleSwitch, DesignSection, TimeFields, AnimationFields, OrderFields, ItemActions },
  props: {
    item: { type: Object as PropType<OverlayItem>, required: true }
  },
  data() {
    return {
      stickers: STICKER_SHAPES,
      shapeKinds: SHAPE_KINDS,
      regionShapes: REGION_SHAPES,
      regionEffects: REGION_EFFECTS,
      pictureShapes: PICTURE_SHAPES,
      defaultOutline: DEFAULT_OUTLINE,
      speedMin: SPEED_MIN,
      speedMax: SPEED_MAX,
      referenceHeight: REFERENCE_HEIGHT
    }
  },
  computed: {
    ...mapState(useEditorStore, ['project']),
    asset(): Asset | null {
      const item = this.item
      if (item.kind !== 'media') return null
      return this.project.assets.find((a) => a.id === item.assetId) ?? null
    },
    header(): string {
      const item = this.item
      if (item.kind === 'sticker') return this.$t('overlays.header.sticker', { name: item.imageId !== undefined ? this.$t(`stickers.image.${item.imageId}`) : item.emoji ?? this.$t(`overlays3.sticker.${item.shape}`) })
      if (item.kind === 'shape') return this.$t('overlays.header.shape', { name: this.$t(`overlays.shape.${item.shape}`) })
      if (item.kind === 'region') return this.$t('overlays2.regionHeader', { name: this.$t(`overlays2.effects.${item.effect}`) })
      if (item.kind === 'media') return this.$t('overlays2.pictureHeader', { name: this.asset?.name ?? '' })
      return this.$t('overlays.header.stroke')
    },
    /** A vector sticker (not a legacy emoji) can change its shape and outline. */
    isVectorSticker(): boolean {
      return this.item.kind === 'sticker' && this.item.shape !== undefined
    },
    /** The item's colour, or the border colour of a picture; null when the kind has none. */
    colour(): string | null {
      const item = this.item
      if (item.kind === 'sticker') return item.color ?? null
      if (item.kind === 'shape' || item.kind === 'stroke') return item.color
      if (item.kind === 'media') return item.borderColor
      return null
    },
    colourLabel(): string {
      return this.item.kind === 'media' ? this.$t('overlays2.borderColor') : this.$t('design.colour')
    },
    outlineOn(): boolean {
      return this.item.kind === 'sticker' && !!this.item.outline
    },
    opacityPercent(): number {
      return Math.round((this.item.opacity ?? 1) * 100)
    },
    lineWidthPx(): number {
      const item = this.item
      return item.kind === 'shape' || item.kind === 'stroke' ? Math.round(item.lineWidth * REFERENCE_HEIGHT) : 0
    },
    borderPx(): number {
      const item = this.item
      return item.kind === 'media' ? Math.round(item.border * REFERENCE_HEIGHT) : 0
    },
    pictureShape(): PictureShape | null {
      const item = this.item
      return item.kind === 'media' ? pictureShapeOf(item) : null
    },
    isVideoPicture(): boolean {
      return this.asset?.kind === 'video'
    },
    startSeconds(): number {
      const item = this.item
      return item.kind === 'media' ? Math.round((item.srcIn ?? 0) / 100_000) / 10 : 0
    },
    speedPercent(): number {
      const item = this.item
      return item.kind === 'media' ? Math.round((item.speed ?? 1) * 100) : 100
    },
    strengthPercent(): number {
      const item = this.item
      return item.kind === 'region' ? Math.round(item.strength * 100) : 0
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['updateSelectedOverlay', 'endGesture']),
    /** Changes that come from a slider or a typed value share one undo step per field (see `field`). */
    patch(change: OverlayPatch, field?: string): void {
      this.updateSelectedOverlay(change, field ? `overlay-${field}:${this.item.id}` : undefined)
    },
    commit(): void {
      this.endGesture()
    },
    stickerName(id: string): string {
      return this.$t(`overlays3.sticker.${id}`)
    },
    imageUrl(id: string): string {
      return stickerImageUrl(id)
    },
    shapeName(shape: string): string {
      return this.$t(`overlays.shape.${shape}`)
    },
    setPictureShape(shape: PictureShape): void {
      const item = this.item
      if (item.kind !== 'media' || !this.asset) return
      const aspect = this.asset.width && this.asset.height ? this.asset.width / this.asset.height : 16 / 9
      this.patch(pictureShapePatch(shape, item, aspect))
    },
    pictureShapeName(shape: PictureShape): string {
      return this.$t(`overlays2.pictureShapes.${shape}`)
    },
    setStart(event: Event): void {
      const seconds = Number((event.target as HTMLInputElement).value)
      if (Number.isFinite(seconds)) this.patch({ srcIn: Math.max(0, Math.round(seconds * 1_000_000)) })
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
    <div class="flex min-w-0 items-center justify-between gap-2">
      <BackLink :label="$t('design.back')" />
      <h2 class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ header }}</h2>
    </div>

    <DesignSection :title="$t('design.content')" first>
      <!-- Stickers: the shape picker and the outline. Legacy emoji stickers only show their emoji. -->
      <template v-if="item.kind === 'sticker'">
        <img
          v-if="item.imageId !== undefined"
          :src="imageUrl(item.imageId)"
          alt=""
          class="size-16 object-contain"
          aria-hidden="true"
        />
        <p v-else-if="!isVectorSticker" class="text-2xl leading-none" aria-hidden="true">{{ item.emoji }}</p>
        <template v-else>
          <div class="grid grid-cols-6 gap-1.5" role="group" :aria-label="$t('tabs.sticker')">
            <button
              v-for="sticker in stickers"
              :key="sticker.id"
              type="button"
              class="flex min-h-11 items-center justify-center rounded-lg text-fg"
              :class="item.shape === sticker.id ? 'bg-fill text-fill-fg' : 'bg-panel2 hover:bg-panel'"
              :aria-label="stickerName(sticker.id)"
              :aria-pressed="item.shape === sticker.id"
              :title="stickerName(sticker.id)"
              @click="patch({ shape: sticker.id })"
            >
              <svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
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
          <ToggleSwitch
            :label="$t('text.outline')"
            :state-text="outlineOn ? $t('timeline.on') : $t('timeline.off')"
            :checked="outlineOn"
            @toggle="patch({ outline: outlineOn ? null : defaultOutline })"
          />
          <ColorPicker
            v-if="outlineOn"
            :model-value="item.outline ?? defaultOutline"
            :group-label="$t('text.outlineColor')"
            @update="(hex: string) => patch({ outline: hex }, 'outline')"
            @commit="commit"
          />
        </template>
      </template>

      <!-- Shapes: the kind and the line width. -->
      <template v-else-if="item.kind === 'shape'">
        <div class="grid grid-cols-3 gap-1 rounded-lg bg-panel2 p-[3px]" role="group" :aria-label="$t('overlays.shapes')">
          <button
            v-for="shape in shapeKinds"
            :key="shape"
            type="button"
            class="min-h-11 rounded-md text-xs font-semibold"
            :class="item.shape === shape ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
            :aria-pressed="item.shape === shape"
            @click="patch({ shape })"
          >
            {{ shapeName(shape) }}
          </button>
        </div>
        <RangeField
          :label="$t('overlays.lineWidth')"
          :model-value="lineWidthPx"
          :min="1"
          :max="54"
          :display="`${lineWidthPx} px`"
          @update="(px: number) => patch({ lineWidth: px / referenceHeight }, 'line')"
          @commit="commit"
        />
      </template>

      <!-- Strokes: only the line width; the colour is in Look. -->
      <template v-else-if="item.kind === 'stroke'">
        <RangeField
          :label="$t('overlays.lineWidth')"
          :model-value="lineWidthPx"
          :min="1"
          :max="54"
          :display="`${lineWidthPx} px`"
          @update="(px: number) => patch({ lineWidth: px / referenceHeight }, 'line')"
          @commit="commit"
        />
      </template>

      <!-- Blur and pixelate areas: the effect, the shape and the strength. -->
      <template v-else-if="item.kind === 'region'">
        <div class="grid grid-cols-2 gap-1 rounded-lg bg-panel2 p-[3px]" role="group" :aria-label="$t('overlays2.effect')">
          <button
            v-for="effect in regionEffects"
            :key="effect"
            type="button"
            class="min-h-11 rounded-md text-xs font-semibold"
            :class="item.effect === effect ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
            :aria-pressed="item.effect === effect"
            @click="patch({ effect })"
          >
            {{ $t(`overlays2.effects.${effect}`) }}
          </button>
        </div>
        <div class="grid grid-cols-3 gap-1 rounded-lg bg-panel2 p-[3px]" role="group" :aria-label="$t('overlays.shapes')">
          <button
            v-for="shape in regionShapes"
            :key="shape"
            type="button"
            class="min-h-11 rounded-md text-xs font-semibold"
            :class="item.shape === shape ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
            :aria-pressed="item.shape === shape"
            @click="patch({ shape })"
          >
            {{ $t(`overlays3.regionShape.${shape}`) }}
          </button>
        </div>
        <RangeField
          :label="$t('overlays2.strength')"
          :model-value="strengthPercent"
          :min="0"
          :max="100"
          :display="`${strengthPercent}%`"
          @update="(percent: number) => patch({ strength: percent / 100 }, 'strength')"
          @commit="commit"
        />
      </template>

      <!-- Pictures: the shape preset, the start in the video, the speed and the border width. -->
      <template v-else-if="item.kind === 'media'">
        <div class="grid grid-cols-3 gap-1 rounded-lg bg-panel2 p-[3px]" role="group" :aria-label="$t('overlays2.pictureShape')">
          <button
            v-for="shape in pictureShapes"
            :key="shape"
            type="button"
            class="min-h-11 rounded-md text-xs font-semibold"
            :class="pictureShape === shape ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
            :aria-pressed="pictureShape === shape"
            @click="setPictureShape(shape)"
          >
            {{ pictureShapeName(shape) }}
          </button>
        </div>
        <div v-if="isVideoPicture" class="flex flex-col gap-1">
          <label :for="`media-start-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays2.pictureStart') }}</label>
          <input
            :id="`media-start-${item.id}`"
            type="number"
            min="0"
            step="0.1"
            class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg [font-variant-numeric:tabular-nums]"
            :value="startSeconds"
            @change="setStart"
          />
        </div>
        <RangeField
          v-if="isVideoPicture"
          :label="$t('overlays2.speed')"
          :model-value="speedPercent"
          :min="speedMin"
          :max="speedMax"
          :step="5"
          :display="`${speedPercent}%`"
          @update="(percent: number) => patch({ speed: percent / 100 }, 'speed')"
          @commit="commit"
        />
        <RangeField
          :label="$t('overlays2.border')"
          :model-value="borderPx"
          :min="0"
          :max="54"
          :display="`${borderPx} px`"
          @update="(px: number) => patch({ border: px / referenceHeight }, 'border')"
          @commit="commit"
        />
        <p v-if="isVideoPicture" class="text-[11px] text-muted">{{ $t('overlays2.pictureSound') }}</p>
      </template>
    </DesignSection>

    <DesignSection :title="$t('design.look')">
      <ColorPicker
        v-if="colour !== null"
        :model-value="colour"
        :group-label="colourLabel"
        @update="(hex: string) => patch(item.kind === 'media' ? { borderColor: hex } : { color: hex }, 'colour')"
        @commit="commit"
      />
      <RangeField
        :label="$t('design.opacity')"
        :model-value="opacityPercent"
        :min="0"
        :max="100"
        :display="`${opacityPercent}%`"
        @update="(percent: number) => patch({ opacity: percent / 100 }, 'opacity')"
        @commit="commit"
      />
    </DesignSection>

    <DesignSection :title="$t('design.time')">
      <TimeFields :start="item.start" :duration="item.duration" @patch="patch" />
    </DesignSection>

    <DesignSection :title="$t('design.animation')">
      <AnimationFields :anim-in="item.animIn ?? null" :anim-out="item.animOut ?? null" :loop="item.loop ?? null" with-loop @patch="patch" />
    </DesignSection>

    <DesignSection :title="$t('design.order')">
      <OrderFields />
    </DesignSection>

    <DesignSection :title="$t('design.actions')">
      <ItemActions />
    </DesignSection>
  </div>
</template>
