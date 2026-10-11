<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ChoiceTile from './ChoiceTile.vue'
import ColorPicker from './ColorPicker.vue'
import StickerAnimation from './StickerAnimation.vue'
import { allMessages } from '../../i18n'
import { useEditorStore } from '../../stores/editor'
import { stickerImageUrl } from '../../../engine/render/stickerImages'
import { STICKER_IMAGES, STICKER_IMAGE_CATEGORIES } from '../../../core/render/stickerImages'
import { STICKER_SHAPES, type StickerShapeId } from '../../../core/render/stickerShapes'
import { animatedSticker } from '../../../core/render/stickerAnimations'
import { BASIC_STICKER_IDS } from '../../../core/timeline/overlayCatalog'

/** A tile starts playing its animation after the pointer rested on it this long, so a quick pass downloads nothing. */
const HOVER_DELAY_MS = 150

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

type Tab = (typeof STICKER_IMAGE_CATEGORIES)[number] | 'basics' | 'all'
const TABS: readonly Tab[] = ['all', ...STICKER_IMAGE_CATEGORIES, 'basics']

/** A sticker that stands for its category in the dropdown; 'all' and 'basics' use an icon instead. */
const CATEGORY_STICKER: Partial<Record<Tab, string>> = {
  faces: 'grin',
  moreFaces: 'smile',
  hearts: 'heart',
  animals: 'panda',
  celebrate: 'partyPopper',
  nature: 'sun',
  food: 'pizza',
  symbols: 'star',
  school: 'books'
}

interface Entry {
  kind: 'image' | 'shape'
  id: string
  tab: Tab
  /** Lower-case labels in both languages, so 'Herz' and 'heart' find the same sticker. */
  haystack: string
}

// Outside the component data: a timer id needs no reactivity.
let hoverTimer = 0

type MessageTree = { [key: string]: MessageTree | string }

/** Lower case without accents, so 'Tranen' finds 'Tränen'. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function lookup(tree: MessageTree, path: string): string {
  const value = path.split('.').reduce<MessageTree | string | undefined>((node, key) => (typeof node === 'object' ? node[key] : undefined), tree)
  return typeof value === 'string' ? value : ''
}

/**
 * Gallery of picture stickers (category dropdown and a search field) and the plain colourable shapes. A tap adds
 * one at the playhead; shapes are drawn in the colour shown under the 'Shapes' category.
 */
