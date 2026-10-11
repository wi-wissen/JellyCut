<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import TabBar from './TabBar.vue'
import LibraryPanel from './LibraryPanel.vue'
import ClipPanel from './panels/ClipPanel.vue'
import TextPanel from './panels/TextPanel.vue'
import TextProperties from './panels/TextProperties.vue'
import MusicProperties from './panels/MusicProperties.vue'
import TransitionsPanel from './panels/TransitionsPanel.vue'
import FilterPanel from './panels/FilterPanel.vue'
import RecordPanel from './panels/RecordPanel.vue'
import StickerPanel from './panels/StickerPanel.vue'
import DrawPanel from './panels/DrawPanel.vue'
import OverlayProperties from './panels/OverlayProperties.vue'
import { useEditorStore } from '../stores/editor'
import type { Clip, MusicItem, OverlayItem, TextItem } from '../../core/project/types'

/** What the left column shows; a selected item wins over the tab, except on the transitions and filter tabs. */
type View = 'clip' | 'text-item' | 'music-item' | 'overlay-item' | 'transitions' | 'filter' | 'library' | 'audio' | 'text' | 'record' | 'sticker' | 'draw'

export default defineComponent({
  name: 'LeftPanel',
  components: { TabBar, LibraryPanel, ClipPanel, TextPanel, TextProperties, MusicProperties, TransitionsPanel, FilterPanel, RecordPanel, StickerPanel, DrawPanel, OverlayProperties },
  data() {
    // On a narrow layout the sheet starts open in portrait (library first) and closed in landscape, where the player needs the height.
    const landscape = typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches
    return { sheetOpen: !landscape }
  },
  computed: {
    ...mapState(useEditorStore, ['activeTab', 'selection', 'selectedItem', 'selectedOverlay']),
    view(): View {
      if (this.activeTab === 'transitions') return 'transitions'
      if (this.activeTab === 'filter') return 'filter'
      const ref = this.selection
      const item = this.selectedItem
      if (ref?.kind === 'clip' && item && 'transitionIn' in item) return 'clip'
      if (ref?.kind === 'text' && item && 'text' in item) return 'text-item'
      if (ref?.kind === 'overlay' && this.selectedOverlay) return 'overlay-item'
      if (ref?.kind === 'music' && item && 'volume' in item && 'assetId' in item && !('transitionIn' in item)) return 'music-item'
      if (this.activeTab === 'audio') return 'audio'
      if (this.activeTab === 'text') return 'text'
      if (this.activeTab === 'record') return 'record'
      if (this.activeTab === 'sticker') return 'sticker'
      if (this.activeTab === 'draw') return 'draw'
      return 'library'
    },
    selectedOverlayItem(): OverlayItem | null {
      return this.view === 'overlay-item' ? this.selectedOverlay : null
    },
    selectedClipItem(): Clip | null {
      return this.view === 'clip' ? (this.selectedItem as Clip) : null
    },
    selectedTextItem(): TextItem | null {
      return this.view === 'text-item' ? (this.selectedItem as TextItem) : null
    },
    selectedMusicItem(): MusicItem | null {
      return this.view === 'music-item' ? (this.selectedItem as MusicItem) : null
    }
  },
  watch: {
    // Picking a clip or a tab on a narrow layout shows its panel.
    selection(): void {
      if (this.selection) this.sheetOpen = true
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['setActiveTab'])
  }
})
</script>

<template>
  <!-- Content comes before the tab bar in the DOM: on phones the tab bar sits below the content. Desktop puts it on top via CSS. -->
  <div class="jc-left flex min-h-0 flex-1 flex-col" :class="{ 'jc-left--collapsed': !sheetOpen }">
    <div class="jc-left__content flex min-h-0 flex-1 flex-col">
      <ClipPanel v-if="view === 'clip'" />
      <TextProperties v-else-if="view === 'text-item' && selectedTextItem" :item="selectedTextItem" />
      <OverlayProperties v-else-if="view === 'overlay-item' && selectedOverlayItem" :item="selectedOverlayItem" />
      <MusicProperties v-else-if="view === 'music-item' && selectedMusicItem" :item="selectedMusicItem" />
      <StickerPanel v-else-if="view === 'sticker'" />
      <DrawPanel v-else-if="view === 'draw'" />
      <TransitionsPanel v-else-if="view === 'transitions'" />
      <FilterPanel v-else-if="view === 'filter'" />
      <TextPanel v-else-if="view === 'text'" />
      <RecordPanel v-else-if="view === 'record'" />
      <LibraryPanel
        v-else-if="view === 'audio'"
        :kinds="['audio']"
        :heading="$t('library.audio')"
      />
      <LibraryPanel v-else :kinds="['video', 'image']" />
    </div>

    <TabBar
      :sheet-open="sheetOpen"
      @toggle-sheet="sheetOpen = !sheetOpen"
      @tab-picked="sheetOpen = true"
    />
  </div>
</template>
