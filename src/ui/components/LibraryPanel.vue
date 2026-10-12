<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import type { Asset, AssetKind } from '../../core/project/types'
import { missingKind } from '../../core/io/storedMedia'
import { useEditorStore } from '../stores/editor'
import { useMediaStore } from '../stores/media'
import { useCreditsStore } from '../stores/credits'
import { useExampleVideoStore } from '../stores/exampleVideo'

const GRADIENTS = [
  'linear-gradient(135deg, var(--jc-track-video-1), var(--jc-fill))',
  'linear-gradient(135deg, var(--jc-track-video-2), var(--jc-track-video-3))',
  'linear-gradient(135deg, var(--jc-wave), var(--jc-track-video-1))'
]

const ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov'

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function formatDuration(micros: number): string {
  const seconds = Math.round(micros / 1_000_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const ALL_KINDS: AssetKind[] = ['video', 'audio', 'image']

export default defineComponent({
  name: 'LibraryPanel',
  components: { Icon },
  props: {
    /** Only assets of these kinds are listed. */
    kinds: { type: Array as PropType<AssetKind[]>, default: () => ALL_KINDS },
    /** Heading text; the default is the media heading. */
    heading: { type: String, default: '' }
  },
  data() {
    return { dragDepth: 0 }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'caps']),
    ...mapState(useExampleVideoStore, { exampleStatus: 'status', examplePercent: 'percent', exampleError: 'errorKey' }),
    /** Nothing imported yet: the card explains how to start, and it goes away as soon as any media exists. */
    showStart(): boolean {
      return this.kinds.includes('video') && this.project.assets.length === 0
    },
    creatingExample(): boolean {
      return this.exampleStatus === 'creating'
    },
    ...mapState(useMediaStore, [
      'statusOf',
      'problems',
      'thumbnails',
      'importing',
      'lastImportError',
      'missingCount',
      'folder',
      'unusedCount',
      'removalNote',
      'storedSizes'
    ]),
    showRelinkBanner(): boolean {
      return this.missingCount > 0
    },
    canImportFromFolder(): boolean {
      return this.caps.filePicker && this.folder?.permission === 'granted'
    },
    assets(): Asset[] {
      return this.project.assets.filter((a) => this.kinds.includes(a.kind))
    },
    title(): string {
      return this.heading || this.$t('library.media')
    },
    dragging(): boolean {
      return this.dragDepth > 0
    },
    accept(): string {
      return ACCEPT
    },
    sourcesHref(): string {
      // The editor lives at /app/, the guide at /help/sources/ (real pages, see vite.config.ts).
      return '../help/sources/'
    }
  },
  methods: {
    ...mapActions(useExampleVideoStore, { createExample: 'create', abortExample: 'abort' }),
    ...mapActions(useEditorStore, ['addMediaAtPlayhead']),
    ...mapActions(useMediaStore, [
      'importFiles',
      'importFromWorkFolder',
      'addToTimeline',
      'dismissImportError',
      'pickFiles',
      'pickFileFor',
      'chooseFolderForRelink',
      'requestRemoval',
      'removeUnused',
      'undoRemoval',
      'dismissRemovalNote'
    ]),
    removalText(): string {
      const note = this.removalNote
      if (!note) return ''
      if (note.key === 'relink.removed.unused') return this.$t(note.key, Number(note.params.count))
      return this.$t(note.key, note.params)
    },
    onRelinkTile(asset: Asset): void {
      this.pickFileFor(asset.id)
    },
    openCredits(asset: Asset): void {
      useCreditsStore().show({ assetId: asset.id, returnId: `credit-button-${asset.id}` })
    },
    gradient(index: number): string {
      return GRADIENTS[index % GRADIENTS.length] ?? GRADIENTS[0] ?? ''
    },
    openPicker(): void {
      ;(this.$refs.fileInput as HTMLInputElement | undefined)?.click()
    },
    onPicked(event: Event): void {
      const input = event.target as HTMLInputElement
      const files = Array.from(input.files ?? [])
      // Clearing the value lets the user pick the same file again.
      input.value = ''
      void this.importFiles(files)
    },
    onDragEnter(event: DragEvent): void {
      if (hasFiles(event)) this.dragDepth++
    },
    onDragLeave(): void {
      this.dragDepth = Math.max(0, this.dragDepth - 1)
    },
    onDrop(event: DragEvent): void {
      this.dragDepth = 0
      void this.importFiles(Array.from(event.dataTransfer?.files ?? []))
    },
    isReady(asset: Asset): boolean {
      return this.statusOf(asset.id) === 'ready'
    },
    /** Only missing files get a Re-link button; unsupported ones cannot be fixed by picking another file. */
    isMissing(asset: Asset): boolean {
      return this.statusOf(asset.id) === 'missing'
    },
    onTile(asset: Asset): void {
      if (this.isReady(asset)) this.addToTimeline(asset.id)
    },
    tileLabel(asset: Asset): string {
      return this.isReady(asset) ? this.$t('library.addToTimeline', { name: asset.name }) : asset.name
    },
    /** Short reason shown on a tile that cannot be used. */
    problemText(asset: Asset): string {
      if (this.statusOf(asset.id) === 'missing') {
        const kind = missingKind(asset)
        return this.$t(kind === 'recording' ? 'library.problems.missingRecording' : kind === 'example' ? 'library.problems.missingExample' : 'library.problems.missing')
      }
      const first = this.problems[asset.id]?.[0]
      if (first === 'cannot-decode-video' || first === 'cannot-decode-audio') return this.$t('library.problems.cannotDecode')
      if (first === 'no-media') return this.$t('library.problems.noMedia')
      return this.$t('library.problems.unsupportedFormat')
    },
    /** Tooltip of a tile whose file is kept in this browser (recordings, example videos). */
    storedTitle(asset: Asset): string | undefined {
      return asset.storeKey && this.storedSizes[asset.storeKey] !== undefined ? this.$t('library.storedHint') : undefined
    },
    durationLabel(asset: Asset): string {
      // Images have no real length; their stored duration is only a limit.
      return asset.kind === 'image' ? '' : formatDuration(asset.duration)
    },
    thumbnailOf(asset: Asset): string | undefined {
      return this.thumbnails[asset.id]
    }
  }
})
</script>

