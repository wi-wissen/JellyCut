<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions } from 'pinia'
import BackLink from './BackLink.vue'
import RangeField from './RangeField.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import ColorSwatches from './ColorSwatches.vue'
import { useEditorStore } from '../../stores/editor'
import { CURATED_FONTS } from '../../../core/text/fonts'
import { TEXT_ANIMATIONS, type TextAnimation } from '../../../core/render/types'
import type { TextItem } from '../../../core/project/types'
import { secondsToMicros } from '../../../core/time'

const POSITIONS = [
  { key: 'top', y: 0.15 },
  { key: 'middle', y: 0.5 },
  { key: 'bottom', y: 0.85 }
] as const

const DEFAULT_OUTLINE = '#14121f'

export default defineComponent({
  name: 'TextProperties',
  components: { BackLink, RangeField, ToggleSwitch, ColorSwatches },
  props: {
    item: { type: Object as PropType<TextItem>, required: true }
  },
  data() {
    return { fonts: CURATED_FONTS, animations: TEXT_ANIMATIONS, positions: POSITIONS, defaultOutline: DEFAULT_OUTLINE }
  },
  computed: {
    header(): string {
      const text = this.item.text.length > 24 ? `${this.item.text.slice(0, 24)}…` : this.item.text
      return this.$t('text.header', { text })
    },
    outlineOn(): boolean {
      return this.item.style.outline !== null
    },
    xPercent(): number {
      return Math.round(this.item.pos.x * 100)
    },
    yPercent(): number {
      return Math.round(this.item.pos.y * 100)
    },
    startSeconds(): number {
      return Math.round(this.item.start / 100_000) / 10
    },
    durationSeconds(): number {
      return Math.round(this.item.duration / 100_000) / 10
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['updateSelectedText', 'endGesture']),
    keyFor(field: string): string {
      return `text-${field}:${this.item.id}`
    },
    onContent(event: Event): void {
      this.updateSelectedText({ text: (event.target as HTMLTextAreaElement).value }, this.keyFor('content'))
    },
    onFont(event: Event): void {
      this.updateSelectedText({ style: { font: (event.target as HTMLSelectElement).value } })
    },
    onSize(size: number): void {
      this.updateSelectedText({ style: { size: Math.round(size) } }, this.keyFor('size'))
    },
    setColor(color: string): void {
      this.updateSelectedText({ style: { color } }, this.keyFor('color'))
    },
    toggleOutline(): void {
      this.updateSelectedText({ style: { outline: this.outlineOn ? null : DEFAULT_OUTLINE } })
    },
    setOutlineColor(color: string): void {
      this.updateSelectedText({ style: { outline: color } }, this.keyFor('outline'))
    },
    setPosition(y: number): void {
      this.updateSelectedText({ pos: { y } })
    },
    isPosition(y: number): boolean {
      return Math.abs(this.item.pos.y - y) < 0.01
    },
    onX(percent: number): void {
      this.updateSelectedText({ pos: { x: percent / 100 } }, this.keyFor('x'))
    },
    onY(percent: number): void {
      this.updateSelectedText({ pos: { y: percent / 100 } }, this.keyFor('y'))
    },
    setAnimation(side: 'animIn' | 'animOut', value: string): void {
      const anim = value === 'none' ? null : (value as TextAnimation)
      this.updateSelectedText({ [side]: anim })
    },
    setStart(event: Event): void {
      this.updateSelectedText({ start: secondsToMicros(Number((event.target as HTMLInputElement).value)) })
    },
    setDuration(event: Event): void {
      this.updateSelectedText({ duration: secondsToMicros(Number((event.target as HTMLInputElement).value)) })
    },
    endEdit(): void {
      this.endGesture()
    },
    animText(side: 'animIn' | 'animOut'): string {
      return this.item[side] ?? 'none'
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
    <BackLink />
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ header }}</h2>

    <section class="flex flex-col gap-2 rounded-[10px] border border-line bg-bg p-3">
      <label :for="`text-content-${item.id}`" class="text-[13px] font-semibold">{{ $t('text.content') }}</label>
      <textarea
        :id="`text-content-${item.id}`"
        rows="2"
        class="w-full resize-y rounded-lg border border-line bg-panel p-2 text-sm text-fg"
        :value="item.text"
        @input="onContent"
        @change="endEdit"
      />
    </section>

    <section class="flex flex-col gap-3 rounded-[10px] border border-line bg-bg p-3">
      <div class="flex flex-col gap-1">
        <label :for="`text-font-${item.id}`" class="text-[13px] font-semibold">{{ $t('text.font') }}</label>
        <select
          :id="`text-font-${item.id}`"
          class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg"
          :value="item.style.font"
          @change="onFont"
        >
          <option v-for="font in fonts" :key="font.family" :value="font.family" :style="{ fontFamily: `'${font.family}'`, fontWeight: font.weight }">
            {{ font.family }}
          </option>
        </select>
      </div>

      <RangeField
        :label="$t('text.size')"
        :model-value="item.style.size"
        :min="8"
        :max="400"
        :display="String(Math.round(item.style.size))"
        @update="onSize"
        @commit="endEdit"
      />

      <div class="flex flex-col gap-1">
        <span class="text-[13px] font-semibold">{{ $t('text.color') }}</span>
        <ColorSwatches
          :model-value="item.style.color"
          :group-label="$t('text.color')"
          swatch-key="text.swatchText"
          :custom-label="$t('text.customTextColor')"
          @update="setColor"
          @commit="endEdit"
        />
      </div>
    </section>

    <section class="flex flex-col gap-2 rounded-[10px] border border-line bg-bg p-3">
      <ToggleSwitch
        :label="$t('text.outline')"
        :state-text="outlineOn ? $t('timeline.on') : $t('timeline.off')"
        :checked="outlineOn"
        @toggle="toggleOutline"
      />
      <div v-if="outlineOn" class="flex flex-col gap-1">
        <span class="text-xs font-semibold text-muted">{{ $t('text.outlineColor') }}</span>
        <ColorSwatches
          :model-value="item.style.outline ?? defaultOutline"
          :group-label="$t('text.outlineColor')"
          swatch-key="text.swatchOutline"
          :custom-label="$t('text.customOutlineColor')"
          @update="setOutlineColor"
          @commit="endEdit"
        />
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-[10px] border border-line bg-bg p-3">
      <span class="text-[13px] font-semibold">{{ $t('text.position') }}</span>
      <div class="flex gap-1 rounded-lg bg-panel2 p-[3px]" role="group" :aria-label="$t('text.position')">
        <button
          v-for="position in positions"
          :key="position.key"
          type="button"
          class="flex min-h-11 flex-1 items-center justify-center rounded-md text-xs font-semibold"
          :class="isPosition(position.y) ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
          :aria-pressed="isPosition(position.y)"
          @click="setPosition(position.y)"
        >
          {{ $t(`text.${position.key}`) }}
        </button>
      </div>
      <RangeField
        :label="$t('text.posX')"
        :model-value="xPercent"
        :min="0"
        :max="100"
        :display="$t('units.percent', { value: xPercent })"
        @update="onX"
        @commit="endEdit"
      />
      <RangeField
        :label="$t('text.posY')"
        :model-value="yPercent"
        :min="0"
        :max="100"
        :display="$t('units.percent', { value: yPercent })"
        @update="onY"
        @commit="endEdit"
      />
    </section>

    <section class="flex flex-col gap-3 rounded-[10px] border border-line bg-bg p-3">
      <span class="text-[13px] font-semibold">{{ $t('text.animation') }}</span>
      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-1">
          <label :for="`text-anim-in-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('text.animIn') }}</label>
          <select
            :id="`text-anim-in-${item.id}`"
            class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg"
            :value="animText('animIn')"
            @change="setAnimation('animIn', ($event.target as HTMLSelectElement).value)"
          >
            <option value="none">{{ $t('text.anim.none') }}</option>
            <option v-for="anim in animations" :key="anim" :value="anim">{{ $t(`text.anim.${anim}`) }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label :for="`text-anim-out-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('text.animOut') }}</label>
          <select
            :id="`text-anim-out-${item.id}`"
            class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg"
            :value="animText('animOut')"
            @change="setAnimation('animOut', ($event.target as HTMLSelectElement).value)"
          >
            <option value="none">{{ $t('text.anim.none') }}</option>
            <option v-for="anim in animations" :key="anim" :value="anim">{{ $t(`text.anim.${anim}`) }}</option>
          </select>
        </div>
      </div>
    </section>

    <section class="grid grid-cols-2 gap-2 rounded-[10px] border border-line bg-bg p-3">
      <div class="flex flex-col gap-1">
        <label :for="`text-start-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('text.start') }}</label>
        <input
          :id="`text-start-${item.id}`"
          type="number"
          min="0"
          step="0.1"
          class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm [font-variant-numeric:tabular-nums] text-fg"
          :value="startSeconds"
          @change="setStart"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label :for="`text-duration-${item.id}`" class="text-xs font-semibold text-muted">{{ $t('text.duration') }}</label>
        <input
          :id="`text-duration-${item.id}`"
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
