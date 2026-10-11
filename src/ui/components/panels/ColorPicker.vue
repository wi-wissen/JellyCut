<script lang="ts">
import { defineComponent } from 'vue'
import Icon from '../Icon.vue'
import { normalizeHex } from '../../../core/colors/hex'
import { TAILWIND_NEUTRALS, TAILWIND_ROWS, TAILWIND_SHADES } from '../../../core/colors/tailwindPalette'

/** Colours always offered inline, as before. */
const DEFAULT_COLORS: readonly string[] = ['#ffffff', '#14121f', '#c6f432', '#ffe066', '#ff5ca8', '#6d4cf5']
const RECENT_KEY = 'jc-recent-colors'
const RECENT_MAX = 8
// One cool grey (slate) and one warm grey (stone) are enough; the other three are nearly identical.
const REDUNDANT_GREYS = new Set(['gray', 'zinc', 'neutral'])
const POPOVER_WIDTH = 300
const EDGE = 8

/** Recent colours are a per-viewer convenience: kept in localStorage when available, never required. */
let recentCache: string[] | null = null
function recents(): string[] {
  if (recentCache) return recentCache
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    recentCache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && normalizeHex(x) === x).slice(0, RECENT_MAX) : []
  } catch {
    recentCache = []
  }
  return recentCache
}
function remember(hex: string): string[] {
  const list = [hex, ...recents().filter((c) => c !== hex)].slice(0, RECENT_MAX)
  recentCache = list
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // Storage is blocked or full: the list is only kept for this page view.
  }
  return list
}

interface Cell {
  hex: string
  name: string
  key: string
}

