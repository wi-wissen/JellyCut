<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions, mapState } from 'pinia'
import BackLink from './BackLink.vue'
import RangeField from './RangeField.vue'
import ColorPicker from './ColorPicker.vue'
import { useEditorStore } from '../../stores/editor'
import type { OverlayItem } from '../../../core/project/types'
import { secondsToMicros } from '../../../core/time'
import { OVERLAY_ANIMATIONS, OVERLAY_LOOPS, REFERENCE_HEIGHT, REGION_EFFECTS, REGION_SHAPES } from '../../../core/timeline/overlayCatalog'

/**
 * Settings of one sticker, shape, stroke, blur area or picture. Sizes and angles are sliders; the same
 * values can be changed by dragging the handles in the preview.
 */
export default defineComponent({
  name: 'OverlayProperties',
  components: { BackLink, RangeField, ColorPicker },
  props: {
    item: { type: Object as PropType<OverlayItem>, required: true }
  },
  data() {
    return {
      animations: OVERLAY_ANIMATIONS,
      loops: OVERLAY_LOOPS,
      regionShapes: REGION_SHAPES,
      regionEffects: REGION_EFFECTS
    }
  },
  computed: {
    ...mapState(useEditorStore, ['project']),
    header(): string {
      if (this.item.kind === 'sticker') return this.$t('overlays.header.sticker', { name: this.item.emoji })
      if (this.item.kind === 'shape') return this.$t('overlays.header.shape', { name: this.$t(`overlays.shape.${this.item.shape}`) })
      if (this.item.kind === 'region') return this.$t('overlays2.regionHeader', { name: this.$t(`overlays2.effects.${this.item.effect}`) })
      if (this.item.kind === 'media') return this.$t('overlays2.pictureHeader', { name: this.pictureName })
      return this.$t('overlays.header.stroke')
    },
    pictureName(): string {
      const item = this.item
      if (item.kind !== 'media') return ''
      return this.project.assets.find((a) => a.id === item.assetId)?.name ?? ''
    },
    /** Sound of a picture-in-picture video is never played, so the panel says so. */
    pictureIsVideo(): boolean {
      const item = this.item
      return item.kind === 'media' && this.project.assets.find((a) => a.id === item.assetId)?.kind === 'video'
    },
    opacityPercent(): number {
      return Math.round((this.item.opacity ?? 1) * 100)
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
    onOpacity(percent: number): void {
      this.updateSelectedOverlay({ opacity: percent / 100 }, this.keyFor('opacity'))
    },
    setAnimation(side: 'animIn' | 'animOut', event: Event): void {
      const value = (event.target as HTMLSelectElement).value
      this.updateSelectedOverlay({ [side]: value === 'none' ? null : value } as { animIn: null })
    },
    setLoop(event: Event): void {
      const value = (event.target as HTMLSelectElement).value
      this.updateSelectedOverlay({ loop: value === 'none' ? null : (value as 'wiggle') })
    },
    onScale(percent: number): void {
      this.updateSelectedOverlay({ scale: percent / 100 }, this.keyFor('scale'))
    },
    onRotation(degrees: number): void {
      this.updateSelectedOverlay({ rotation: Math.round(degrees) }, this.keyFor('rotation'))
    },
    onWidth(percent: number): void {
      this.updateSelectedOverlay({ width: percent / 100 }, this.keyFor('width'))
    },
    onHeight(percent: number): void {
      this.updateSelectedOverlay({ height: percent / 100 }, this.keyFor('height'))
    },
    setRegionShape(event: Event): void {
      this.updateSelectedOverlay({ shape: (event.target as HTMLSelectElement).value as 'rect' | 'ellipse' })
    },
    setEffect(event: Event): void {
      this.updateSelectedOverlay({ effect: (event.target as HTMLSelectElement).value as 'blur' | 'pixelate' })
    },
    onStrength(percent: number): void {
      this.updateSelectedOverlay({ strength: percent / 100 }, this.keyFor('strength'))
    },
    onRadius(percent: number): void {
      this.updateSelectedOverlay({ radius: percent / 100 }, this.keyFor('radius'))
    },
    /** Line widths are shown in pixels of a 1080 px high output. */
    linePx(): number {
      const item = this.item
      return item.kind === 'shape' || item.kind === 'stroke' ? Math.round(item.lineWidth * REFERENCE_HEIGHT) : 0
    },
    borderPx(): number {
      const item = this.item
      return item.kind === 'media' ? Math.round(item.border * REFERENCE_HEIGHT) : 0
    },
    onLine(px: number): void {
      this.updateSelectedOverlay({ lineWidth: px / REFERENCE_HEIGHT }, this.keyFor('line'))
    },
    onBorder(px: number): void {
      if (this.item.kind === 'media') this.updateSelectedOverlay({ border: px / REFERENCE_HEIGHT }, this.keyFor('border'))
    },
    setColor(color: string): void {
      this.updateSelectedOverlay({ color }, this.keyFor('color'))
    },
    setBorderColor(color: string): void {
      if (this.item.kind === 'media') this.updateSelectedOverlay({ borderColor: color }, this.keyFor('border-color'))
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
      <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays2.opacity') }}</span>
      <RangeField
        inline
        :label="$t('overlays2.opacity')"
        :model-value="opacityPercent"
        :min="0"
        :max="100"
        :display="`${opacityPercent}%`"
        @update="onOpacity"
        @commit="endEdit"
      />
    </section>

    <section class="flex items-center gap-2">
      <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.size') }}</span>
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
      <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.rotation') }}</span>
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

    <template v-if="item.kind === 'region'">
      <section class="grid grid-cols-2 gap-2 border-t border-line pt-2.5">
        <div class="flex flex-col gap-1">
          <label :for="`overlay-effect-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays2.effect') }}</label>
          <select :id="`overlay-effect-${item.id}`" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="item.effect" @change="setEffect">
            <option v-for="effect in regionEffects" :key="effect" :value="effect">{{ $t(`overlays2.effects.${effect}`) }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label :for="`overlay-shape-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays.shapes') }}</label>
          <select :id="`overlay-shape-${item.id}`" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="item.shape" @change="setRegionShape">
            <option v-for="shape in regionShapes" :key="shape" :value="shape">{{ $t(`overlays2.regionShape.${shape}`) }}</option>
          </select>
        </div>
      </section>
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays2.strength') }}</span>
        <RangeField
          inline
          :label="$t('overlays2.strength')"
          :model-value="Math.round(item.strength * 100)"
          :min="0"
          :max="100"
          :display="`${Math.round(item.strength * 100)}%`"
          @update="onStrength"
          @commit="endEdit"
        />
      </section>
    </template>

    <template v-if="item.kind === 'media'">
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays2.radius') }}</span>
        <RangeField
          inline
          :label="$t('overlays2.radius')"
          :model-value="Math.round(item.radius * 100)"
          :min="0"
          :max="50"
          :display="`${Math.round(item.radius * 100)}%`"
          @update="onRadius"
          @commit="endEdit"
        />
      </section>
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays2.border') }}</span>
        <RangeField
          inline
          :label="$t('overlays2.border')"
          :model-value="borderPx()"
          :min="0"
          :max="54"
          :display="`${borderPx()} px`"
          @update="onBorder"
          @commit="endEdit"
        />
      </section>
      <section class="flex flex-col gap-1.5 pt-1.5">
        <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays2.borderColor') }}</span>
        <ColorPicker :model-value="item.borderColor" :group-label="$t('overlays2.borderColor')" @update="setBorderColor" @commit="endEdit" />
      </section>
      <p v-if="pictureIsVideo" class="text-[11px] text-muted">{{ $t('overlays2.pictureSound') }}</p>
    </template>

    <template v-if="item.kind === 'shape' || item.kind === 'region' || item.kind === 'media'">
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.width') }}</span>
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
        <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.height') }}</span>
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

    <template v-if="item.kind === 'shape' || item.kind === 'stroke'">
      <section class="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays.color') }}</span>
        <ColorPicker :model-value="item.color" :group-label="$t('overlays.color')" @update="setColor" @commit="endEdit" />
      </section>
      <section class="flex items-center gap-2 pt-1.5">
        <span class="w-20 shrink-0 text-xs font-semibold text-muted">{{ $t('overlays.lineWidth') }}</span>
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

    <section class="flex flex-col gap-2 border-t border-line pt-2.5">
      <span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('overlays2.animation') }}</span>
      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-1">
          <label :for="`overlay-anim-in-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays2.animIn') }}</label>
          <select :id="`overlay-anim-in-${item.id}`" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="item.animIn ?? 'none'" @change="setAnimation('animIn', $event)">
            <option value="none">{{ $t('overlays2.none') }}</option>
            <option v-for="anim in animations" :key="anim" :value="anim">{{ $t(`overlays2.anim.${anim}`) }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label :for="`overlay-anim-out-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays2.animOut') }}</label>
          <select :id="`overlay-anim-out-${item.id}`" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="item.animOut ?? 'none'" @change="setAnimation('animOut', $event)">
            <option value="none">{{ $t('overlays2.none') }}</option>
            <option v-for="anim in animations" :key="anim" :value="anim">{{ $t(`overlays2.anim.${anim}`) }}</option>
          </select>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label :for="`overlay-loop-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('overlays2.loop') }}</label>
        <select :id="`overlay-loop-${item.id}`" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="item.loop ?? 'none'" @change="setLoop">
          <option value="none">{{ $t('overlays2.none') }}</option>
          <option v-for="loop in loops" :key="loop" :value="loop">{{ $t(`overlays2.loops.${loop}`) }}</option>
        </select>
      </div>
    </section>

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
