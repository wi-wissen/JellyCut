<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore, type GroupId, type TabId } from '../stores/editor'

interface TabDef {
  id: TabId
  icon: string
  soon?: boolean
}

interface GroupDef {
  key: GroupId
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
      { id: 'sticker', icon: 'sticker' },
      { id: 'draw', icon: 'draw' },
      { id: 'captions', icon: 'captions', soon: true }
    ]
  },
  {
    key: 'look',
    tabs: [
      { id: 'filter', icon: 'filter' },
      { id: 'transitions', icon: 'transition' }
    ]
  }
]

export default defineComponent({
  name: 'TabBar',
  components: { Icon },
  props: {
    /** Narrow layouts only: whether the panel above the tab bar is shown. */
    sheetOpen: { type: Boolean, default: true }
  },
  emits: ['toggle-sheet', 'tab-picked'],
  data() {
    return { groups: GROUPS }
  },
  computed: {
    ...mapState(useEditorStore, ['activeTab', 'activeGroup']),
    currentGroup(): GroupDef {
      return GROUPS.find((g) => g.key === this.activeGroup) ?? GROUPS[0]!
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['setActiveTab', 'setActiveGroup', 'select']),
    /** Opening another tab leaves the selected item's panel. Transitions and filters keep the selection: it is the target. */
    leaveSelection(tab: TabId) {
      if (tab !== 'transitions' && tab !== 'filter') this.select(null)
    },
    selectGroup(group: GroupDef) {
      const first = group.tabs.find((t) => !t.soon)?.id ?? group.tabs[0]!.id
      this.leaveSelection(first)
      this.setActiveGroup(group.key, first)
      this.$emit('tab-picked')
    },
    selectTab(tab: TabDef) {
      if (tab.soon) return
      this.leaveSelection(tab.id)
      this.setActiveTab(tab.id)
      this.$emit('tab-picked')
    }
  }
})
</script>

<template>
  <nav class="jc-tabbar flex flex-col gap-2 border-b border-line px-3 py-2.5">
    <div class="jc-tabbar__groups flex items-center gap-2">
      <div class="flex flex-1 rounded-lg bg-panel2 p-[3px]" role="tablist" :aria-label="$t('groups.label')">
        <button
          v-for="group in groups"
          :key="group.key"
          type="button"
          role="tab"
          class="h-[34px] min-w-0 flex-1 truncate rounded-md px-2 text-xs font-semibold transition-colors"
          :class="activeGroup === group.key ? 'bg-fill text-fill-fg' : 'text-fg hover:bg-panel'"
          :aria-selected="activeGroup === group.key"
          @click="selectGroup(group)"
        >
          {{ $t(`groups.${group.key}`) }}
        </button>
      </div>
      <button
        type="button"
        class="jc-tabbar__toggle"
        :aria-expanded="sheetOpen ? 'true' : 'false'"
        @click="$emit('toggle-sheet')"
      >
        {{ sheetOpen ? $t('responsive.hideTools') : $t('responsive.showTools') }}
      </button>
    </div>
    <div class="jc-tabbar__tabs flex gap-1">
      <button
        v-for="tab in currentGroup.tabs"
        :key="tab.id"
        type="button"
        class="flex h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-semibold transition-colors"
        :class="[
          activeTab === tab.id ? 'bg-panel2 text-txt ring-1 ring-fill' : 'text-fg hover:bg-panel2',
          tab.soon ? 'opacity-45' : ''
        ]"
        :disabled="tab.soon"
        :aria-pressed="activeTab === tab.id"
        @click="selectTab(tab)"
      >
        <Icon :name="tab.icon" class="size-4 shrink-0" />
        <span class="max-w-full truncate">{{ $t(`tabs.${tab.id}`) }}</span>
      </button>
    </div>
  </nav>
</template>
