<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import ChoiceTile from './ChoiceTile.vue'
import ColorPicker from './ColorPicker.vue'
import { allMessages } from '../../i18n'
import { useEditorStore } from '../../stores/editor'
import { stickerImageUrl } from '../../../engine/render/stickerImages'
import { STICKER_IMAGES, STICKER_IMAGE_CATEGORIES } from '../../../core/render/stickerImages'
import { STICKER_SHAPES, type StickerShapeId } from '../../../core/render/stickerShapes'
import { BASIC_STICKER_IDS } from '../../../core/timeline/overlayCatalog'

type Tab = (typeof STICKER_IMAGE_CATEGORIES)[number] | 'basics'
const TABS: readonly Tab[] = [...STICKER_IMAGE_CATEGORIES, 'basics']

interface Entry {
  kind: 'image' | 'shape'
  id: string
  tab: Tab
  /** Lower-case labels in both languages, so 'Herz' and 'heart' find the same sticker. */
  haystack: string
}

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
 * Gallery of picture stickers (category tabs and a search field) and the plain colourable shapes. A tap adds
 * one at the playhead; shapes are drawn in the colour shown under the 'Shapes' tab.
 */
export default defineComponent({
  name: 'StickerPanel',
  components: { ChoiceTile, ColorPicker },
  data() {
    return { tab: 'faces' as Tab, query: '', tabs: TABS }
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
      return this.entries.filter((e) => e.tab === this.tab)
    },
    showColour(): boolean {
      return this.searching ? this.visible.some((e) => e.kind === 'shape') : this.tab === 'basics'
    }
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
    add(entry: Entry): void {
      if (entry.kind === 'image') this.addImageStickerAtPlayhead(entry.id)
      else this.addVectorStickerAtPlayhead(entry.id as StickerShapeId)
    },
    pick(tab: Tab): void {
      this.tab = tab
      this.query = ''
    },
    /** Arrow keys move between the category tabs; the focused tab opens at once. */
    onTabKey(event: KeyboardEvent): void {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      const jump = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
      if (step === 0 && jump === null) return
      event.preventDefault()
      const index = jump ?? (TABS.indexOf(this.tab) + step + TABS.length) % TABS.length
      this.pick(TABS[index]!)
      void this.$nextTick(() => (this.$refs.tabButtons as HTMLElement | undefined)?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="shrink-0 text-sm font-bold">{{ $t('tabs.sticker') }}</h2>
    <p class="shrink-0 text-xs leading-relaxed text-muted">{{ $t('overlays.stickerHint') }}</p>

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
      ref="tabButtons"
      class="-mx-3 flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-1"
      role="tablist"
      :aria-label="$t('stickers.tabs')"
      @keydown="onTabKey"
    >
      <button
        v-for="id in tabs"
        :id="`sticker-tab-${id}`"
        :key="id"
        type="button"
        role="tab"
        class="min-h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold"
        :class="!searching && tab === id ? 'bg-fill text-fill-fg' : 'bg-panel2 text-fg hover:bg-panel'"
        :aria-selected="!searching && tab === id"
        :aria-controls="'sticker-grid'"
        :tabindex="tab === id ? 0 : -1"
        @click="pick(id)"
      >
        {{ $t(`stickers.categories.${id}`) }}
      </button>
    </div>

    <div
      id="sticker-grid"
      class="grid shrink-0 grid-cols-3 content-start gap-2.5"
      role="tabpanel"
      :aria-labelledby="searching ? undefined : `sticker-tab-${tab}`"
      :aria-label="searching ? $t('stickers.results') : undefined"
    >
      <ChoiceTile
        v-for="entry in visible"
        :key="`${entry.kind}-${entry.id}`"
        :label="label(entry)"
        aspect="aspect-square"
        :data-sticker="entry.kind === 'image' ? entry.id : `shape-${entry.id}`"
        @choose="add(entry)"
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
        <span v-else class="absolute inset-0 flex items-center justify-center p-[22%]" :style="{ color: overlayColor }" aria-hidden="true">
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
