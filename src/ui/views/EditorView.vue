<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions } from 'pinia'
import TopBar from '../components/TopBar.vue'
import LeftPanel from '../components/LeftPanel.vue'
import PlayerStage from '../components/PlayerStage.vue'
import ActionBar from '../components/ActionBar.vue'
import TimelinePanel from '../components/TimelinePanel.vue'
import FineCutOverlay from '../components/fineCut/FineCutOverlay.vue'
import { useEditorStore } from '../stores/editor'
import '../fonts'

// The autosave is restored the first time the editor is opened, so the landing and help pages never touch it.
let restored = false

const TEXT_INPUT_TYPES = /^(text|search|url|tel|email|password|number)$/

function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.test(target.type)
  return target instanceof HTMLElement && target.isContentEditable
}

export default defineComponent({
  name: 'EditorView',
  components: { TopBar, LeftPanel, PlayerStage, ActionBar, TimelinePanel, FineCutOverlay },
  async beforeRouteEnter() {
    if (restored) return
    restored = true
    await useEditorStore().restoreAutosave()
  },
  mounted() {
    this.applyTheme()
    document.addEventListener('keydown', this.onKeydown)
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKeydown)
  },
  methods: {
    ...mapActions(useEditorStore, ['applyTheme', 'undo', 'redo', 'saveProject']),
    onKeydown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      // Save has no native meaning in a text field, so it works everywhere; undo and redo leave text fields alone.
      if (key === 's' && !event.shiftKey) {
        event.preventDefault()
        void this.saveProject()
        return
      }
      if (isTextEntry(event.target)) return
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        this.undo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        this.redo()
      }
    }
  }
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-bg text-fg">
    <TopBar />
    <div class="flex min-h-0 flex-1">
      <aside class="flex w-[350px] shrink-0 flex-col border-r border-line bg-panel">
        <LeftPanel />
      </aside>
      <main class="flex min-w-0 flex-1 flex-col">
        <PlayerStage />
        <ActionBar />
      </main>
    </div>
    <TimelinePanel />
    <FineCutOverlay />
  </div>
</template>
