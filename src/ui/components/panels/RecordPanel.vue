<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import { livePreviewStream, useRecordStore, type RecordPhase } from '../../stores/record'
import { cleanDeviceLabel } from '../../../core/record/devices'
import { RECORD_KINDS, canRecordKind, formatRecordTime, type RecordKind } from '../../../core/record/record'

const ICON_FOR_KIND: Record<RecordKind, string> = { microphone: 'mic', camera: 'camera', screen: 'screen' }

export default defineComponent({
  name: 'RecordPanel',
  components: { Icon },
  data() {
    return { copied: false }
  },
  computed: {
    ...mapState(useRecordStore, ['phase', 'kind', 'elapsedMs', 'level', 'announcedTens', 'statusKey', 'errorKey', 'fileName', 'hasRawFile', 'capabilities', 'live', 'noticeKey', 'extraNoticeKeys', 'warningKeys', 'checkKeys', 'diagnosticsText', 'storageProblemKey', 'optimizeFraction', 'micDevices', 'micDeviceId', 'micTest', 'testLevel', 'testSilent']),
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
    },
    testPercent(): string {
      return `${Math.min(100, Math.round(Math.sqrt(this.testLevel) * 100))}%`
    },
    testRunning(): boolean {
      return this.micTest === 'on' || this.micTest === 'starting'
    },
    testStatus(): string {
      const key = { off: 'record.micTestOff', starting: 'record.micTestStarting', on: 'record.micTestOn', denied: 'record.micTestDenied', failed: 'record.micTestFailed' }[this.micTest]
      return this.$t(key)
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
    if (this.capabilities.userMedia) void this.openMicPicker()
  },
  beforeUnmount() {
    // The test holds the microphone; leaving the tab lets it go.
    this.stopMicTest()
  },
  methods: {
    ...mapActions(useRecordStore, ['start', 'stop', 'cancel', 'pause', 'resume', 'addToTimeline', 'reset', 'retry', 'saveRecording', 'skipOptimize', 'importAgain', 'selectMicrophone', 'openMicPicker', 'startMicTest', 'stopMicTest']),
    iconFor(kind: RecordKind): string {
      return ICON_FOR_KIND[kind]
    },
    onPhase(phase: RecordPhase): void {
      if (phase === 'recording' || phase === 'paused') this.attachPreview()
      // Focus stays on a button after each change: a focused body would let Space start the timeline.
      if (phase === 'recording') this.focusRef('stopButton')
      if (phase === 'done') this.focusRef(this.storageProblemKey ? 'rescueButton' : 'addButton')
      if (phase === 'error') this.focusRef(this.hasRawFile ? 'saveButton' : 'retryButton')
    },
    attachPreview(): void {
      const video = this.$refs.preview as HTMLVideoElement | undefined
      if (!video) return
      const stream = livePreviewStream()
      if (video.srcObject !== stream) video.srcObject = stream
      void video.play().catch(() => undefined)
    },
    onMicChange(event: Event): void {
      this.selectMicrophone((event.target as HTMLSelectElement).value)
    },
    toggleTest(): void {
      if (this.testRunning) this.stopMicTest()
      else void this.startMicTest()
    },
    deviceName(device: { label: string; unnamed: number; isDefault: boolean }): string {
      const name = device.label ? cleanDeviceLabel(device.label) : this.$t('record.micUnnamed', { n: device.unnamed })
      return device.isDefault ? this.$t('record.micDefaultSuffix', { name }) : name
    },
    /** Clipboard where allowed; otherwise the text is selected so Ctrl+C works. */
    async copyDiagnostics(): Promise<void> {
      const box = this.$refs.diagnostics as HTMLTextAreaElement | undefined
      try {
        await navigator.clipboard.writeText(this.diagnosticsText)
        this.copied = true
      } catch {
        box?.focus()
        box?.select()
        try {
          this.copied = document.execCommand('copy')
        } catch {
          this.copied = false
        }
      }
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

    <div
      v-if="optimizeFraction !== null"
      data-role="optimize"
      class="flex flex-col gap-1.5 rounded-xl border border-line bg-panel2 px-3 py-2 text-xs"
    >
      <p role="status" class="font-semibold" data-role="optimize-text">{{ $t('record.optimizing', { percent: Math.round(optimizeFraction * 100) }) }}</p>
      <div class="h-1.5 overflow-hidden rounded-full bg-panel" role="presentation">
        <div class="h-full rounded-full bg-fill" :style="{ width: Math.round(optimizeFraction * 100) + '%' }" />
      </div>
      <p class="text-muted">{{ $t('record.optimizeHint') }}</p>
      <button
        type="button"
        data-role="optimize-skip"
        class="min-h-11 self-start rounded-lg border border-line px-3 font-semibold hover:bg-panel"
        @click="skipOptimize"
      >
        {{ $t('record.optimizeSkip') }}
      </button>
    </div>

    <template v-if="phase === 'idle' || phase === 'error'">
      <div
        v-if="phase === 'error'"
        role="alert"
        class="flex flex-col gap-2 rounded-xl border border-[var(--jc-danger)] bg-panel2 p-3 text-sm"
      >
        <p>{{ $t(errorKey ?? 'record.error.generic') }}</p>
        <template v-if="hasRawFile">
          <p class="text-xs text-muted">{{ $t('record.rawFileHint') }}</p>
          <button
            ref="saveButton"
            type="button"
            class="min-h-11 self-start rounded-lg bg-fill px-4 font-bold text-fill-fg hover:opacity-90"
            @click="saveRecording"
          >
            {{ $t('record.saveFile') }}
          </button>
          <button
            type="button"
            class="min-h-11 self-start rounded-lg border border-line px-4 font-semibold hover:bg-panel"
            @click="importAgain"
          >
            {{ $t('record.importAgain') }}
          </button>
        </template>
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

      <div v-if="capabilities.userMedia" data-role="mic-picker" class="flex flex-col gap-2 rounded-xl border border-line bg-panel2 px-3 py-2">
        <label for="record-mic-select" class="text-xs font-semibold">{{ $t('record.micLabel') }}</label>
        <select
          id="record-mic-select"
          data-role="mic-select"
          class="min-h-11 w-full rounded-lg border border-line bg-bg px-2 text-sm"
          :value="micDeviceId ?? ''"
          @change="onMicChange"
        >
          <option v-if="micDevices.length === 0" value="">{{ $t('record.micSystemDefault') }}</option>
          <option v-for="device in micDevices" :key="device.id" :value="device.id">{{ deviceName(device) }}</option>
        </select>
        <div class="flex items-center gap-2">
          <button
            type="button"
            data-role="mic-test"
            class="min-h-11 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold hover:bg-panel"
            @click="toggleTest"
          >
            {{ testRunning ? $t('record.micTestStop') : $t('record.micTest') }}
          </button>
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-panel" data-role="mic-test-meter" aria-hidden="true">
            <div class="h-full rounded-full bg-signal transition-[width] duration-100" :style="{ width: testPercent }" />
          </div>
        </div>
        <p data-role="mic-test-status" aria-live="polite" class="text-xs text-muted">{{ testStatus }}</p>
        <p v-if="testSilent" data-role="mic-warning" class="rounded-lg border border-line bg-panel px-3 py-2 text-xs">{{ $t('record.warn.noMic') }}</p>
        <p class="text-xs text-muted">{{ $t('record.micHelp') }}</p>
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

      <div v-if="kind !== 'microphone' && !noticeKey" class="flex items-center gap-2 text-xs font-semibold" data-role="mic-level">
        <Icon name="mic" class="size-4 shrink-0" />
        <div class="h-2 flex-1 overflow-hidden rounded-full bg-panel2" aria-hidden="true">
          <div class="h-full rounded-full bg-signal transition-[width] duration-100" :style="{ width: levelPercent }" />
        </div>
      </div>
      <p v-if="noticeKey" data-role="mic-notice" class="rounded-lg bg-panel2 px-3 py-2 text-xs text-muted">{{ $t(noticeKey) }}</p>
      <p
        v-for="key in warningKeys"
        :key="key"
        data-role="record-warning"
        aria-live="polite"
        class="rounded-lg border border-line bg-panel2 px-3 py-2 text-xs"
      >
        {{ $t(key) }}
      </p>
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
      <p v-if="storageProblemKey" role="alert" data-role="storage-problem" class="rounded-lg border border-[var(--jc-danger)] bg-panel px-3 py-2 text-xs">{{ $t(storageProblemKey) }}</p>
      <p v-else class="text-xs text-muted" data-role="stored-hint">{{ $t('record.storedHint') }}</p>
      <p v-if="noticeKey" data-role="mic-notice" class="text-xs text-muted">{{ $t(noticeKey) }}</p>
      <p v-for="key in extraNoticeKeys" :key="key" data-role="record-notice" class="text-xs text-muted">{{ $t(key) }}</p>
      <p v-for="key in checkKeys" :key="key" data-role="record-check" aria-live="polite" class="rounded-lg border border-line bg-panel px-3 py-2 text-xs">{{ $t(key) }}</p>
      <button
        ref="addButton"
        type="button"
        class="min-h-11 rounded-lg bg-fill font-bold text-fill-fg hover:opacity-90"
        @click="addToTimeline"
      >
        {{ $t('record.addToTimeline') }}
      </button>
      <button
        v-if="storageProblemKey"
        ref="rescueButton"
        type="button"
        data-role="save-file"
        class="min-h-11 rounded-lg bg-fill font-bold text-fill-fg hover:opacity-90"
        @click="saveRecording"
      >
        {{ $t('record.saveFile') }}
      </button>
      <button
        type="button"
        class="min-h-11 rounded-lg border border-line font-semibold hover:bg-panel"
        @click="reset"
      >
        {{ $t('record.again') }}
      </button>
      <button
        v-if="!storageProblemKey"
        type="button"
        data-role="save-file"
        class="min-h-11 self-start rounded-lg px-2 text-xs font-semibold text-txt hover:bg-panel"
        @click="saveRecording"
      >
        {{ $t('record.backupFile') }}
      </button>
    </div>

      <details v-if="diagnosticsText && (phase === 'error' || phase === 'done')" data-role="record-details" class="text-xs">
        <summary class="flex min-h-11 cursor-pointer items-center font-semibold">{{ $t('record.details.title') }}</summary>
        <p class="mb-2 text-muted">{{ $t('record.details.hint') }}</p>
        <textarea
          ref="diagnostics"
          readonly
          rows="8"
          :aria-label="$t('record.details.title')"
          class="w-full rounded-lg border border-line bg-bg p-2 font-mono text-[11px]"
          :value="diagnosticsText"
        />
        <button type="button" class="mt-2 min-h-11 rounded-lg border border-line px-4 font-semibold hover:bg-panel" @click="copyDiagnostics">
          {{ copied ? $t('record.details.copied') : $t('record.details.copy') }}
        </button>
      </details>
  </section>
</template>
