<script lang="ts">
import { defineComponent } from 'vue'
import { CURATED_FONTS, fontWeight } from '../../../core/text/fonts'

const POPOVER_WIDTH = 280
const EDGE = 8

/** Font picker: a listbox in which every option is set in its own typeface. */
export default defineComponent({
  name: 'FontSelect',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, required: true }
  },
  emits: {
    update: (family: string) => CURATED_FONTS.some((f) => f.family === family)
  },
  data() {
    return {
      fonts: CURATED_FONTS,
      open: false,
      active: 0,
      placement: { left: EDGE, top: EDGE, width: POPOVER_WIDTH, maxHeight: 360 } as { left: number; top?: number; bottom?: number; width: number; maxHeight: number }
    }
  },
  computed: {
    currentIndex(): number {
      return Math.max(0, CURATED_FONTS.findIndex((f) => f.family === this.modelValue))
    },
    placementStyle(): Record<string, string> {
      const p = this.placement
      const style: Record<string, string> = { left: `${p.left}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` }
      if (p.top !== undefined) style.top = `${p.top}px`
      if (p.bottom !== undefined) style.bottom = `${p.bottom}px`
      return style
    }
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) {
        this.place()
        document.addEventListener('pointerdown', this.onOutsidePointer)
        document.addEventListener('keydown', this.onEscape)
        window.addEventListener('resize', this.place)
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
    weight(family: string): number {
      return fontWeight(family)
    },
    place(): void {
      const trigger = this.$refs.trigger as HTMLElement | undefined
      if (!trigger) return
      const t = trigger.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * EDGE)
      const left = Math.min(Math.max(t.left, EDGE), window.innerWidth - width - EDGE)
      const below = window.innerHeight - t.bottom - EDGE - 6
      const above = t.top - EDGE - 6
      if (below >= 260 || below >= above) {
        this.placement = { left, top: t.bottom + 6, width, maxHeight: Math.max(160, below) }
      } else {
        this.placement = { left, bottom: window.innerHeight - t.top + 6, width, maxHeight: Math.max(160, above) }
      }
    },
    toggle(): void {
      if (this.open) this.close(true)
      else this.openList()
    },
    openList(): void {
      this.active = this.currentIndex
      this.open = true
      this.$nextTick(() => this.focusActive(false))
    },
    close(returnFocus: boolean): void {
      const was = this.open
      this.open = false
      if (returnFocus && was) this.$nextTick(() => (this.$refs.trigger as HTMLElement | undefined)?.focus())
    },
    focusActive(scroll: boolean): void {
      const el = (this.$refs.list as HTMLElement | undefined)?.querySelector<HTMLElement>(`[data-index="${this.active}"]`)
      if (!el) return
      el.focus()
      if (scroll) el.scrollIntoView({ block: 'nearest' })
    },
    choose(family: string): void {
      this.$emit('update', family)
      this.close(true)
    },
    onListKey(event: KeyboardEvent): void {
      const last = CURATED_FONTS.length - 1
      switch (event.key) {
        case 'ArrowDown': this.active = Math.min(last, this.active + 1); break
        case 'ArrowUp': this.active = Math.max(0, this.active - 1); break
        case 'Home': this.active = 0; break
        case 'End': this.active = last; break
        case 'Enter':
        case ' ': {
          event.preventDefault()
          const family = CURATED_FONTS[this.active]?.family
          if (family) this.choose(family)
          return
        }
        case 'Tab':
          this.close(false)
          return
        default:
          return
      }
      event.preventDefault()
      this.focusActive(true)
    },
    onOutsidePointer(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      const root = this.$el as HTMLElement | undefined
      const list = this.$refs.popup as HTMLElement | undefined
      if (root?.contains(target) || list?.contains(target)) return
      this.close(false)
    },
    onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      this.close(true)
    }
  }
})
</script>

<template>
  <div class="relative min-w-0 flex-1">
    <button
      :id="$attrs.id as string | undefined"
      ref="trigger"
      type="button"
      class="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-line bg-panel px-2 text-left text-fg hover:bg-panel2"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="$t('text.font')"
      @click="toggle"
    >
      <span class="truncate text-base leading-none" :style="{ fontFamily: `'${modelValue}', system-ui, sans-serif`, fontWeight: weight(modelValue) }">{{ $t('text.fontSample') }}</span>
      <span class="shrink-0 text-xs text-muted">{{ modelValue }}</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popup"
        class="fixed z-50 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-xl"
        :style="placementStyle"
      >
        <ul ref="list" role="listbox" :aria-label="$t('text.font')" class="flex flex-col gap-0.5" @keydown="onListKey">
          <li
            v-for="(font, i) in fonts"
            :key="font.family"
            role="option"
            :data-index="i"
            :aria-selected="font.family === modelValue"
            :tabindex="i === active ? 0 : -1"
            class="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-fg outline-none focus-visible:ring-2 focus-visible:ring-fill"
            :class="font.family === modelValue ? 'bg-fill/15 font-semibold' : 'hover:bg-panel2'"
            @click="choose(font.family)"
            @focus="active = i"
          >
            <span class="truncate text-lg leading-tight" :style="{ fontFamily: `'${font.family}', system-ui, sans-serif`, fontWeight: font.weight }">
              {{ $t('text.fontSample') }}
            </span>
            <span class="shrink-0 text-[11px] text-muted">{{ font.family }}</span>
          </li>
        </ul>
      </div>
    </Teleport>
  </div>
</template>
