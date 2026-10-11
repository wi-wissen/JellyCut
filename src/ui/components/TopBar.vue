<script lang="ts">
import logoUrl from '../../assets/logo.svg'
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import ProjectMenu from './ProjectMenu.vue'
import ExportDialog from './ExportDialog.vue'
import RelinkDialog from './RelinkDialog.vue'
import RemoveAssetConfirm from './RemoveAssetConfirm.vue'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'

export default defineComponent({
  name: 'TopBar',
  components: { Icon, ProjectMenu, ExportDialog, RelinkDialog, RemoveAssetConfirm },
  data() {
    return { logoUrl, moreOpen: false }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'resolvedDark', 'canUndo', 'canRedo'])
  },
  mounted() {
    document.addEventListener('pointerdown', this.onDocumentPointerDown)
    document.addEventListener('keydown', this.onDocumentKeydown)
  },
  beforeUnmount() {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown)
    document.removeEventListener('keydown', this.onDocumentKeydown)
  },
  methods: {
    ...mapActions(useEditorStore, ['toggleTheme', 'undo', 'redo']),
    ...mapActions(useExportStore, ['show']),
    /** Phone layout: the overflow menu closes before its action runs. */
    runFromMore(action: () => void): void {
      this.moreOpen = false
      action()
    },
    onDocumentPointerDown(event: PointerEvent): void {
      const wrap = this.$refs.more as HTMLElement | undefined
      if (this.moreOpen && wrap && !wrap.contains(event.target as Node)) this.moreOpen = false
    },
    onDocumentKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && this.moreOpen) this.moreOpen = false
    }
  }
})
</script>

<template>
  <header class="jc-topbar flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line bg-panel px-3">
    <div class="flex items-center gap-2 pr-1">
      <img :src="logoUrl" alt="" class="size-8" />
      <span class="jc-brand-name text-[15px] font-bold tracking-tight">{{ $t('app.name') }}</span>
    </div>

    <ProjectMenu />
    <div class="jc-topbar__inline ml-1 flex items-center">
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

    <div ref="more" class="jc-topbar__more-wrap relative items-center">
      <button
        type="button"
        class="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-fg hover:bg-panel2"
        aria-controls="topbar-more"
        :aria-expanded="moreOpen ? 'true' : 'false'"
        @click="moreOpen = !moreOpen"
      >
        {{ $t('responsive.more') }}
      </button>
      <div
        v-if="moreOpen"
        id="topbar-more"
        :aria-label="$t('responsive.moreActions')"
        class="absolute right-0 top-full z-50 mt-1 flex w-56 flex-col gap-0.5 rounded-xl border border-line bg-panel p-1.5 shadow-xl"
      >
        <button
          type="button"
          class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold text-fg hover:bg-panel2 disabled:opacity-40"
          :disabled="!canUndo"
          @click="runFromMore(undo)"
        >
          <Icon name="undo" class="size-5" />
          {{ $t('top.undo') }}
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold text-fg hover:bg-panel2 disabled:opacity-40"
          :disabled="!canRedo"
          @click="runFromMore(redo)"
        >
          <Icon name="redo" class="size-5" />
          {{ $t('top.redo') }}
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold text-fg hover:bg-panel2"
          @click="runFromMore(toggleTheme)"
        >
          <Icon :name="resolvedDark ? 'sun' : 'moon'" class="size-5" />
          {{ resolvedDark ? $t('top.lightMode') : $t('top.darkMode') }}
        </button>
      </div>
    </div>

    <button
      type="button"
      class="jc-topbar__inline flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
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
    <RelinkDialog />
    <RemoveAssetConfirm />
  </header>
</template>