export default defineComponent({
  name: 'ColorPicker',
  components: { Icon },
  props: {
    modelValue: { type: String, required: true },
    groupLabel: { type: String, required: true },
    /** Popover (teleported, for the left panel) or inline (for dialogs that already scroll). */
    popover: { type: Boolean, default: true }
  },
  emits: {
    update: (hex: string) => normalizeHex(hex) !== null,
    commit: () => true
  },
  data() {
    return {
      defaults: DEFAULT_COLORS,
      // Inline pickers are always open: the palette is the content of their section.
      open: !this.popover,
      recentList: recents(),
      hexText: '',
      hexError: false,
      focusRow: 0,
      focusCol: 0,
      placement: { left: EDGE, top: EDGE, width: POPOVER_WIDTH, maxHeight: 400 } as { left: number; top?: number; bottom?: number; width: number; maxHeight: number }
    }
  },
  computed: {
    current(): string {
      return normalizeHex(this.modelValue) ?? this.modelValue
    },
    /** Palette rows: the colour hues of 11 shades, one cool and one warm grey, then white and black. */
    grid(): Cell[][] {
      const rows = TAILWIND_ROWS.filter((row) => !REDUNDANT_GREYS.has(row.hue)).map((row) =>
        row.hexes.map((hex, i): Cell => {
          const shade = TAILWIND_SHADES[i]
          const hue = this.$t(`colors.hues.${row.hue}`)
          return { hex, key: `${row.hue}-${shade}`, name: this.$t('colors.cell', { hue, shade, hex }) }
        })
      )
      rows.push(
        TAILWIND_NEUTRALS.map((n): Cell => ({
          hex: n.hex,
          key: n.name,
          name: this.$t('colors.neutral', { name: this.$t(`colors.${n.name}`), hex: n.hex })
        }))
      )
      return rows
    },
    placementStyle(): Record<string, string> {
      const p = this.placement
      const style: Record<string, string> = { left: `${p.left}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` }
      if (p.top !== undefined) style.top = `${p.top}px`
      if (p.bottom !== undefined) style.bottom = `${p.bottom}px`
      return style
    },
    hexErrorId(): string {
      return `${this.groupLabel.replace(/\W+/g, '-')}-hex-error`
    }
  },
  watch: {
    open(isOpen: boolean) {
      if (!this.popover) return
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
    same(a: string, b: string): boolean {
      return a.toLowerCase() === b.toLowerCase()
    },
    /** Places the popover under the trigger, or above it when there is no room below. */
    place(): void {
      const trigger = this.$refs.trigger as HTMLElement | undefined
      if (!trigger) return
      const t = trigger.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * EDGE)
      const left = Math.min(Math.max(t.left, EDGE), window.innerWidth - width - EDGE)
      const below = window.innerHeight - t.bottom - EDGE - 6
      const above = t.top - EDGE - 6
      if (below >= 280 || below >= above) {
        this.placement = { left, top: t.bottom + 6, width, maxHeight: Math.max(160, below) }
      } else {
        this.placement = { left, bottom: window.innerHeight - t.top + 6, width, maxHeight: Math.max(160, above) }
      }
    },
    toggle(): void {
      if (this.open) {
        this.close(true)
        return
      }
      this.hexText = this.current
      this.hexError = false
      this.recentList = recents()
      this.open = true
      this.$nextTick(() => {
        const [r, c] = this.indexOf(this.current)
        this.focusRow = r
        this.focusCol = c
        this.focusCell(false)
      })
    },
    close(returnFocus: boolean): void {
      if (!this.popover) return
      const was = this.open
      this.open = false
      if (returnFocus && was && this.popover) this.$nextTick(() => (this.$refs.trigger as HTMLElement | undefined)?.focus())
    },
    /** Row and column of a colour in the grid, or the first cell when it is not in the palette. */
    indexOf(hex: string): [number, number] {
      for (let r = 0; r < this.grid.length; r++) {
        const c = this.grid[r]!.findIndex((cell) => this.same(cell.hex, hex))
        if (c >= 0) return [r, c]
      }
      return [0, 0]
    },
    cellEl(r: number, c: number): HTMLElement | null {
      return (this.$refs.grid as HTMLElement | undefined)?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`) ?? null
    },
    focusCell(scroll: boolean): void {
      const el = this.cellEl(this.focusRow, this.focusCol)
      if (el) {
        el.focus()
        if (scroll) el.scrollIntoView({ block: 'nearest' })
      }
    },
    /** Arrow keys move through the grid; Enter and Space come from the focused button itself. */
    onGridKey(event: KeyboardEvent): void {
      const rows = this.grid.length
      let r = this.focusRow
      let c = this.focusCol
      switch (event.key) {
        case 'ArrowRight': c += 1; break
        case 'ArrowLeft': c -= 1; break
        case 'ArrowDown': r += 1; break
        case 'ArrowUp': r -= 1; break
        case 'Home': c = 0; break
        case 'End': c = Number.MAX_SAFE_INTEGER; break
        default: return
      }
      event.preventDefault()
      r = Math.min(Math.max(r, 0), rows - 1)
      const rowLength = this.grid[r]!.length
      c = Math.min(Math.max(c, 0), rowLength - 1)
      this.focusRow = r
      this.focusCol = c
      this.focusCell(true)
    },
    choose(hex: string): void {
      this.recentList = remember(hex)
      this.$emit('update', hex)
      this.$emit('commit')
      this.close(true)
    },
    onSwatch(hex: string): void {
      this.recentList = remember(hex)
      this.$emit('update', hex)
      this.$emit('commit')
    },
    onHex(event: Event): void {
      this.hexText = (event.target as HTMLInputElement).value
      const hex = normalizeHex(this.hexText)
      // An invalid value shows the error and leaves the colour as it was.
      this.hexError = hex === null && this.hexText.trim() !== ''
      if (hex) this.$emit('update', hex)
    },
    commitHex(): void {
      const hex = normalizeHex(this.hexText)
      if (!hex) {
        this.hexError = true
        return
      }
      this.choose(hex)
    },
    onNative(event: Event): void {
      this.$emit('update', (event.target as HTMLInputElement).value)
    },
    onNativeCommit(event: Event): void {
      this.recentList = remember((event.target as HTMLInputElement).value)
      this.$emit('commit')
    },
    onOutsidePointer(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      const root = this.$el as HTMLElement | undefined
      const panel = this.$refs.panel as HTMLElement | undefined
      if (root?.contains(target) || panel?.contains(target)) return
      this.close(false)
    },
    onEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      this.close(true)
    },
  }
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center" role="group" :aria-label="groupLabel">
      <button
        v-for="hex in defaults"
        :key="hex"
        type="button"
        class="flex size-11 items-center justify-center rounded-lg hover:bg-panel2"
        :aria-pressed="same(current, hex)"
        :aria-label="$t('colors.swatch', { hex })"
        :title="hex"
        @click="onSwatch(hex)"
      >
        <span
          class="size-7 rounded-full border border-line"
          :class="same(current, hex) ? 'ring-2 ring-fill ring-offset-2 ring-offset-panel' : ''"
          :style="{ background: hex }"
          aria-hidden="true"
        />
      </button>
      <button
        v-if="popover"
        ref="trigger"
        type="button"
        class="flex size-11 items-center justify-center rounded-lg hover:bg-panel2"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-label="$t('colors.more')"
        :title="$t('colors.more')"
        @click="toggle"
      >
        <span
          class="flex size-7 items-center justify-center rounded-full border border-line bg-panel2 text-muted"
          :style="!defaults.some((d) => same(d, current)) ? { background: current } : {}"
          aria-hidden="true"
        >
          <Icon name="plus" class="size-3.5" />
        </span>
      </button>
    </div>

    <Teleport to="body" :disabled="!popover">
      <div
        v-if="open || !popover"
        ref="panel"
        role="dialog"
        :aria-label="groupLabel"
        class="flex flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-[12px] text-fg"
        :class="popover ? 'fixed z-50 shadow-xl' : 'relative mt-1'"
        :style="popover ? placementStyle : undefined"
      >
        <template v-if="recentList.length">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('colors.recent') }}</h3>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="hex in recentList"
              :key="`recent-${hex}`"
              type="button"
              class="flex size-9 items-center justify-center rounded-md hover:bg-panel2"
              :aria-label="$t('colors.swatch', { hex })"
              :title="hex"
              @click="choose(hex)"
            >
              <span class="size-6 rounded-full border border-line" :style="{ background: hex }" aria-hidden="true" />
            </button>
          </div>
        </template>

        <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('colors.palette') }}</h3>
        <div ref="grid" role="grid" class="flex flex-col gap-[3px]" :aria-label="$t('colors.palette')" :aria-describedby="`${groupLabel}-grid-hint`" @keydown="onGridKey">
          <p :id="`${groupLabel}-grid-hint`" class="sr-only">{{ $t('colors.gridHint') }}</p>
          <div v-for="(row, r) in grid" :key="r" role="row" class="flex gap-[3px]">
            <button
              v-for="(cell, c) in row"
              :key="cell.key"
              type="button"
              role="gridcell"
              class="size-[22px] shrink-0 rounded-[3px] border border-line focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fill"
              :class="same(current, cell.hex) ? 'ring-2 ring-fill ring-offset-1 ring-offset-panel' : ''"
              :style="{ background: cell.hex }"
              :data-r="r"
              :data-c="c"
              :tabindex="r === focusRow && c === focusCol ? 0 : -1"
              :aria-label="cell.name"
              :aria-selected="same(current, cell.hex)"
              :title="cell.name"
              @focus="focusRow = r; focusCol = c"
              @click="choose(cell.hex)"
            />
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label :for="`${groupLabel}-hex`" class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('colors.hex') }}</label>
          <div class="flex items-center gap-2">
            <input
              :id="`${groupLabel}-hex`"
              type="text"
              inputmode="text"
              autocomplete="off"
              spellcheck="false"
              class="min-h-11 min-w-0 flex-1 rounded-lg border bg-bg px-2 font-mono text-sm text-fg"
              :class="hexError ? 'border-danger' : 'border-line'"
              :value="hexText"
              :placeholder="$t('colors.hexHint')"
              :aria-invalid="hexError"
              :aria-describedby="hexError ? hexErrorId : undefined"
              @input="onHex"
              @keydown.enter.prevent="commitHex"
            />
            <input
              type="color"
              class="size-11 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-1"
              :value="current"
              :aria-label="$t('colors.custom')"
              :title="$t('colors.custom')"
              @input="onNative"
              @change="onNativeCommit"
            />
          </div>
          <p v-if="hexError" :id="hexErrorId" role="alert" class="text-[11px] text-danger">{{ $t('colors.hexInvalid') }}</p>
        </div>

        <button v-if="popover" type="button" class="min-h-11 rounded-lg bg-panel2 text-xs font-semibold text-fg hover:bg-line" @click="close(true)">
          {{ $t('colors.close') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>
