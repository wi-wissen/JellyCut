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
import { useEditorStore } from '../stores/editor'
import type { Clip, MusicItem, TextItem } from '../../core/project/types'

/** What the left column shows; a selected item wins over the tab, except on the transitions and filter tabs. */
type View = 'clip' | 'text-item' | 'music-item' | 'transitions' | 'filter' | 'library' | 'audio' | 'text' | 'record'

export default defineComponent({
  name: 'LeftPanel',
  components: { TabBar, LibraryPanel, ClipPanel, TextPanel, TextProperties, MusicProperties, TransitionsPanel, FilterPanel, RecordPanel },
  computed: {
    ...mapState(useEditorStore, ['activeTab', 'selection', 'selectedItem']),
    view(): View {
      if (this.activeTab === 'transitions') return 'transitions'
      if (this.activeTab === 'filter') return 'filter'
      const ref = this.selection
      const item = this.selectedItem
      if (ref?.kind === 'clip' && item && 'transitionIn' in item) return 'clip'
      if (ref?.kind === 'text' && item && 'text' in item) return 'text-item'
      if (ref?.kind === 'music' && item && 'volume' in item && 'assetId' in item && !('transitionIn' in item)) return 'music-item'
      if (this.activeTab === 'audio') return 'audio'
      if (this.activeTab === 'text') return 'text'
      if (this.activeTab === 'record') return 'record'
      return 'library'
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
  methods: {
    ...mapActions(useEditorStore, ['setActiveTab'])
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <TabBar />

    <ClipPanel v-if="view === 'clip'" />
    <TextProperties v-else-if="view === 'text-item' && selectedTextItem" :item="selectedTextItem" />
    <MusicProperties v-else-if="view === 'music-item' && selectedMusicItem" :item="selectedMusicItem" />
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
</template>
