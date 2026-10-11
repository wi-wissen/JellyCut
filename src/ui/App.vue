<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions } from 'pinia'
import TopBar from './components/TopBar.vue'
import TabBar from './components/TabBar.vue'
import LibraryPanel from './components/LibraryPanel.vue'
import PlayerStage from './components/PlayerStage.vue'
import ActionBar from './components/ActionBar.vue'
import TimelinePanel from './components/TimelinePanel.vue'
import { useEditorStore } from './stores/editor'

export default defineComponent({
  name: 'App',
  components: { TopBar, TabBar, LibraryPanel, PlayerStage, ActionBar, TimelinePanel },
  mounted() {
    this.applyTheme()
  },
  methods: {
    ...mapActions(useEditorStore, ['applyTheme'])
  }
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-bg text-fg">
    <TopBar />
    <div class="flex min-h-0 flex-1">
      <aside class="flex w-[350px] shrink-0 flex-col border-r border-line bg-panel">
        <TabBar />
        <LibraryPanel />
      </aside>
      <main class="flex min-w-0 flex-1 flex-col">
        <PlayerStage />
        <ActionBar />
      </main>
    </div>
    <TimelinePanel />
  </div>
</template>
