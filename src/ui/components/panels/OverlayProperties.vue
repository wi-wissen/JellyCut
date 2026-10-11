<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions } from 'pinia'
import BackLink from './BackLink.vue'
import RangeField from './RangeField.vue'
import ColorPicker from './ColorPicker.vue'
import { useEditorStore } from '../../stores/editor'
import type { OverlayItem } from '../../../core/project/types'
import { secondsToMicros } from '../../../core/time'
import { REFERENCE_HEIGHT } from '../../../core/timeline/overlayCatalog'

/**
 * Settings of one sticker, shape or stroke. Size, rotation and shape proportions are sliders; the
 * same values can be changed by dragging the handles in the preview.
 */
export default defineComponent({
  name: 'OverlayProperties',
  components: { BackLink, RangeField, ColorPicker },
  props: {
    item: { type: Object as PropType<OverlayItem>, required: true }
  },
  computed: {
    header(): string {
      if (this.item.kind === 'sticker') return this.$t('overlays.header.sticker', { name: this.item.emoji })
      if (this.item.kind === 'shape') return this.$t('overlays.header.shape', { name: this.$t(`overlays.shape.${this.item.shape}`) })
      return this.$t('overlays.header.stroke')
    },
    scalePercent(): number {
      return Math.round(this.item.scale * 100)
    },
    rotationDeg(): number {
      return Math.round(this.item.rotation)
    },
    startSeconds(): number {
      return Math.round(this.item.start / 100_000) / 10
    },
    durationSeconds(): number {
      return Math.round(this.item.duration / 100_000) / 10
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['updateSelectedOverlay', 'endGesture']),
    keyFor(field: string): string {
      return `overlay-${field}:${this.item.id}`
    },
    onScale(percent: number): void {
      this.updateSelectedOverlay({ scale: percent / 100 }, this.keyFor('scale'))
    },
    onRotation(degrees: number): void {
      this.updateSelectedOverlay({ rotation: Math.round(degrees) }, this.keyFor('rotation'))
    },
    onWidth(percent: number): void {
      if (this.item.kind === 'shape') this.updateSelectedOverlay({ width: percent / 100 }, this.keyFor('width'))
    },
    onHeight(percent: number): void {
      if (this.item.kind === 'shape') this.updateSelectedOverlay({ height: percent / 100 }, this.keyFor('height'))
    },
    /** Line widths are shown in pixels of a 1080 px high output. */
    linePx(): number {
      return this.item.kind === 'sticker' ? 0 : Math.round(this.item.lineWidth * REFERENCE_HEIGHT)
    },
    onLine(px: number): void {
      if (this.item.kind !== 'sticker') this.updateSelectedOverlay({ lineWidth: px / REFERENCE_HEIGHT }, this.keyFor('line'))
    },
    setColor(color: string): void {
      if (this.item.kind !== 'sticker') this.updateSelectedOverlay({ color }, this.keyFor('color'))
    },
    setStart(event: Event): void {
      this.updateSelectedOverlay({ start: secondsToMicros(Number((event.target as HTMLInputElement).value)) })
    },
    setDuration(event: Event): void {
      this.updateSelectedOverlay({ duration: secondsToMicros(Number((event.target as HTMLInputElement).value)) })
    },
    endEdit(): void {
      this.endGesture()
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
    <div class="flex min-w-0 items-center justify-between gap-2">
      <BackLink />
      <h2 class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ header }}</h2>
    </div>

    <section class="flex items-center gap-2 border-t border-line pt-2.5">
      <span class="w-16 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.size') }}</span>
      <RangeField
        inline
        :label="$t('overlays.size')"
        :model-value="scalePercent"
        :min="25"
        :max="400"
        :display="`${scalePercent}%`"
        @update="onScale"
        @commit="endEdit"
      />
    </section>

    <section class="flex items-center gap-2 pt-1.5">
      <span class="w-16 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.rotation') }}</span>
      <RangeField
        inline
        :label="$t('overlays.rotation')"
        :model-value="rotationDeg"
        :min="0"
        :max="359"
        :display="`${rotationDeg}°`"
        @update="onRotation"
        @commit="endEdit"
      />
    </section>

    <template v-if="item.kind === 'shape'">
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-16 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.width') }}</span>
        <RangeField
          inline
          :label="$t('overlays.width')"
          :model-value="Math.round(item.width * 100)"
          :min="1"
          :max="200"
          :display="`${Math.round(item.width * 100)}%`"
          @update="onWidth"
          @commit="endEdit"
        />
      </section>
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-16 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.height') }}</span>
        <RangeField
          inline
          :label="$t('overlays.height')"
          :model-value="Math.round(item.height * 100)"
          :min="1"
          :max="200"
          :display="`${Math.round(item.height * 100)}%`"
          @update="onHeight"
          @commit="endEdit"
        />
      </section>
    </template>

    <template v-if="item.kind !== 'sticker'">
      <section class="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays.color') }}</span>
        <ColorPicker :model-value="item.color" :group-label="$t('overlays.color')" @update="setColor" @commit="endEdit" />
      </section>
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-16 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.lineWidth') }}</span>
        <RangeField
          inline
          :label="$t('overlays.lineWidth')"
          :model-value="linePx()"
          :min="1"
          :max="54"
          :display="`${linePx()} px`"
          @update="onLine"
          @commit="endEdit"
        />
      </section>
    </template>

    <section class="grid grid-cols-2 gap-2 border-t border-line pt-3">
      <div class="flex flex-col gap-1">
        <label :for="`overlay-start-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays.start') }}</label>
        <input
          :id="`overlay-start-${item.id}`"
          type="number"
          min="0"
          step="0.1"
          class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm [font-variant-numeric:tabular-nums] text-fg"
          :value="startSeconds"
          @change="setStart"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label :for="`overlay-duration-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays.duration') }}</label>
        <input
          :id="`overlay-duration-${item.id}`"
          type="number"
          min="0.1"
          step="0.1"
          class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm [font-variant-numeric:tabular-nums] text-fg"
          :value="durationSeconds"
          @change="setDuration"
        />
      </div>
    </section>
  </div>
</template>
