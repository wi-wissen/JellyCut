<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore, type TabId } from '../stores/editor'

interface TabDef {
  id: TabId
  icon: string
  soon?: boolean
}

interface GroupDef {
  key: 'material' | 'design' | 'look'
  tabs: TabDef[]
}

const GROUPS: GroupDef[] = [
  {
    key: 'material',
    tabs: [
      { id: 'media', icon: 'media' },
      { id: 'audio', icon: 'audio' },
      { id: 'record', icon: 'record' }
    ]
  },
  {
    key: 'design',
    tabs: [
      { id: 'text', icon: 'text' },
      { id: 'sticker', icon: 'sticker', soon: true },
      { id: 'draw', icon: 'draw', soon: true },
      { id: 'captions', icon: 'captions', soon: true }
    ]
  },
  {
    key: 'look',
    tabs: [
      { id: 'filter', icon: 'filter', soon: true },
      { id: 'transitions', icon: 'transition' }
    ]
  }
]

export default defineComponent({
  name: 'TabBar',
  components: { Icon },
  data() {
    return { groups: GROUPS }
  },
  computed: {
    ...mapState(useEditorStore, ['activeTab'])
  },
  methods: {
    ...mapActions(useEditorStore, ['setActiveTab'])
  }
})
</script>

<template>
  <nav class="flex flex-col gap-1 border-b border-line px-3 py-2">
    <div v-for="group in groups" :key="group.key">
      <h3 class="mb-0.5 text-[10px] font-semibold uppercase tracking-[.12em] text-muted">
        {{ $t(`groups.${group.key}`) }}
      </h3>
      <div class="flex gap-1">
        <button
          v-for="tab in group.tabs"
          :key="tab.id"
          type="button"
          class="flex h-[34px] min-w-0 flex-auto items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold transition-colors"
          :class="[
            activeTab === tab.id ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel2',
            tab.soon ? 'opacity-45' : ''
          ]"
          :disabled="tab.soon"
          :aria-pressed="activeTab === tab.id"
          @click="setActiveTab(tab.id)"
        >
          <Icon :name="tab.icon" class="size-3.5 shrink-0" />
          <span class="truncate">{{ $t(`tabs.${tab.id}`) }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>