export default defineComponent({
  name: 'StickerPanel',
  components: { Icon, ChoiceTile, ColorPicker, StickerAnimation },
  data() {
    return { tab: 'faces' as Tab, query: '', tabs: TABS, playing: null as string | null, menuOpen: false, menuBox: { left: 0, top: 0, width: 0, maxHeight: 352, up: false } }
  },
  computed: {
    ...mapState(useEditorStore, ['overlayColor']),
    entries(): Entry[] {
      const all = allMessages()
      const trees = [all.de, all.en] as MessageTree[]
      const words = (key: string) => fold(trees.map((tree) => lookup(tree, key)).join(' '))
      return [
        ...STICKER_IMAGES.map((s): Entry => ({ kind: 'image', id: s.id, tab: s.category, haystack: words(`stickers.image.${s.id}`) })),
        ...STICKER_SHAPES.filter((s) => BASIC_STICKER_IDS.includes(s.id)).map(
          (s): Entry => ({ kind: 'shape', id: s.id, tab: 'basics', haystack: words(`overlays3.sticker.${s.id}`) })
        )
      ]
    },
    searching(): boolean {
      return this.query.trim() !== ''
    },
    visible(): Entry[] {
      if (this.searching) {
        const terms = fold(this.query).split(/\s+/).filter(Boolean)
        return this.entries.filter((e) => terms.every((t) => e.haystack.includes(t)))
      }
      return this.tab === 'all' ? this.entries : this.entries.filter((e) => e.tab === this.tab)
    },
    showColour(): boolean {
      return this.searching || this.tab === 'all' ? this.visible.some((e) => e.kind === 'shape') : this.tab === 'basics'
    }
  },
  beforeUnmount() {
    this.stopPlaying()
    this.stopListening()
  },
  methods: {
    ...mapActions(useEditorStore, ['addImageStickerAtPlayhead', 'addVectorStickerAtPlayhead', 'setOverlayColor']),
    label(entry: Entry): string {
      return entry.kind === 'image' ? this.$t(`stickers.image.${entry.id}`) : this.$t(`overlays3.sticker.${entry.id}`)
    },
    imageUrl(id: string): string {
      return stickerImageUrl(id)
    },
    shapePath(id: string) {
      return STICKER_SHAPES.find((s) => s.id === id)!
    },
    /** A tile has a moving version when the sticker has an animation (not for shapes). */
    hasAnimation(entry: Entry): boolean {
      return entry.kind === 'image' && animatedSticker(entry.id) !== null
    },
    /** Hover (mouse) or keyboard focus plays the tile's animation; one tile at a time, none with reduced motion. */
    playLater(entry: Entry): void {
      this.stopPlaying()
      if (!this.hasAnimation(entry) || prefersReducedMotion()) return
      hoverTimer = window.setTimeout(() => {
        hoverTimer = 0
        this.playing = entry.id
      }, HOVER_DELAY_MS)
    },
    stopPlaying(): void {
      window.clearTimeout(hoverTimer)
      hoverTimer = 0
      this.playing = null
    },
    onTileEnter(entry: Entry, event: PointerEvent): void {
      if (event.pointerType === 'mouse') this.playLater(entry)
    },
    onTileFocus(entry: Entry, event: FocusEvent): void {
      if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) this.playLater(entry)
    },
    add(entry: Entry): void {
      if (entry.kind === 'image') this.addImageStickerAtPlayhead(entry.id, this.hasAnimation(entry))
      else this.addVectorStickerAtPlayhead(entry.id as StickerShapeId)
    },
    categoryImage(id: Tab): string | null {
      const sticker = CATEGORY_STICKER[id]
      return sticker ? stickerImageUrl(sticker) : null
    },
    pick(tab: Tab): void {
      this.tab = tab
      this.query = ''
      this.closeMenu(true)
    },
    options(): HTMLElement[] {
      return Array.from((this.$refs.menu as HTMLElement | undefined)?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    },
    /** The list is fixed to the window so the scrolling panel cannot clip it, follows the trigger on scroll and opens upwards when there is more room above. */
    placeMenu(): void {
      const rect = (this.$refs.trigger as HTMLElement).getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const up = below < 260 && above > below
      this.menuBox = { left: rect.left, top: up ? rect.top - 4 : rect.bottom + 4, width: rect.width, maxHeight: Math.min(352, up ? above : below), up }
    },
    openMenu(): void {
      this.placeMenu()
      this.menuOpen = true
      document.addEventListener('pointerdown', this.onOutside, true)
      window.addEventListener('resize', this.onWindowChange)
      window.addEventListener('scroll', this.onWindowChange, true)
      void this.$nextTick(() => (this.options().find((o) => o.id === `sticker-cat-${this.tab}`) ?? this.options()[0])?.focus({ preventScroll: true }))
    },
    closeMenu(restoreFocus: boolean): void {
      if (!this.menuOpen) return
      this.menuOpen = false
      this.stopListening()
      if (restoreFocus) void this.$nextTick(() => (this.$refs.trigger as HTMLElement | undefined)?.focus())
    },
    stopListening(): void {
      document.removeEventListener('pointerdown', this.onOutside, true)
      window.removeEventListener('resize', this.onWindowChange)
      window.removeEventListener('scroll', this.onWindowChange, true)
    },
    onWindowChange(event: Event): void {
      if (event.target instanceof Node && (this.$refs.menu as HTMLElement | undefined)?.contains(event.target)) return
      this.placeMenu()
    },
    onOutside(event: PointerEvent): void {
      const root = this.$refs.picker as HTMLElement | undefined
      if (root && event.target instanceof Node && !root.contains(event.target)) this.closeMenu(false)
    },
    onTriggerKey(event: KeyboardEvent): void {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.openMenu()
      }
    },
    /** Listbox keys: arrows, Home and End move; Enter or Space picks; Escape and Tab close. */
    onMenuKey(event: KeyboardEvent): void {
      const options = this.options()
      const index = options.indexOf(event.target as HTMLElement)
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault()
        this.closeMenu(true)
        return
      }
      let next: number | null = null
      if (event.key === 'ArrowDown') next = (index + 1) % options.length
      else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = options.length - 1
      if (next === null) return
      event.preventDefault()
      options[next]?.focus()
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="shrink-0 text-sm font-bold">{{ $t('tabs.sticker') }}</h2>
    <p class="shrink-0 text-xs leading-relaxed text-muted">{{ $t('overlays.stickerHint') }}</p>

    <div ref="picker" class="shrink-0" data-role="sticker-category">
      <span id="sticker-category-label" class="mb-1 block text-xs font-semibold text-muted">{{ $t('stickers.category.label') }}</span>
      <button
        ref="trigger"
        type="button"
        class="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-line bg-panel px-3 text-left text-sm font-semibold text-fg hover:bg-panel2"
        aria-haspopup="listbox"
        aria-labelledby="sticker-category-label sticker-category-value"
        :aria-expanded="menuOpen"
        aria-controls="sticker-category-list"
        @click="menuOpen ? closeMenu(true) : openMenu()"
        @keydown="onTriggerKey"
      >
        <template v-if="!searching">
          <img v-if="categoryImage(tab)" :src="categoryImage(tab)!" alt="" width="20" height="20" class="size-5 shrink-0" />
          <Icon v-else :name="tab === 'all' ? 'grid' : 'shapes'" class="size-5 shrink-0 text-muted" />
        </template>
        <Icon v-else name="grid" class="size-5 shrink-0 text-muted" />
        <span id="sticker-category-value" class="min-w-0 flex-1 truncate">
          {{ searching ? $t('stickers.category.searching') : $t(`stickers.categories.${tab}`) }}
        </span>
        <Icon name="chevronDown" class="size-4 shrink-0 text-muted transition-transform" :class="menuOpen ? 'rotate-180' : ''" />
      </button>
      <ul
        v-show="menuOpen"
        id="sticker-category-list"
        ref="menu"
        role="listbox"
        class="fixed z-[60] flex flex-col gap-0.5 overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-xl"
        :style="{ left: menuBox.left + 'px', width: menuBox.width + 'px', maxHeight: menuBox.maxHeight + 'px', top: menuBox.top + 'px', transform: menuBox.up ? 'translateY(-100%)' : 'none' }"
        aria-labelledby="sticker-category-label"
        @keydown="onMenuKey"
      >
        <li
          v-for="id in tabs"
          :id="`sticker-cat-${id}`"
          :key="id"
          role="option"
          tabindex="-1"
          class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold hover:bg-panel2 focus-visible:bg-panel2"
          :class="!searching && tab === id ? 'bg-panel2' : ''"
          :aria-selected="!searching && tab === id"
          :data-category="id"
          @click="pick(id)"
          @keydown.enter.prevent="pick(id)"
          @keydown.space.prevent="pick(id)"
        >
          <img v-if="categoryImage(id)" :src="categoryImage(id)!" alt="" width="20" height="20" loading="lazy" class="size-5 shrink-0" />
          <Icon v-else :name="id === 'all' ? 'grid' : 'shapes'" class="size-5 shrink-0 text-muted" />
          <span class="min-w-0 flex-1 truncate">{{ $t(`stickers.categories.${id}`) }}</span>
          <Icon v-if="!searching && tab === id" name="check" class="size-4 shrink-0 text-muted" />
        </li>
      </ul>
    </div>

    <input
      v-model="query"
      type="search"
      class="min-h-11 w-full shrink-0 rounded-lg border border-line bg-panel px-3 text-sm text-fg placeholder:text-muted"
      :aria-label="$t('stickers.search')"
      :placeholder="$t('stickers.placeholder')"
      autocomplete="off"
      @keydown.esc="query = ''"
    />

    <div
      id="sticker-grid"
      class="grid shrink-0 grid-cols-3 content-start gap-2.5"
      role="group"
      :aria-label="searching ? $t('stickers.results') : $t(`stickers.categories.${tab}`)"
    >
      <ChoiceTile
        v-for="entry in visible"
        :key="`${entry.kind}-${entry.id}`"
        :label="label(entry)"
        aspect="aspect-square"
        :description="hasAnimation(entry) ? $t('stickers.animated.badge') : ''"
        :data-sticker="entry.kind === 'image' ? entry.id : `shape-${entry.id}`"
        :data-has-animation="hasAnimation(entry) ? 'true' : undefined"
        @choose="add(entry)"
        @pointerenter="onTileEnter(entry, $event)"
        @pointerleave="stopPlaying"
        @focusin="onTileFocus(entry, $event)"
        @focusout="stopPlaying"
      >
        <img
          v-if="entry.kind === 'image'"
          :src="imageUrl(entry.id)"
          alt=""
          width="256"
          height="256"
          loading="lazy"
          decoding="async"
          draggable="false"
          class="absolute inset-0 m-auto size-[78%] object-contain"
        />
        <StickerAnimation v-if="playing === entry.id" :id="entry.id" class="absolute inset-0 m-auto size-[78%] object-contain" />
        <span
          v-if="hasAnimation(entry)"
          class="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-panel/85 text-fg shadow"
          role="img"
          :aria-label="$t('stickers.animated.badge')"
          :title="$t('stickers.animated.badge')"
          data-animated-badge
        >
          <Icon name="sparkles" class="size-3" />
        </span>
        <span v-if="entry.kind === 'shape'" class="absolute inset-0 flex items-center justify-center p-[22%]" :style="{ color: overlayColor }" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="size-full">
            <path
              :d="shapePath(entry.id).d"
              :fill="shapePath(entry.id).kind === 'fill' ? 'currentColor' : 'none'"
              :stroke="shapePath(entry.id).kind === 'line' ? 'currentColor' : 'none'"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill-rule="evenodd"
            />
          </svg>
        </span>
      </ChoiceTile>
    </div>
    <p v-if="visible.length === 0" class="text-xs text-muted" role="status">{{ $t('stickers.none') }}</p>

    <div v-if="showColour" class="shrink-0 border-t border-line pt-3">
      <ColorPicker :model-value="overlayColor" :group-label="$t('design.colour')" @update="setOverlayColor" />
    </div>
    <p class="mt-auto shrink-0 text-[11px] leading-snug text-muted">{{ $t('stickers.credit') }}</p>
  </div>
</template>
