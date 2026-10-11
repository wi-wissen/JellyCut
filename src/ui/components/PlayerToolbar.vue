<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import FitSwitch from './FitSwitch.vue'
import ColorPicker from './panels/ColorPicker.vue'
import { useEditorStore } from '../stores/editor'
import { formatForRatio, projectFit } from '../../core/project/format'
import type { FitMode, FormatRatio } from '../../core/project/types'
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

/** Ratio chip. Its popover holds the format, the project-wide Fit / Fill and (with Fit) the background. */
export default defineComponent({
  name: 'PlayerToolbar',
  components: { Icon, FitSwitch, ColorPicker },
  data() {
    return {
      panel: null as 'ratio' | null,
      ratioOptions: RATIO_OPTIONS,
      placement: { left: 0, top: 0, width: POPOVER_WIDTH, maxHeight: 400 }
    }
  },
  computed: {
    ...mapState(useEditorStore, ['project']),
    ratio(): FormatRatio {
      return this.project.format.ratio
    },
    fit(): FitMode {
      return projectFit(this.project)
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
    panel(next: 'ratio' | null) {
      if (next) {
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
    ...mapActions(useEditorStore, ['setRatio', 'setBackground', 'endGesture']),
    dims(ratio: FormatRatio): string {
      const { width, height } = formatForRatio(ratio)
      return `${formatNumber(width, 0)} × ${formatNumber(height, 0)}`
    },
    ratioName(name: string): string {
      return this.$t(`player.ratioNames.${name}`)
    },
    triggerFor(): HTMLElement | undefined {
      return this.$refs.ratioTrigger as HTMLElement | undefined
    },
    /**
     * Places the popover under its trigger, inside the player stage (the section around the
     * toolbar). It is teleported to the body, so the stage's own overflow clipping does not cut it.
     */
    place(): void {
      const trigger = this.panel ? this.triggerFor() : undefined
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
      this.panel = this.panel ? null : 'ratio'
    },
    close(returnFocus: boolean): void {
      const wasOpen = this.panel !== null
      this.panel = null
      if (returnFocus && wasOpen) this.$nextTick(() => this.triggerFor()?.focus())
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
    onBackgroundPick(color: string): void {
      this.setBackground({ type: 'color', color }, 'background-color')
    },
    onColorCommit(): void {
      this.endGesture()
    }
  }
})
</script>

<template>
  <div class="relative flex flex-col items-end gap-1.5 text-[11px] font-semibold text-white">
    <div class="flex gap-1.5">
      <button
        ref="ratioTrigger"
        type="button"
        class="relative flex h-9 items-center gap-1 rounded-full bg-black/35 px-3 hover:bg-black/50 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        aria-haspopup="dialog"
        :aria-expanded="panel === 'ratio'"
        :aria-label="$t('player.ratio')"
        @click="toggle()"
      >
        <Icon name="ratio" class="size-3.5" />
        {{ ratio }}
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="panel"
        ref="dialog"
        role="dialog"
        aria-modal="false"
        :aria-label="$t('player.ratioDialog')"
        class="fixed z-50 flex flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-[12px] font-normal text-fg shadow-xl"
        :style="placementStyle"
      >
        <template v-if="panel === 'ratio'">
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

          <FitSwitch />

          <template v-if="fit === 'fit'">
            <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('player.background') }}</h2>
            <p class="-mt-2 text-[12px] leading-snug text-muted" data-role="background-hint">{{ $t('polish.format.backgroundHint') }}</p>
            <div class="grid grid-cols-2 gap-1.5" role="radiogroup" :aria-label="$t('player.background')">
              <button
                type="button"
                role="radio"
                class="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-left"
                :class="isBlur ? 'bg-panel2 ring-1 ring-fill' : 'hover:bg-panel2'"
                :aria-checked="isBlur"
                @click="chooseBlur"
              >
                <span class="size-4 shrink-0 rounded-full bg-fill blur-[1px]" aria-hidden="true" />
                <span class="truncate">{{ $t('player.blurBackground') }}</span>
              </button>
              <button
                type="button"
                role="radio"
                class="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-left"
                :class="!isBlur ? 'bg-panel2 ring-1 ring-fill' : 'hover:bg-panel2'"
                :aria-checked="!isBlur"
                @click="chooseColor"
              >
                <span class="size-4 shrink-0 rounded-full border border-line" :style="{ background: colorValue }" aria-hidden="true" />
                <span class="truncate">{{ $t('player.colorBackground') }}</span>
              </button>
            </div>
            <ColorPicker
              v-if="!isBlur"
              :model-value="colorValue"
              :group-label="$t('player.backgroundColor')"
              :popover="false"
              @update="onBackgroundPick"
              @commit="onColorCommit"
            />
            </template>
        </template>

        <button type="button" class="min-h-11 rounded-lg bg-panel2 text-xs font-semibold text-fg hover:bg-line" @click="close(true)">
          {{ $t('player.close') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
