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
  { ratio: '16:9', name: 'landscape', box: { width: 26, height: 15 } },
  { ratio: '9:16', name: 'portrait', box: { width: 15, height: 26 } },
  { ratio: '1:1', name: 'square', box: { width: 20, height: 20 } },
  { ratio: '4:5', name: 'portraitTall', box: { width: 17, height: 21 } }
]

const DEFAULT_BACKGROUND_COLOR = '#14121f'
const POPOVER_WIDTH = 264
const STAGE_MARGIN = 8

export default defineComponent({
  name: 'PlayerToolbar',
  components: { Icon },
  data() {
    return { open: false, ratioOptions: RATIO_OPTIONS, placement: { left: 0, top: 0, width: POPOVER_WIDTH, maxHeight: 400 } }
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
    },
    placementStyle(): Record<string, string> {
      const p = this.placement
      return { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` }
    }
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) {
        this.place()
        document.addEventListener('pointerdown', this.onOutsidePointer)
        document.addEventListener('keydown', this.onEscape)
        window.addEventListener('resize', this.place)
        this.$nextTick(() => this.focusChecked())
      } else {
        document.removeEventListener('pointerdown', this.onOutsidePointer)
        document.removeEventListener('keydown', this.onEscape)
        window.removeEventListener('resize', this.place)
      }
    }
  },
  beforeUnmount() {
    document.removeEventListener('pointerdown', this.onOutsidePointer)
    document.removeEventListener('keydown', this.onEscape)
    window.removeEventListener('resize', this.place)
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
    /**
     * Places the popover under the trigger, inside the player stage (the section around the
     * toolbar). It is teleported to the body, so the stage's own overflow clipping does not cut it.
     */
    place(): void {
      const trigger = this.$refs.trigger as HTMLElement | undefined
      const stage = (this.$el as HTMLElement | null)?.closest('section')
      if (!trigger || !stage) return
      const t = trigger.getBoundingClientRect()
      const s = stage.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, s.width - 2 * STAGE_MARGIN)
      const left = Math.min(Math.max(t.right - width, s.left + STAGE_MARGIN), s.right - width - STAGE_MARGIN)
      const top = Math.min(t.bottom + 6, s.bottom - STAGE_MARGIN - 120)
      this.placement = { left, top, width, maxHeight: Math.max(120, s.bottom - STAGE_MARGIN - top) }
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
      const target = event.target
      if (!(target instanceof Node)) return
      const root = this.$el as HTMLElement | undefined
      const dialog = this.$refs.dialog as HTMLElement | undefined
      if (root?.contains(target) || dialog?.contains(target)) return
      this.close(false)
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
        class="relative flex h-9 items-center gap-1 rounded-full bg-black/35 px-3 hover:bg-black/50 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
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
        class="relative flex h-9 items-center rounded-full bg-black/35 px-3 hover:bg-black/50 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        :aria-label="fitToggleLabel"
        @click="toggleFit"
      >
        {{ fitLabel }}
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="open"
        ref="dialog"
        role="dialog"
        :aria-label="$t('player.ratioDialog')"
        class="fixed z-50 flex flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-[12px] font-normal text-fg shadow-xl"
        :style="placementStyle"
      >
        <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('player.ratioOptions') }}</h2>
        <div class="grid grid-cols-2 gap-1.5" role="radiogroup" :aria-label="$t('player.ratioOptions')">
          <button
            v-for="option in ratioOptions"
            :key="option.ratio"
            type="button"
            role="radio"
            class="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1 text-left"
            :class="ratio === option.ratio ? 'bg-panel2 ring-1 ring-fill' : 'hover:bg-panel2'"
            :aria-checked="ratio === option.ratio"
            :title="dims(option.ratio)"
            @click="chooseRatio(option.ratio)"
          >
            <span class="flex size-7 shrink-0 items-center justify-center" aria-hidden="true">
              <span
                class="rounded-[3px] border-2"
                :class="ratio === option.ratio ? 'border-fill bg-fill/30' : 'border-muted'"
                :style="{ width: `${option.box.width}px`, height: `${option.box.height}px` }"
              />
            </span>
            <span class="flex min-w-0 flex-col leading-tight">
              <span class="text-[13px] font-bold">{{ option.ratio }}</span>
              <span class="truncate text-[11px] text-muted">{{ ratioName(option.name) }}</span>
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
            <span class="size-4 shrink-0 rounded-full bg-fill blur-[1px]" aria-hidden="true" />
            <span class="truncate">{{ $t('player.blurBackground') }}</span>
          </button>
          <div
            class="flex min-h-11 items-center gap-1 rounded-lg pl-2 pr-1"
            :class="!isBlur ? 'bg-panel2 ring-1 ring-fill' : ''"
          >
            <button
              type="button"
              role="radio"
              class="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
              :aria-checked="!isBlur"
              @click="chooseColor"
            >
              <span class="size-4 shrink-0 rounded-full border border-line" :style="{ background: colorValue }" aria-hidden="true" />
              <span class="truncate">{{ $t('player.colorBackground') }}</span>
            </button>
            <label class="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-panel2" :title="$t('player.backgroundColor')">
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
    </Teleport>
  </div>
</template>
