<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'
import { formatForRatio } from '../../core/project/format'
import type { Clip, FormatRatio } from '../../core/project/types'
import { formatNumber } from '../numberFormat'

interface RatioOption {
  ratio: FormatRatio
  name: string
  /** Box of the mini icon in px, same proportion as the ratio. */
  box: { width: number; height: number }
}

const RATIO_OPTIONS: readonly RatioOption[] = [
  { ratio: '16:9', name: 'landscape', box: { width: 28, height: 16 } },
  { ratio: '9:16', name: 'portrait', box: { width: 16, height: 28 } },
  { ratio: '1:1', name: 'square', box: { width: 22, height: 22 } },
  { ratio: '4:5', name: 'portraitTall', box: { width: 20, height: 25 } }
]

const DEFAULT_BACKGROUND_COLOR = '#14121f'

export default defineComponent({
  name: 'PlayerToolbar',
  components: { Icon },
  data() {
    return { open: false, ratioOptions: RATIO_OPTIONS }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'selectedClip']),
    ratio(): FormatRatio {
      return this.project.format.ratio
    },
    /** The clip whose fit mode the chip shows: the selected clip, or else the first one. */
    fitSource(): Clip | null {
      if (this.selectedClip) return this.selectedClip
      return [...this.project.clips].sort((a, b) => a.start - b.start)[0] ?? null
    },
    fitMode(): 'fit' | 'fill' {
      return this.fitSource?.transform.fit === 'fill' ? 'fill' : 'fit'
    },
    fitLabel(): string {
      return this.$t(this.fitMode === 'fill' ? 'player.fillMode' : 'player.fitMode')
    },
    fitToggleLabel(): string {
      return this.$t('player.fitToggle', { mode: this.fitLabel })
    },
    background(): { type: 'blur' } | { type: 'color'; color: string } {
      return this.project.format.background
    },
    isBlur(): boolean {
      return this.background.type === 'blur'
    },
    colorValue(): string {
      return this.background.type === 'color' ? this.background.color : DEFAULT_BACKGROUND_COLOR
    }
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) {
        document.addEventListener('pointerdown', this.onOutsidePointer)
        document.addEventListener('keydown', this.onEscape)
        this.$nextTick(() => this.focusChecked())
      } else {
        document.removeEventListener('pointerdown', this.onOutsidePointer)
        document.removeEventListener('keydown', this.onEscape)
      }
    }
  },
  beforeUnmount() {
    document.removeEventListener('pointerdown', this.onOutsidePointer)
    document.removeEventListener('keydown', this.onEscape)
  },
  methods: {
    ...mapActions(useEditorStore, ['setRatio', 'setBackground', 'setFitForSelection', 'endGesture']),
    dims(ratio: FormatRatio): string {
      const { width, height } = formatForRatio(ratio)
      return `${formatNumber(width, 0)} × ${formatNumber(height, 0)}`
    },
    ratioName(name: string): string {
      return this.$t(`player.ratioNames.${name}`)
    },
    toggle(): void {
      this.open = !this.open
    },
    close(returnFocus: boolean): void {
      this.open = false
      if (returnFocus) this.$nextTick(() => (this.$refs.trigger as HTMLButtonElement | undefined)?.focus())
    },
    focusChecked(): void {
      const checked = (this.$refs.dialog as HTMLElement | undefined)?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      checked?.focus()
    },
    onOutsidePointer(event: PointerEvent): void {
      const root = this.$el as HTMLElement | undefined
      if (root && event.target instanceof Node && !root.contains(event.target)) this.close(false)
    },
    onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      this.close(true)
    },
    chooseRatio(ratio: FormatRatio): void {
      this.setRatio(ratio)
    },
    chooseBlur(): void {
      this.setBackground({ type: 'blur' })
    },
    chooseColor(): void {
      this.setBackground({ type: 'color', color: this.colorValue })
    },
    onColorInput(event: Event): void {
      this.setBackground({ type: 'color', color: (event.target as HTMLInputElement).value }, 'background-color')
    },
    onColorCommit(): void {
      this.endGesture()
    },
    toggleFit(): void {
      this.setFitForSelection(this.fitMode === 'fill' ? 'fit' : 'fill')
    }
  }
})
</script>

