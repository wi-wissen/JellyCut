<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'
import type { AutosaveStatus } from '../../core/io/autosave'
import { useMediaStore } from '../stores/media'
import { useCreditsStore } from '../stores/credits'
import CreditsDialog from './CreditsDialog.vue'

const DOT_CLASSES: Record<AutosaveStatus, string> = {
  idle: 'bg-[var(--jc-muted)]/40',
  dirty: 'bg-[var(--jc-muted)]',
  saving: 'bg-[var(--jc-txt)]',
  saved: 'bg-[var(--jc-wave)]',
  error: 'bg-[var(--jc-danger)]'
}

export default defineComponent({
  name: 'ProjectMenu',
  components: { Icon, CreditsDialog },
  data() {
    return { open: false }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'caps', 'fileName', 'saveStatus', 'loadError', 'dirtySinceFileSave']),
    ...mapState(useMediaStore, ['folder']),
    displayName(): string {
      return this.project.name.trim() === '' ? this.$t('project.untitled') : this.project.name
    },
    statusText(): string {
      return this.$t(`project.autosave.${this.saveStatus}`)
    },
    dotClass(): string {
      return DOT_CLASSES[this.saveStatus]
    },
    showUnsavedHint(): boolean {
      return this.fileName === null || this.dirtySinceFileSave
    },
    unsavedHint(): string {
      return this.fileName === null ? this.$t('project.neverSaved') : this.$t('project.unsaved')
    }
  },
  mounted() {
    document.addEventListener('pointerdown', this.onDocumentPointerDown)
    // Document level: focus may already have dropped to <body>, e.g. after a removed alert button.
    document.addEventListener('keydown', this.onDocumentKeydown)
  },
  beforeUnmount() {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown)
    document.removeEventListener('keydown', this.onDocumentKeydown)
  },
  methods: {
    confirmDiscard(): boolean {
      return !this.dirtySinceFileSave || window.confirm(this.$t('project.confirmDiscard'))
    },
    ...mapActions(useEditorStore, [
      'renameProject',
      'endRenameStep',
      'newProject',
      'openProject',
      'saveProject',
      'downloadProject',
      'chooseFolder',
      'dismissLoadError'
    ]),
    ...mapActions(useMediaStore, ['refreshWorkFolder', 'grantWorkFolderAccess', 'forgetWorkFolder']),
    async chooseWorkFolderItem(): Promise<void> {
      await this.chooseFolder()
      await this.refreshWorkFolder()
    },
    openCredits(): void {
      useCreditsStore().show({ returnId: 'project-menu-trigger' })
    },
    menuItems(): HTMLElement[] {
      const panel = this.$refs.panel as HTMLElement | undefined
      return Array.from(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    },
    openMenu(): void {
      this.open = true
      void this.refreshWorkFolder()
    },
    closeMenu(restoreFocus: boolean): void {
      this.open = false
      this.endRenameStep()
      if (restoreFocus) {
        void nextTick(() => (this.$refs.trigger as HTMLElement | undefined)?.focus())
      }
    },
    toggle(): void {
      if (this.open) this.closeMenu(true)
      else this.openMenu()
    },
    openAndFocusFirst(): void {
      this.openMenu()
      void nextTick(() => this.menuItems()[0]?.focus())
    },
    /** Runs a menu action; the menu closes first so focus returns to the trigger. */
    run(action: () => unknown): void {
      this.closeMenu(true)
      void action()
    },
    onRename(event: Event): void {
      this.renameProject((event.target as HTMLInputElement).value)
    },
    onDocumentKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && this.open) {
        event.preventDefault()
        this.closeMenu(true)
      }
    },
    onKeydown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement
      if (!this.open || target.getAttribute('role') !== 'menuitem') return
      const items = this.menuItems()
      const index = items.indexOf(target)
      let next: number | null = null
      if (event.key === 'ArrowDown') next = (index + 1) % items.length
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = items.length - 1
      if (next === null) return
      event.preventDefault()
      items[next]?.focus()
    },
    onDocumentPointerDown(event: PointerEvent): void {
      if (!this.open) return
      const root = this.$refs.root as HTMLElement | undefined
      if (root && !root.contains(event.target as Node)) this.closeMenu(false)
    }
  }
})
</script>

