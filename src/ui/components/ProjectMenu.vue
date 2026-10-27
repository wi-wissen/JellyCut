<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'
import { useMediaStore } from '../stores/media'
import { useCreditsStore } from '../stores/credits'
import CreditsDialog from './CreditsDialog.vue'
import { formatBytes } from '../../core/export/format'

type SaveTone = 'green' | 'amber' | 'red' | 'neutral'
type SaveKey = 'error' | 'saving' | 'dirty' | 'fileChanged' | 'neverFile' | 'savedFile' | 'savedBrowser' | 'demo'

/** Edits this long without a file save get the amber "Not saved as a file yet" state. */
const NEVER_FILE_HINT_MS = 10 * 60 * 1000
const CLOCK_TICK_MS = 30 * 1000

const TONE_CLASSES: Record<SaveTone, string> = {
  green: 'bg-[var(--jc-wave)]',
  amber: 'bg-[var(--jc-warn)]',
  red: 'bg-[var(--jc-danger)]',
  neutral: 'bg-[var(--jc-muted)]'
}

export default defineComponent({
  name: 'ProjectMenu',
  components: { Icon, CreditsDialog },
  data() {
    return { open: false, now: Date.now(), clock: 0, version: __APP_VERSION__ }
  },
  computed: {
    ...mapState(useEditorStore, [
      'project',
      'caps',
      'fileName',
      'saveStatus',
      'autosaveError',
      'demo',
      'loadError',
      'dirtySinceFileSave',
      'unsavedSince'
    ]),
    ...mapState(useMediaStore, ['folder', 'storedBytes', 'storedAssetCount', 'persistence']),
    displayName(): string {
      return this.project.name.trim() === '' ? this.$t('project.untitled') : this.project.name
    },
    /** What the dot tells: where the work is kept and whether it is the same as the file. */
    saveState(): { key: SaveKey; tone: SaveTone } {
      if (this.demo) return { key: 'demo', tone: 'neutral' }
      if (this.saveStatus === 'error') return { key: 'error', tone: 'red' }
      if (this.saveStatus === 'saving') return { key: 'saving', tone: 'neutral' }
      if (this.saveStatus === 'dirty') return { key: 'dirty', tone: 'amber' }
      if (this.dirtySinceFileSave) {
        if (this.fileName !== null) return { key: 'fileChanged', tone: 'amber' }
        // The periodic tick (this.now) re-runs this computed; the clock itself is read here.
        if (this.unsavedSince !== null && this.now >= 0 && Date.now() - this.unsavedSince >= NEVER_FILE_HINT_MS) {
          return { key: 'neverFile', tone: 'amber' }
        }
      }
      return this.fileName !== null ? { key: 'savedFile', tone: 'green' } : { key: 'savedBrowser', tone: 'green' }
    },
    saveStateText(): string {
      return this.$t(`polish.save.${this.saveState.key}`)
    },
    saveStateLabel(): string {
      return this.$t('polish.save.label', { state: this.saveStateText })
    },
    saveStateHint(): string {
      if (this.saveState.key === 'error') return this.$t('polish.save.errorHint', { message: this.autosaveError ?? '' })
      if (this.saveState.key === 'neverFile') return this.$t('polish.save.neverFileHint')
      return ''
    },
    dotClass(): string {
      return TONE_CLASSES[this.saveState.tone]
    },
    isSavedTone(): boolean {
      return this.saveState.tone === 'green'
    }
  },
  mounted() {
    document.addEventListener('pointerdown', this.onDocumentPointerDown)
    // Document level: focus may already have dropped to <body>, e.g. after a removed alert button.
    document.addEventListener('keydown', this.onDocumentKeydown)
    // Keeps the "not saved as a file yet" state current while the user works.
    this.clock = window.setInterval(() => {
      this.now = Date.now()
    }, CLOCK_TICK_MS)
  },
  beforeUnmount() {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown)
    document.removeEventListener('keydown', this.onDocumentKeydown)
    window.clearInterval(this.clock)
  },
  methods: {
    /** Recordings live only in this browser, so leaving the project asks even when it was saved as a file. */
    confirmDiscard(): boolean {
      if (this.storedAssetCount > 0) return window.confirm(this.$t('project.confirmDiscardRecordings'))
      return !this.dirtySinceFileSave || window.confirm(this.$t('project.confirmDiscard'))
    },
    storedMediaText(): string {
      return this.$t('project.storedMedia', { size: formatBytes(this.storedBytes, this.$i18n.locale) })
    },
    storedMediaTitle(): string {
      const state = this.persistence === 'granted' ? this.$t('project.storagePersistent') : this.$t('project.storageNotPersistent')
      return `${this.$t('project.storedMediaHint')} ${state}`
    },
    ...mapActions(useEditorStore, [
      'renameProject',
      'endRenameStep',
      'newProject',
      'openProject',
      'saveProject',
      'downloadProject',
      'dismissLoadError'
    ]),
    ...mapActions(useMediaStore, ['refreshWorkFolder', 'grantWorkFolderAccess', 'forgetWorkFolder', 'openWorkFolder']),
    async openFolderItem(): Promise<void> {
      await this.openWorkFolder()
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
      data-role="save-state"
      :data-tone="saveState.tone"
      class="flex size-[18px] shrink-0 items-center justify-center rounded-full text-white"
      :class="dotClass"
      :aria-label="saveStateLabel"
      :title="saveStateLabel"
    >
      <svg v-if="isSavedTone" viewBox="0 0 12 12" class="size-2.5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 6.2 5 8.5 9.5 3.5" />
      </svg>
      <span v-else-if="saveState.tone === 'red'" class="text-[11px] font-bold leading-none" aria-hidden="true">!</span>
      <span v-else class="size-1.5 rounded-full bg-white" aria-hidden="true" />
    </span>

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
          @click="run(() => confirmDiscard() && openFolderItem())"
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

      <div class="mt-2 border-t border-line px-2.5 pt-2 text-xs" data-role="save-state-panel">
        <p class="font-semibold">{{ saveStateText }}</p>
        <p v-if="saveStateHint" class="mt-0.5 text-muted">{{ saveStateHint }}</p>
      </div>
      <p v-if="storedBytes > 0" class="px-2.5 pt-2 text-[11px] text-muted" data-role="stored-media" :title="storedMediaTitle()">{{ storedMediaText() }}</p>
      <p class="px-2.5 pt-2 text-[11px] tabular-nums text-muted" data-role="app-version" :title="`Build ${version}`">{{ $t('site.version', { id: version }) }}</p>
    </div>

    <!-- Mounted here because the top bar is always present; it opens for the menu item and the library tiles. -->
    <CreditsDialog />
  </div>
</template>
