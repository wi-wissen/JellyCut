<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import type { Asset } from '../../core/project/types'
import { useEditorStore } from '../stores/editor'
import { useMediaStore } from '../stores/media'

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

export default defineComponent({
  name: 'LibraryPanel',
  components: { Icon },
  data() {
    return { dragDepth: 0 }
  },
  computed: {
    ...mapState(useEditorStore, ['project']),
    ...mapState(useMediaStore, ['statusOf', 'problems', 'thumbnails', 'importing', 'lastImportError']),
    assets(): Asset[] {
      return this.project.assets
    },
    dragging(): boolean {
      return this.dragDepth > 0
    },
    accept(): string {
      return ACCEPT
    },
    sourcesHref(): string {
      return this.$router.resolve({ name: 'sources' }).href
    }
  },
  methods: {
    ...mapActions(useMediaStore, ['importFiles', 'addToTimeline', 'dismissImportError']),
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
    onTile(asset: Asset): void {
      if (this.isReady(asset)) this.addToTimeline(asset.id)
    },
    tileLabel(asset: Asset): string {
      return this.isReady(asset) ? this.$t('library.addToTimeline', { name: asset.name }) : asset.name
    },
    /** Short reason shown on a tile that cannot be used. */
    problemText(asset: Asset): string {
      if (this.statusOf(asset.id) === 'missing') return this.$t('library.problems.missing')
      const first = this.problems[asset.id]?.[0]
      if (first === 'cannot-decode-video' || first === 'cannot-decode-audio') return this.$t('library.problems.cannotDecode')
      if (first === 'no-media') return this.$t('library.problems.noMedia')
      return this.$t('library.problems.unsupportedFormat')
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
      <h2 class="text-sm font-bold">{{ $t('library.media') }}</h2>
      <span v-if="importing > 0" role="status" class="flex items-center gap-1.5 text-xs text-muted">
        <span class="size-2 animate-pulse rounded-full bg-fill" aria-hidden="true" />
        {{ $t('library.importing') }}
      </span>
    </div>

    <input ref="fileInput" type="file" multiple :accept="accept" class="hidden" @change="onPicked" />

    <div class="min-h-0 flex-1 overflow-y-auto" :class="dragging ? 'rounded-lg outline-2 outline-dashed outline-fill -outline-offset-4' : ''">
      <div class="grid grid-cols-2 gap-2.5">
        <button
          v-for="(asset, index) in assets"
          :key="asset.id"
          type="button"
          class="group relative block aspect-[16/10] w-full overflow-hidden rounded-lg text-left"
          :class="isReady(asset) ? '' : 'cursor-default'"
          :style="{ background: gradient(index) }"
          :aria-label="tileLabel(asset)"
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
            class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-panel2 px-2.5 pb-8 pt-2 text-center text-[10px] font-semibold leading-tight text-fg"
          >
            <svg viewBox="0 0 24 24" class="size-5 text-[var(--jc-danger)]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
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
            class="absolute inset-0 flex items-center justify-center bg-black/35 text-sm font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          >
            {{ $t('library.add') }}
          </span>

          <span v-if="durationLabel(asset)" class="absolute right-1.5 top-1.5 rounded bg-black/60 px-1 font-mono text-[10px] text-white">
            {{ durationLabel(asset) }}
          </span>
          <span class="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-[11px] font-semibold text-white">
            {{ asset.name }}
          </span>
        </button>

        <button
          type="button"
          class="flex aspect-[16/10] items-center justify-center rounded-lg border-2 border-dashed border-line text-muted hover:border-fill hover:text-fg"
          :aria-label="$t('library.addMedia')"
          @click="openPicker"
        >
          <Icon name="plus" class="size-6" />
        </button>
      </div>

      <p v-if="assets.length === 0" class="mt-3 text-center text-xs text-muted">
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
      class="shrink-0 self-start text-xs font-semibold text-txt underline underline-offset-2"
    >
      {{ $t('library.freeSources') }}
    </a>
  </section>
</template>