<template>
  <div ref="root" class="relative flex items-center gap-2" @keydown="onKeydown">
    <button
      id="project-menu-trigger"
      ref="trigger"
      type="button"
      class="relative flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border border-line bg-panel2 px-3 text-xs font-semibold before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
      aria-haspopup="menu"
      aria-controls="project-menu-panel"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
      @keydown.down.prevent="openAndFocusFirst"
    >
      <span class="truncate">{{ displayName }}</span>
      <Icon name="chevronDown" class="size-3.5 shrink-0" />
    </button>
    <span
      role="img"
      class="size-2.5 shrink-0 rounded-full"
      :class="dotClass"
      :aria-label="statusText"
      :title="statusText"
    />

    <div
      v-if="open"
      id="project-menu-panel"
      ref="panel"
      class="fixed inset-x-3 top-[56px] z-50 max-h-[calc(100dvh-72px)] overflow-y-auto rounded-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[300px] border border-line bg-panel p-2 shadow-xl"
    >
      <div v-if="loadError" role="alert" class="mb-2 flex items-start gap-2 rounded-lg border border-[var(--jc-danger)] bg-panel2 py-2 pl-3 pr-1 text-xs">
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ $t('project.fileError') }}</p>
          <p class="mt-0.5 break-words text-muted">{{ loadError }}</p>
        </div>
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-lg text-base hover:bg-panel"
          :aria-label="$t('project.dismiss')"
          @click="dismissLoadError"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <label for="project-name-input" class="block px-2.5 pt-1 text-xs font-semibold text-muted">
        {{ $t('project.name') }}
      </label>
      <input
        id="project-name-input"
        type="text"
        maxlength="60"
        class="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"
        :value="project.name"
        @input="onRename"
        @change="endRenameStep"
      />

      <div role="menu" :aria-label="$t('project.menu')" class="mt-2 border-t border-line pt-1">
        <button type="button" role="menuitem" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-fg hover:bg-panel2 focus-visible:bg-panel2" @click="run(() => confirmDiscard() && newProject($t('project.newName')))">
          <Icon name="filePlus" class="size-4 shrink-0 text-muted" />
          {{ $t('project.new') }}
        </button>
        <button type="button" role="menuitem" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-fg hover:bg-panel2 focus-visible:bg-panel2" @click="run(() => confirmDiscard() && openProject())">
          <Icon name="folderOpen" class="size-4 shrink-0 text-muted" />
          {{ $t('project.open') }}
        </button>
        <button type="button" role="menuitem" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-fg hover:bg-panel2 focus-visible:bg-panel2" @click="run(() => saveProject())">
          <Icon name="save" class="size-4 shrink-0 text-muted" />
          {{ $t('project.save') }}
        </button>
        <button type="button" role="menuitem" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-fg hover:bg-panel2 focus-visible:bg-panel2" @click="run(() => downloadProject())">
          <Icon name="download" class="size-4 shrink-0 text-muted" />
          {{ $t('project.download') }}
        </button>
        <button type="button" role="menuitem" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-fg hover:bg-panel2 focus-visible:bg-panel2" @click="run(() => openCredits())">
          <Icon name="copy" class="size-4 shrink-0 text-muted" />
          {{ $t('credits.menuItem') }}
        </button>
        <button
          v-if="caps.directoryPicker"
          type="button"
          role="menuitem"
          class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-fg hover:bg-panel2 focus-visible:bg-panel2"
          @click="run(() => chooseWorkFolderItem())"
        >
          <Icon name="folderOpen" class="size-4 shrink-0 text-muted" />
          {{ $t('project.chooseFolder') }}
        </button>
        <template v-if="caps.directoryPicker && folder">
          <button
            v-if="folder.permission !== 'granted'"
            type="button"
            role="menuitem"
            class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm font-semibold text-txt hover:bg-panel2 focus-visible:bg-panel2"
            @click="run(() => grantWorkFolderAccess())"
          >
            <Icon name="folderOpen" class="size-4 shrink-0" />
            {{ $t('relink.folder.grant') }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-fg hover:bg-panel2 focus-visible:bg-panel2"
            @click="run(() => forgetWorkFolder())"
          >
            <Icon name="trash" class="size-4 shrink-0 text-muted" />
            {{ $t('relink.folder.forget') }}
          </button>
        </template>
      </div>
      <div v-if="caps.directoryPicker" class="px-2.5 pb-1 text-xs text-muted">
        <p>{{ folder ? $t('project.folderCurrent', { name: folder.name }) : $t('project.folderNone') }}</p>
        <p v-if="folder && folder.permission !== 'granted'">{{ $t('relink.folder.needsAccess') }}</p>
      </div>
      <p v-else class="mt-2 border-t border-line px-2.5 pt-2 text-xs text-muted">
        {{ $t('project.browserInfo') }}
      </p>

      <div class="mt-2 border-t border-line px-2.5 pt-2 text-xs">
        <p class="font-semibold">{{ statusText }}</p>
        <p v-if="showUnsavedHint" class="mt-0.5 text-muted">{{ unsavedHint }}</p>
      </div>
    </div>

    <!-- Mounted here because the top bar is always present; it opens for the menu item and the library tiles. -->
    <CreditsDialog />
  </div>
</template>