<template>
  <div ref="root" class="relative flex flex-col items-end gap-1.5 text-[11px] font-semibold text-white">
    <div class="flex gap-1.5">
      <button
        ref="trigger"
        type="button"
        class="flex h-9 items-center gap-1 rounded-full bg-black/35 px-3 hover:bg-black/50"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-label="$t('player.ratio')"
        @click="toggle"
      >
        <Icon name="ratio" class="size-3.5" />
        {{ ratio }}
      </button>
      <button
        type="button"
        class="flex h-9 items-center rounded-full bg-black/35 px-3 hover:bg-black/50"
        :aria-label="fitToggleLabel"
        @click="toggleFit"
      >
        {{ fitLabel }}
      </button>
    </div>

    <div
      v-if="open"
      ref="dialog"
      role="dialog"
      :aria-label="$t('player.ratioDialog')"
      class="absolute right-0 top-full z-10 mt-1.5 flex max-h-[calc(100cqh-4.5rem)] w-[min(264px,calc(100cqw-2rem))] flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-panel p-3 font-normal text-fg shadow-xl"
    >
      <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('player.ratioOptions') }}</h2>
      <div class="flex flex-col gap-1" role="radiogroup" :aria-label="$t('player.ratioOptions')">
        <button
          v-for="option in ratioOptions"
          :key="option.ratio"
          type="button"
          role="radio"
          class="flex min-h-11 items-center gap-3 rounded-lg px-2 text-left"
          :class="ratio === option.ratio ? 'bg-panel2 ring-1 ring-fill' : 'hover:bg-panel2'"
          :aria-checked="ratio === option.ratio"
          @click="chooseRatio(option.ratio)"
        >
          <span class="flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
            <span
              class="rounded-[3px] border-2"
              :class="ratio === option.ratio ? 'border-fill bg-fill/30' : 'border-muted'"
              :style="{ width: `${option.box.width}px`, height: `${option.box.height}px` }"
            />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-[13px] font-bold">{{ option.ratio }} · {{ ratioName(option.name) }}</span>
            <span class="text-[11px] font-normal tabular-nums text-muted">{{ dims(option.ratio) }}</span>
          </span>
        </button>
      </div>

      <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('player.background') }}</h2>
      <div class="flex flex-col gap-1" role="radiogroup" :aria-label="$t('player.background')">
        <button
          type="button"
          role="radio"
          class="flex min-h-11 items-center gap-2 rounded-lg px-2 text-left"
          :class="isBlur ? 'bg-panel2 ring-1 ring-fill' : 'hover:bg-panel2'"
          :aria-checked="isBlur"
          @click="chooseBlur"
        >
          <span class="size-4 rounded-full bg-gradient-to-br from-fill to-signal blur-[1px]" aria-hidden="true" />
          {{ $t('player.blurBackground') }}
        </button>
        <div class="flex min-h-11 items-center gap-2 rounded-lg px-2" :class="!isBlur ? 'bg-panel2 ring-1 ring-fill' : ''">
          <button
            type="button"
            role="radio"
            class="flex min-h-11 flex-1 items-center gap-2 text-left"
            :aria-checked="!isBlur"
            @click="chooseColor"
          >
            <span class="size-4 rounded-full border border-line" :style="{ background: colorValue }" aria-hidden="true" />
            {{ $t('player.colorBackground') }}
          </button>
          <label class="flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-panel2" :title="$t('player.backgroundColor')">
            <span class="sr-only">{{ $t('player.backgroundColor') }}</span>
            <input
              type="color"
              class="size-6 cursor-pointer border-0 bg-transparent p-0"
              :value="colorValue"
              @input="onColorInput"
              @change="onColorCommit"
            />
          </label>
        </div>
      </div>

      <button type="button" class="min-h-11 rounded-lg bg-panel2 text-xs font-semibold text-fg hover:bg-line" @click="close(true)">
        {{ $t('player.close') }}
      </button>
    </div>
  </div>
</template>
