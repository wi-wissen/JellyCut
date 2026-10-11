<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import { livePreviewStream, useRecordStore, type RecordPhase } from '../../stores/record'
import { RECORD_KINDS, canRecordKind, formatRecordTime, type RecordKind } from '../../../core/record/record'

const ICON_FOR_KIND: Record<RecordKind, string> = { microphone: 'mic', camera: 'camera', screen: 'screen' }

export default defineComponent({
  name: 'RecordPanel',
  components: { Icon },
  computed: {
    ...mapState(useRecordStore, ['phase', 'kind', 'elapsedMs', 'level', 'announcedTens', 'statusKey', 'errorKey', 'fileName', 'capabilities', 'live']),
    sources(): RecordKind[] {
      return RECORD_KINDS.filter((kind) => canRecordKind(kind, this.capabilities))
    },
    time(): string {
      return formatRecordTime(this.elapsedMs)
    },
    announcement(): string {
      return this.announcedTens > 0 ? this.$t('record.announceTime', { time: formatRecordTime(this.announcedTens * 10_000) }) : ''
    },
    statusText(): string {
      return this.statusKey ? this.$t(this.statusKey) : ''
    },
    levelPercent(): string {
      return `${Math.min(100, Math.round(Math.sqrt(this.level) * 100))}%`
    }
  },
  watch: {
    phase(next: RecordPhase) {
      void this.$nextTick(() => this.onPhase(next))
    }
  },
  mounted() {
    // Coming back to the tab while a recording runs: the preview has to be bound again.
    void this.$nextTick(() => this.onPhase(this.phase))
  },
  methods: {
    ...mapActions(useRecordStore, ['start', 'stop', 'cancel', 'pause', 'resume', 'addToTimeline', 'reset', 'retry']),
    iconFor(kind: RecordKind): string {
      return ICON_FOR_KIND[kind]
    },
    onPhase(phase: RecordPhase): void {
      if (phase === 'recording' || phase === 'paused') this.attachPreview()
      // Focus stays on a button after each change: a focused body would let Space start the timeline.
      if (phase === 'recording') this.focusRef('stopButton')
      if (phase === 'done') this.focusRef('addButton')
      if (phase === 'error') this.focusRef('retryButton')
    },
    attachPreview(): void {
      const video = this.$refs.preview as HTMLVideoElement | undefined
      if (!video) return
      const stream = livePreviewStream()
      if (video.srcObject !== stream) video.srcObject = stream
      void video.play().catch(() => undefined)
    },
    focusRef(name: string): void {
      const element = this.$refs[name] as HTMLElement | undefined
      element?.focus()
    }
  }
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" :aria-label="$t('record.title')">
    <header class="flex min-h-7 items-center justify-between gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('record.title') }}</h2>
      <span v-if="live" class="flex items-center gap-2 font-mono text-sm font-semibold tabular-nums">
        <span
          aria-hidden="true"
          class="size-2.5 rounded-full bg-[#b3261e] motion-safe:animate-pulse"
        />
        {{ time }}
      </span>
    </header>

    <p role="status" class="min-h-5 text-xs font-semibold text-muted">{{ statusText }}</p>
    <p aria-live="polite" class="sr-only">{{ announcement }}</p>

    <template v-if="phase === 'idle' || phase === 'error'">
      <div
        v-if="phase === 'error'"
        role="alert"
        class="flex flex-col gap-2 rounded-xl border border-[var(--jc-danger)] bg-panel2 p-3 text-sm"
      >
        <p>{{ $t(errorKey ?? 'record.error.generic') }}</p>
        <button
          ref="retryButton"
          type="button"
          class="min-h-11 self-start rounded-lg bg-fill px-4 font-bold text-fill-fg hover:opacity-90"
          @click="retry"
        >
          {{ $t('record.tryAgain') }}
        </button>
      </div>

      <div class="flex flex-col gap-2.5">
        <button
          v-for="source in sources"
          :key="source"
          type="button"
          class="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2 text-left hover:bg-panel"
          @click="start(source)"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-fill-fg">
            <Icon :name="iconFor(source)" class="size-4" />
          </span>
          <span class="flex min-w-0 flex-col">
            <span class="text-sm font-bold">{{ $t(`record.kinds.${source}`) }}</span>
            <span class="text-xs text-muted">{{ $t(`record.hints.${source}`) }}</span>
          </span>
        </button>
      </div>
    </template>

    <p v-else-if="phase === 'starting'" class="text-sm text-muted">{{ $t('record.waiting') }}</p>

    <template v-else-if="phase === 'recording' || phase === 'paused'">
      <div v-if="kind !== 'microphone'" class="flex shrink-0 justify-center">
        <div class="relative aspect-video h-24 overflow-hidden rounded-xl bg-stage">
          <video
            ref="preview"
            muted
            playsinline
            autoplay
            :aria-label="$t('record.preview')"
            class="size-full object-contain"
            :class="{ '-scale-x-100': kind === 'camera' }"
          />
          <div v-if="phase === 'paused'" class="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-bold text-white">
            {{ $t('record.status.paused') }}
          </div>
        </div>
      </div>
      <div v-else class="flex flex-col gap-3 rounded-xl border border-line bg-panel2 p-4">
        <div class="flex items-center gap-2 text-sm font-semibold">
          <Icon name="mic" class="size-4" />
          {{ $t('record.level') }}
        </div>
        <div class="h-3 overflow-hidden rounded-full bg-panel" aria-hidden="true">
          <div class="h-full rounded-full bg-signal transition-[width] duration-100" :style="{ width: levelPercent }" />
        </div>
      </div>

      <button
        ref="stopButton"
        type="button"
        class="flex min-h-12 items-center justify-between rounded-xl bg-[#b3261e] px-5 text-base font-bold text-white hover:opacity-90"
        @click="stop"
      >
        <span class="flex items-center gap-2">
          <Icon name="stop" class="size-4" />
          {{ $t('record.stop') }}
        </span>
        <span class="font-mono tabular-nums" aria-hidden="true">{{ time }}</span>
      </button>

      <div class="grid grid-cols-2 gap-2">
        <button
          v-if="phase === 'recording'"
          type="button"
          class="min-h-11 rounded-lg border border-line bg-panel2 font-semibold hover:bg-panel"
          @click="pause"
        >
          {{ $t('record.pause') }}
        </button>
        <button
          v-else
          type="button"
          class="min-h-11 rounded-lg bg-fill font-semibold text-fill-fg hover:opacity-90"
          @click="resume"
        >
          {{ $t('record.resume') }}
        </button>
        <button
          type="button"
          class="min-h-11 rounded-lg border border-line bg-panel2 font-semibold hover:bg-panel"
          @click="cancel"
        >
          {{ $t('record.cancel') }}
        </button>
      </div>
    </template>

    <p v-else-if="phase === 'finishing'" class="text-sm text-muted">{{ $t('record.finishing') }}</p>

    <div v-else-if="phase === 'done'" class="flex flex-col gap-3 rounded-xl border border-line bg-panel2 p-4">
      <p class="text-sm font-bold">{{ $t('record.doneTitle') }}</p>
      <p class="break-words font-mono text-xs text-muted">{{ fileName }}</p>
      <p class="text-xs text-muted">{{ $t('record.doneText') }}</p>
      <button
        ref="addButton"
        type="button"
        class="min-h-11 rounded-lg bg-fill font-bold text-fill-fg hover:opacity-90"
        @click="addToTimeline"
      >
        {{ $t('record.addToTimeline') }}
      </button>
      <button
        type="button"
        class="min-h-11 rounded-lg border border-line font-semibold hover:bg-panel"
        @click="reset"
      >
        {{ $t('record.again') }}
      </button>
    </div>
  </section>
</template>
