<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import ProjectMenu from './ProjectMenu.vue'
import ExportDialog from './ExportDialog.vue'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'

export default defineComponent({
  name: 'TopBar',
  components: { Icon, ProjectMenu, ExportDialog },
  data() {
    return { logoUrl: `${import.meta.env.BASE_URL}logo.svg` }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'resolvedDark', 'canUndo', 'canRedo'])
  },
  methods: {
    ...mapActions(useEditorStore, ['toggleTheme', 'undo', 'redo']),
    ...mapActions(useExportStore, ['show'])
  }
})
</script>

<template>
  <header class="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line bg-panel px-3">
    <div class="flex items-center gap-2 pr-1">
      <span
        class="flex size-8 items-center justify-center rounded-lg border"
        style="background: var(--jc-logo-tile); border-color: var(--jc-logo-tile-line)"
      >
        <img :src="logoUrl" alt="" class="size-6 object-contain" />
      </span>
      <span class="text-[15px] font-bold tracking-tight">{{ $t('app.name') }}</span>
    </div>

    <ProjectMenu />
    <div class="ml-1 flex items-center">
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg text-fg enabled:hover:bg-panel2 disabled:opacity-40"
        :disabled="!canUndo"
        :aria-disabled="canUndo ? 'false' : 'true'"
        :aria-label="$t('top.undo')"
        @click="undo"
      >
        <Icon name="undo" class="size-5" />
      </button>
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg text-fg enabled:hover:bg-panel2 disabled:opacity-40"
        :disabled="!canRedo"
        :aria-disabled="canRedo ? 'false' : 'true'"
        :aria-label="$t('top.redo')"
        @click="redo"
      >
        <Icon name="redo" class="size-5" />
      </button>
    </div>

    <div class="flex-1" />

    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
      :aria-label="resolvedDark ? $t('top.lightMode') : $t('top.darkMode')"
      @click="toggleTheme"
    >
      <Icon :name="resolvedDark ? 'sun' : 'moon'" class="size-5" />
    </button>
    <button
      id="export-button"
      type="button"
      class="flex h-9 items-center rounded-lg bg-signal px-4 text-sm font-bold text-signal-fg"
      aria-haspopup="dialog"
      @click="show"
    >
      {{ $t('top.export') }}
    </button>
    <ExportDialog />
  </header>
</template>
