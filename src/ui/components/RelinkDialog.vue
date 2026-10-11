<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { useMediaStore, type LinkBasis } from '../stores/media'
import { formatBytes, formatClock } from '../../core/export/format'
import type { Asset } from '../../core/project/types'

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const TITLE_ID = 'relink-dialog-title'

type RowState = 'matched' | 'choose' | 'rejected' | 'notFound'

const BASIS_KEYS: Record<LinkBasis, string> = {
  'name-size': 'relink.status.matchedName',
  'size-duration': 'relink.status.matchedLength',
  path: 'relink.status.matchedPath',
  manual: 'relink.status.matchedManual'
}

export default defineComponent({
  name: 'RelinkDialog',
  data() {
    return { dragDepth: 0, titleId: TITLE_ID }
  },
  computed: {
    ...mapState(useMediaStore, [
      'relinkOpen',
      'relinkListIds',
      'relinkPlan',
      'relinkLabels',
      'relinkChoices',
      'relinkReasons',
      'relinkRejected',
      'relinkBusy',
      'relinkScanned',
      'relinkNotice',
      'missingCount',
      'status',
      'pendingRemoval'
    ]),
    ...mapState(useEditorStore, ['project', 'caps']),
    locale(): string {
      return this.$i18n.locale
    },
    listed(): Asset[] {
      const ids = new Set(this.relinkListIds)
      return this.project.assets.filter((a) => ids.has(a.id))
    },
    counts(): { matched: number; choose: number; notFound: number } {
      let matched = 0
      let choose = 0
      let notFound = 0
      for (const asset of this.listed) {
        const state = this.rowState(asset)
        if (state === 'matched') matched++
        else if (state === 'choose') choose++
        else notFound++
      }
      return { matched, choose, notFound }
    },
    allLinked(): boolean {
      return this.listed.length > 0 && this.listed.every((a) => this.rowState(a) === 'matched')
    },
    dragging(): boolean {
      return this.dragDepth > 0
    },
    scanningText(): string {
      return this.$t('relink.scanning', { count: this.relinkScanned ?? 0 })
    },
    noticeText(): string {
      return this.relinkNotice ? this.$t(this.relinkNotice) : ''
    },
    summaryText(): string {
      return this.$t('relink.summary', {
        matched: this.counts.matched,
        choose: this.counts.choose,
        notFound: this.counts.notFound
      })
    }
  },
  watch: {
    relinkOpen(isOpen: boolean) {
      if (isOpen) {
        void nextTick(() => this.focusInside(true))
      } else {
        this.dragDepth = 0
      }
    }
  },
  mounted() {
    // Capture phase: while the dialog is open, editor shortcuts (Space, Ctrl+Z) must not see its keys.
    window.addEventListener('keydown', this.onWindowKeydown, true)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onWindowKeydown, true)
  },
  methods: {
    ...mapActions(useMediaStore, [
      'closeRelinkDialog',
      'pickFiles',
      'chooseFolderForRelink',
      'relinkFiles',
      'chooseCandidate',
      'applyChoices',
      'requestRemoval'
    ]),
    panel(): HTMLElement | null {
      return (this.$refs.panel as HTMLElement | undefined) ?? null
    },
    focusables(): HTMLElement[] {
      return Array.from(this.panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    },
    focusInside(initial: boolean): void {
      const panel = this.panel()
      if (!panel) return
      if (!initial && panel.contains(document.activeElement)) return
      const target = this.focusables()[0] ?? panel
      target.focus()
    },
    rowState(asset: Asset): RowState {
      if (this.status[asset.id] === 'ready') return 'matched'
      if (this.relinkRejected[asset.id]) return 'rejected'
      if (this.relinkPlan?.ambiguous[asset.id]) return 'choose'
      return 'notFound'
    },
    basisText(asset: Asset): string {
      const basis = this.relinkReasons[asset.id]
      return basis ? this.$t(BASIS_KEYS[basis]) : ''
    },
    rejectedText(asset: Asset): string {
      const key = this.relinkRejected[asset.id]
      return key ? this.$t(key) : ''
    },
    candidateKeys(asset: Asset): string[] {
      return this.relinkPlan?.ambiguous[asset.id] ?? []
    },
    candidateLabel(key: string): string {
      return this.relinkLabels[key] ?? key
    },
    selectedCandidate(asset: Asset): string {
      return this.relinkChoices[asset.id] ?? ''
    },
    onChoose(asset: Asset, event: Event): void {
      const value = (event.target as HTMLSelectElement).value
      if (value) this.chooseCandidate(asset.id, value)
    },
    sizeText(asset: Asset): string {
      return this.$t('relink.size', { size: formatBytes(asset.size, this.locale) })
    },
    lengthText(asset: Asset): string {
      return asset.kind === 'image' ? '' : this.$t('relink.length', { duration: formatClock(asset.duration) })
    },
    hasFiles(event: DragEvent): boolean {
      return Array.from(event.dataTransfer?.types ?? []).includes('Files')
    },
    onDragEnter(event: DragEvent): void {
      if (this.hasFiles(event)) this.dragDepth++
    },
    onDragLeave(): void {
      this.dragDepth = Math.max(0, this.dragDepth - 1)
    },
    onDrop(event: DragEvent): void {
      this.dragDepth = 0
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) void this.relinkFiles(files)
    },
    async onApply(): Promise<void> {
      await this.applyChoices()
      if (this.missingCount === 0) this.closeRelinkDialog()
    },
    onBackdropClick(): void {
      if (!this.relinkBusy) this.closeRelinkDialog()
    },
    onWindowKeydown(event: KeyboardEvent): void {
      // A pending removal confirmation sits on top and takes the keys first.
      if (!this.relinkOpen || this.pendingRemoval) return
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!this.relinkBusy) this.closeRelinkDialog()
        return
      }
      if (event.key !== 'Tab') return
      const items = this.focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (!this.panel()?.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="relinkOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      @click.self="onBackdropClick"
    >
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-busy="relinkBusy ? 'true' : 'false'"
        class="flex max-h-[calc(100dvh-24px)] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <h2 :id="titleId" class="border-b border-line px-5 py-4 text-base font-bold">{{ $t('relink.title') }}</h2>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p class="text-sm text-muted">{{ $t('relink.intro') }}</p>

          <p v-if="relinkBusy" role="status" class="mt-3 flex items-center gap-2 text-sm">
            <span class="size-2 animate-pulse rounded-full bg-fill" aria-hidden="true" />
            <span v-if="relinkScanned !== null">{{ scanningText }}</span>
            <span v-else>{{ $t('library.importing') }}</span>
          </p>

          <p v-if="noticeText" role="alert" class="mt-3 rounded-lg bg-panel2 px-3 py-2 text-sm">{{ noticeText }}</p>

          <ul class="mt-4 flex flex-col gap-2" :aria-label="$t('relink.title')">
            <li
              v-for="asset in listed"
              :key="asset.id"
              class="rounded-xl border border-line bg-panel2 p-3"
              :data-relink-state="rowState(asset)"
            >
              <div class="flex items-start gap-3">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold">{{ asset.name }}</span>
                  <span class="mt-0.5 block text-xs text-muted">
                    {{ sizeText(asset) }}<span v-if="lengthText(asset)"> · {{ lengthText(asset) }}</span>
                  </span>
                </span>
                <span
                  v-if="rowState(asset) === 'matched'"
                  class="shrink-0 rounded-full bg-[var(--jc-wave)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--jc-wave)]"
                >
                  {{ $t('relink.status.matched') }}
                </span>
                <span
                  v-else-if="rowState(asset) === 'notFound'"
                  class="shrink-0 rounded-full bg-panel px-2 py-0.5 text-xs font-semibold text-muted"
                >
                  {{ $t('relink.status.notFound') }}
                </span>
                <button
                  v-if="rowState(asset) !== 'matched'"
                  type="button"
                  class="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-[var(--jc-danger)] hover:bg-panel"
                  :aria-label="$t('relink.removeLabel', { name: asset.name })"
                  @click="requestRemoval(asset.id)"
                >
                  {{ $t('relink.remove') }}
                </button>
              </div>

              <p v-if="rowState(asset) === 'matched' && basisText(asset)" class="mt-1.5 text-xs text-muted">{{ basisText(asset) }}</p>

              <p v-if="rowState(asset) === 'rejected'" role="alert" class="mt-2 text-xs font-semibold text-[var(--jc-danger)]">
                {{ rejectedText(asset) }}
              </p>

              <div v-if="rowState(asset) === 'choose'" class="mt-2">
                <label class="block text-xs font-semibold text-muted" :for="`relink-choice-${asset.id}`">
                  {{ $t('relink.status.choose') }}
                </label>
                <select
                  :id="`relink-choice-${asset.id}`"
                  class="mt-1 min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm"
                  :aria-label="$t('relink.status.chooseLabel', { name: asset.name })"
                  :value="selectedCandidate(asset)"
                  @change="onChoose(asset, $event)"
                >
                  <option value="">{{ $t('relink.status.none') }}</option>
                  <option v-for="key in candidateKeys(asset)" :key="key" :value="key">{{ candidateLabel(key) }}</option>
                </select>
              </div>
            </li>
          </ul>

          <p v-if="listed.length === 0" class="mt-4 text-sm text-muted">{{ $t('relink.allLinked') }}</p>
          <p v-else-if="allLinked" class="mt-4 text-sm font-semibold">{{ $t('relink.allLinked') }}</p>
          <p v-else class="mt-4 text-xs text-muted">{{ summaryText }}</p>

          <div
            v-if="dragging"
            class="pointer-events-none mt-4 flex min-h-20 items-center justify-center rounded-xl border-2 border-dashed border-fill text-sm font-semibold"
          >
            {{ $t('relink.dropHint') }}
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            class="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold hover:bg-panel2"
            :disabled="relinkBusy"
            @click="pickFiles"
          >
            {{ $t('relink.selectFiles') }}
          </button>
          <button
            v-if="caps.directoryPicker"
            type="button"
            class="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold hover:bg-panel2"
            :disabled="relinkBusy"
            @click="chooseFolderForRelink"
          >
            {{ $t('relink.chooseFolder') }}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-lg bg-fill px-4 text-sm font-semibold text-fill-fg disabled:opacity-50"
            :disabled="relinkBusy"
            @click="onApply"
          >
            {{ $t('relink.apply') }}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-lg px-4 text-sm font-semibold text-txt hover:bg-panel2"
            :disabled="relinkBusy"
            @click="closeRelinkDialog"
          >
            {{ $t('relink.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
