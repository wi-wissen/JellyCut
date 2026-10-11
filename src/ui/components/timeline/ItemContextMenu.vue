<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import Icon from '../Icon.vue'

export interface MenuEntry {
  key: string
  label: string
  icon: string
  enabled: boolean
}

const VIEWPORT_MARGIN_PX = 8

/**
 * Actions for one timeline item. Arrow keys move, Home and End jump, Escape or Tab close it and the
 * opener gets the focus back (the parent does that on 'close').
 */
export default defineComponent({
  name: 'ItemContextMenu',
  components: { Icon },
  props: {
    entries: { type: Array as PropType<MenuEntry[]>, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    ariaLabel: { type: String, required: true }
  },
  emits: {
    run: (key: string) => typeof key === 'string',
    close: (restoreFocus: boolean) => typeof restoreFocus === 'boolean'
  },
  data() {
    return { left: 0, top: 0 }
  },
  mounted() {
    this.place()
    document.addEventListener('pointerdown', this.onOutsidePointer, true)
    document.addEventListener('keydown', this.onDocumentKey)
    window.addEventListener('resize', this.onWindowChange)
    window.addEventListener('scroll', this.onWindowChange, true)
    this.$nextTick(() => this.items()[0]?.focus())
  },
  beforeUnmount() {
    document.removeEventListener('pointerdown', this.onOutsidePointer, true)
    document.removeEventListener('keydown', this.onDocumentKey)
    window.removeEventListener('resize', this.onWindowChange)
    window.removeEventListener('scroll', this.onWindowChange, true)
  },
  methods: {
    items(): HTMLElement[] {
      const root = this.$refs.root as HTMLElement | undefined
      return Array.from(root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    },
    /** Opens at the pointer, moved inside the window when it would run off the edge. */
    place(): void {
      const el = this.$refs.root as HTMLElement | undefined
      const width = el?.offsetWidth ?? 200
      const height = el?.offsetHeight ?? 0
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX
      const maxTop = window.innerHeight - height - VIEWPORT_MARGIN_PX
      this.left = Math.max(VIEWPORT_MARGIN_PX, Math.min(this.x, maxLeft))
      this.top = Math.max(VIEWPORT_MARGIN_PX, Math.min(this.y, maxTop))
    },
    close(restoreFocus: boolean): void {
      this.$emit('close', restoreFocus)
    },
    run(entry: MenuEntry): void {
      if (!entry.enabled) return
      this.$emit('run', entry.key)
    },
    onMenuKey(event: KeyboardEvent): void {
      const items = this.items()
      const index = items.indexOf(event.target as HTMLElement)
      if (index < 0) return
      let next: number | null = null
      if (event.key === 'ArrowDown') next = (index + 1) % items.length
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = items.length - 1
      if (next === null) return
      event.preventDefault()
      items[next]?.focus()
    },
    onDocumentKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault()
        this.close(true)
      }
    },
    onOutsidePointer(event: PointerEvent): void {
      const el = this.$refs.root as HTMLElement | undefined
      if (el && event.target instanceof Node && !el.contains(event.target)) this.close(false)
    },
    onWindowChange(): void {
      this.close(false)
    }
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      role="menu"
      :aria-label="ariaLabel"
      class="jc-item-menu fixed z-[60] flex min-w-[196px] flex-col gap-0.5 rounded-xl border border-line bg-panel p-1.5 text-fg shadow-xl"
      :style="{ left: left + 'px', top: top + 'px' }"
      @keydown="onMenuKey"
    >
      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        role="menuitem"
        class="jc-item-menu__row flex items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-semibold hover:bg-panel2 focus-visible:bg-panel2"
        :class="entry.enabled ? '' : 'cursor-not-allowed opacity-40'"
        :aria-disabled="!entry.enabled"
        @click="run(entry)"
      >
        <Icon :name="entry.icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span>{{ entry.label }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 32 px rows with a mouse, 44 px with a finger. */
.jc-item-menu__row {
  min-height: 32px;
}
@media (pointer: coarse) {
  .jc-item-menu__row {
    min-height: 44px;
  }
}
</style>