<template>
  <section
    class="relative flex min-h-0 flex-1 flex-col gap-3 bg-panel p-3"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="flex shrink-0 items-center justify-between gap-2">
      <h2 class="text-sm font-bold">{{ title }}</h2>
      <span v-if="importing > 0" role="status" class="flex items-center gap-1.5 text-xs text-muted">
        <span class="size-2 animate-pulse rounded-full bg-fill" aria-hidden="true" />
        {{ $t('library.importing') }}
      </span>
      <button
        v-if="unusedCount > 0"
        type="button"
        class="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-txt hover:bg-panel2"
        @click="removeUnused"
      >
        {{ $t('relink.removeUnused') }}
      </button>
      <button
        v-else-if="canImportFromFolder"
        type="button"
        class="min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-txt hover:bg-panel2"
        @click="importFromWorkFolder"
      >
        {{ $t('relink.folder.importFromFolder') }}
      </button>
    </div>

    <div
      v-if="showRelinkBanner"
      role="status"
      class="flex shrink-0 flex-col gap-2 rounded-xl border border-line bg-panel2 p-3 text-xs"
    >
      <p class="font-semibold text-fg">{{ $t('relink.banner', missingCount) }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="min-h-11 rounded-lg bg-fill px-3 font-semibold text-fill-fg"
          @click="pickFiles"
        >
          {{ $t('relink.selectFiles') }}
        </button>
        <button
          v-if="caps.directoryPicker"
          type="button"
          class="min-h-11 rounded-lg border border-line px-3 font-semibold text-fg hover:bg-panel"
          @click="chooseFolderForRelink"
        >
          {{ $t('relink.chooseFolder') }}
        </button>
      </div>
    </div>

    <div v-if="removalNote" role="status" class="flex shrink-0 items-center gap-2 rounded-lg bg-panel2 p-2 text-xs text-fg">
      <span class="min-w-0 flex-1">{{ removalText() }}</span>
      <button type="button" class="min-h-11 shrink-0 rounded-lg px-2 font-bold text-txt hover:bg-panel" @click="undoRemoval">
        {{ $t('relink.undo') }}
      </button>
      <button
        type="button"
        class="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg font-bold hover:bg-panel"
        :aria-label="$t('project.dismiss')"
        @click="dismissRemovalNote"
      >
        ×
      </button>
    </div>

    <input ref="fileInput" type="file" multiple :accept="accept" class="hidden" :aria-label="$t('a11y.fileInput')" @change="onPicked" />

    <div class="min-h-0 flex-1 overflow-y-auto" :class="dragging ? 'rounded-lg outline-2 outline-dashed outline-fill -outline-offset-4' : ''">
      <div v-if="showStart" class="mt-4 flex flex-col items-center gap-4 rounded-xl border border-line bg-panel2 px-5 py-8 text-center">
        <span class="flex size-14 items-center justify-center rounded-full bg-fill text-fill-fg" aria-hidden="true">
          <Icon name="camera" class="size-7" />
        </span>
        <div class="flex flex-col gap-1.5">
          <h3 class="text-base font-bold text-fg">{{ $t('start.title') }}</h3>
          <p class="text-xs leading-relaxed text-muted">{{ $t('start.text') }}</p>
        </div>
        <button
          type="button"
          class="min-h-11 w-full rounded-lg bg-fill px-4 text-sm font-bold text-fill-fg"
          @click="openPicker"
        >
          {{ $t('library.addMedia') }}
        </button>
        <p class="text-[11px] text-muted">{{ $t('start.filesStay') }}</p>
        <div class="h-px w-full bg-line" aria-hidden="true" />
        <button
          type="button"
          class="min-h-11 w-full rounded-lg border border-line px-4 text-sm font-semibold text-fg hover:bg-panel disabled:opacity-60"
          :disabled="creatingExample"
          @click="createExample"
        >
          {{ creatingExample ? $t('start.creating', { percent: examplePercent }) : $t('start.createExample') }}
        </button>
        <div v-if="creatingExample" class="flex w-full items-center gap-2">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-panel" role="progressbar" :aria-valuenow="examplePercent" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full bg-fill transition-[width]" :style="{ width: `${examplePercent}%` }" />
          </div>
          <button type="button" class="min-h-11 shrink-0 px-2 text-xs font-semibold text-txt underline underline-offset-2" @click="abortExample">
            {{ $t('start.abort') }}
          </button>
        </div>
        <p v-if="exampleError" role="alert" class="text-xs text-fg">{{ $t(exampleError) }}</p>
      </div>

      <div v-else class="grid grid-cols-2 gap-2.5">
        <div v-for="(asset, index) in assets" :key="asset.id" class="relative">
          <button
            type="button"
            class="group relative block aspect-[16/10] w-full overflow-hidden rounded-lg text-left"
            :class="isReady(asset) ? '' : 'cursor-default'"
            :style="{ background: gradient(index) }"
            :aria-label="tileLabel(asset)"
            :title="storedTitle(asset)"
            :aria-disabled="isReady(asset) ? undefined : 'true'"
            @click="onTile(asset)"
          >
            <img
              v-if="thumbnailOf(asset)"
              :src="thumbnailOf(asset)"
              alt=""
              class="absolute inset-0 size-full object-cover"
            />
            <span v-if="asset.kind === 'audio'" class="absolute inset-0 flex items-center justify-center text-white">
              <Icon name="audio" class="size-8" />
            </span>

            <span
              v-if="!isReady(asset)"
              class="absolute inset-0 flex items-start justify-center gap-1 bg-panel2 pl-2.5 pr-12 pt-5 text-center text-[10px] font-semibold leading-tight text-fg"
            >
              <svg viewBox="0 0 24 24" class="mt-px size-3.5 shrink-0 text-[var(--jc-danger)]" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span>{{ problemText(asset) }}</span>
            </span>

            <span
              v-if="isReady(asset)"
              class="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-fill text-fill-fg shadow"
              aria-hidden="true"
            >
              <Icon name="plus" class="size-3.5" />
            </span>
            <span
              v-if="isReady(asset)"
              class="jc-tile__add absolute inset-0 flex items-center justify-center bg-black/35 text-sm font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            >
              {{ $t('library.add') }}
            </span>

            <span v-if="durationLabel(asset)" class="absolute right-12 top-2 rounded bg-black/60 px-1 font-mono text-[10px] text-white">
              {{ durationLabel(asset) }}
            </span>
            <span class="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
              {{ asset.name }}
            </span>
          </button>

          <button
            :id="`credit-button-${asset.id}`"
            type="button"
            class="relative mt-1 flex min-h-7 items-center rounded-md px-1.5 text-[11px] font-semibold text-txt hover:bg-panel2 before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
            :aria-label="$t('credits.tileLabel', { name: asset.name })"
            @click="openCredits(asset)"
          >
            {{ $t('credits.tile') }}
          </button>

          <button
            v-if="asset.kind !== 'audio' && isReady(asset)"
            type="button"
            class="relative mt-1 flex min-h-7 items-center rounded-md px-1.5 text-[11px] font-semibold text-txt hover:bg-panel2 before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
            :aria-label="$t('library.asPictureOf', { name: asset.name })"
            @click="addMediaAtPlayhead(asset.id)"
          >
            {{ $t('library.asPicture') }}
          </button>

          <button
            type="button"
            class="absolute right-1 top-1 z-10 flex size-11 items-center justify-center rounded-lg text-white"
            :aria-label="$t('relink.removeLabel', { name: asset.name })"
            @click="requestRemoval(asset.id)"
          >
            <span class="flex size-7 items-center justify-center rounded-full bg-black/60 shadow">
              <Icon name="trash" class="size-4" />
            </span>
          </button>

          <button
            v-if="isMissing(asset)"
            type="button"
            class="absolute bottom-8 left-1/2 z-10 min-h-7 -translate-x-1/2 whitespace-nowrap rounded-lg bg-fill px-3 text-[11px] font-bold text-fill-fg before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
            :title="$t('relink.tileLabel', { name: asset.name })"
            @click="onRelinkTile(asset)"
          >
            {{ $t('relink.tileButton') }}
          </button>
        </div>

        <button
          type="button"
          class="flex aspect-[16/10] items-center justify-center rounded-lg border-2 border-dashed border-line text-muted hover:border-fill hover:text-fg"
          :aria-label="$t('library.addMedia')"
          @click="openPicker"
        >
          <Icon name="plus" class="size-6" />
        </button>
      </div>

      <p v-if="assets.length === 0 && !showStart" class="mt-3 text-center text-xs text-muted">
        {{ $t('library.emptyHint') }}
      </p>
    </div>

    <p v-if="dragging" class="pointer-events-none absolute inset-x-3 bottom-14 rounded-lg bg-fill px-3 py-2 text-center text-xs font-semibold text-fill-fg shadow">
      {{ $t('library.dropHint') }}
    </p>

    <div v-if="lastImportError" role="alert" class="flex shrink-0 items-start gap-2 rounded-lg bg-panel2 p-2 text-xs text-fg">
      <span class="min-w-0 flex-1">{{ $t('library.importFailed') }}</span>
      <button
        type="button"
        class="flex min-h-11 min-w-11 items-center justify-center font-bold text-txt"
        :aria-label="$t('project.dismiss')"
        @click="dismissImportError"
      >
        ×
      </button>
    </div>

    <a
      :href="sourcesHref"
      target="_blank"
      rel="noopener"
      class="relative shrink-0 self-start text-xs font-semibold text-txt underline underline-offset-2 before:absolute before:-inset-y-3.5 before:inset-x-0 before:content-['']"
    >
      {{ $t('library.freeSources') }}
    </a>
  </section>
</template>
