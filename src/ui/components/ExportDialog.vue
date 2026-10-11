<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { EXPORT_FPS, EXPORT_QUALITIES, EXPORT_RESOLUTIONS } from '../../core/export/presets'
import { formatBytes, formatClock, formatEta } from '../../core/export/format'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const TRIGGER_ID = 'export-button'
const TITLE_ID = 'export-dialog-title'

export default defineComponent({
  name: 'ExportDialog',
  data() {
    return {
      resolutions: EXPORT_RESOLUTIONS,
      fpsValues: EXPORT_FPS,
      qualities: EXPORT_QUALITIES,
      titleId: TITLE_ID
    }
  },
  computed: {
    ...mapState(useExportStore, [
      'open',
      'options',
      'phase',
      'progress',
      'result',
      'error',
      'encoders',
      'inWorker',
      'estimatedBytes',
      'missingNames',
      'canStart'
    ]),
    ...mapState(useEditorStore, ['totalDuration']),
    locale(): string {
      return String(this.$i18n.locale)
    },
    durationText(): string {
      return formatClock(this.totalDuration)
    },
    sizeText(): string {
      return formatBytes(this.estimatedBytes, this.locale)
    },
    optionsDisabled(): boolean {
      return this.phase !== 'ready' && this.phase !== 'checking'
    },
    percent(): number {
      return Math.floor((this.progress?.fraction ?? 0) * 100)
    },
    timingText(): string {
      const elapsed = this.$t('export.elapsed', { time: formatClock((this.progress?.elapsedMs ?? 0) * 1000) })
      const eta = formatEta(this.progress?.etaMs ?? null)
      if (eta.unit === 'none') return elapsed
      const remaining = eta.unit === 'seconds' ? this.$t('export.etaSeconds', { value: eta.value }) : this.$t('export.etaMinutes', { value: eta.value })
      return `${elapsed} · ${remaining}`
    },
    codecLabel(): string {
      const video = this.encoders?.video
      return video ? this.$t(`export.codecs.${video}`) : ''
    },
    codecFallback(): boolean {
      return !!this.encoders?.video && this.encoders.video !== 'avc'
    },
    noEncoder(): boolean {
      return this.phase === 'ready' && !this.encoders?.video
    },
    errorText(): string {
      return this.error ? this.$t(this.error.key, this.error.params) : ''
    },
    resultSizeText(): string {
      return this.result ? formatBytes(this.result.size, this.locale) : ''
    },
    missingText(): string {
      return this.$t('export.errors.missing', { names: this.missingNames.join(', ') })
    }
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) {
        void nextTick(() => this.focusInside(true))
      } else {
        void nextTick(() => (document.getElementById(TRIGGER_ID) as HTMLElement | null)?.focus())
      }
    },
    phase() {
      // The focused control may have left the DOM with the old phase (for example Cancel after a finished export).
      void nextTick(() => this.focusInside(false))
    }
  },
  mounted() {
    // Capture phase on window: the dialog is modal, so editor shortcuts (Space plays, Ctrl+Z) must not see its keys.
    window.addEventListener('keydown', this.onWindowKeydown, true)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onWindowKeydown, true)
  },
  methods: {
    ...mapActions(useExportStore, ['show', 'close', 'setOptions', 'start', 'cancel', 'save', 'reset']),
    panel(): HTMLElement | null {
      return (this.$refs.panel as HTMLElement | undefined) ?? null
    },
    focusables(): HTMLElement[] {
      return Array.from(this.panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    },
    /** Moves focus into the dialog; keeps it where it is when it is already inside. */
    focusInside(initial: boolean): void {
      const panel = this.panel()
      if (!panel) return
      if (!initial && panel.contains(document.activeElement)) return
      const checked = panel.querySelector<HTMLElement>('input[type="radio"]:checked')
      const target = checked ?? this.focusables()[0] ?? panel
      target.focus()
    },
    onBackdropClick(): void {
      if (this.phase !== 'running') this.close()
    },
    onWindowKeydown(event: KeyboardEvent): void {
      if (!this.open) return
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        // While an export runs Escape does nothing; Cancel is the way out.
        if (this.phase !== 'running') this.close()
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
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      @click.self="onBackdropClick"
    >
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-busy="phase === 'running' ? 'true' : 'false'"
        class="flex max-h-[calc(100dvh-24px)] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl"
      >
        <h2 :id="titleId" class="border-b border-line px-5 py-4 text-base font-bold">{{ $t('export.title') }}</h2>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <!-- Settings: checking, ready and (disabled) running -->
          <template v-if="phase === 'checking' || phase === 'ready' || phase === 'running'">
            <fieldset class="mb-4 min-w-0 border-0 p-0" :disabled="optionsDisabled">
              <legend class="mb-2 text-xs font-semibold text-muted">{{ $t('export.labels.resolution') }}</legend>
              <div class="grid grid-cols-3 gap-1.5 rounded-xl bg-panel2 p-1">
                <label v-for="r in resolutions" :key="r" class="cursor-pointer">
                  <input
                    type="radio"
                    name="export-resolution"
                    class="peer sr-only"
                    :checked="options.resolution === r"
                    @change="setOptions({ resolution: r })"
                  />
                  <span class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:cursor-default">{{ r }}p</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="mb-4 min-w-0 border-0 p-0" :disabled="optionsDisabled">
              <legend class="mb-2 text-xs font-semibold text-muted">{{ $t('export.labels.fps') }}</legend>
              <div class="grid grid-cols-3 gap-1.5 rounded-xl bg-panel2 p-1">
                <label v-for="f in fpsValues" :key="f" class="cursor-pointer">
                  <input
                    type="radio"
                    name="export-fps"
                    class="peer sr-only"
                    :checked="options.fps === f"
                    @change="setOptions({ fps: f })"
                  />
                  <span class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:cursor-default">{{ f }}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="mb-4 min-w-0 border-0 p-0" :disabled="optionsDisabled">
              <legend class="mb-2 text-xs font-semibold text-muted">{{ $t('export.labels.quality') }}</legend>
              <div class="grid grid-cols-3 gap-1.5 rounded-xl bg-panel2 p-1">
                <label v-for="q in qualities" :key="q" class="cursor-pointer">
                  <input
                    type="radio"
                    name="export-quality"
                    class="peer sr-only"
                    :checked="options.quality === q"
                    @change="setOptions({ quality: q })"
                  />
                  <span class="flex min-h-11 items-center justify-center rounded-lg px-1 text-center text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:cursor-default">{{ $t(`export.qualities.${q}`) }}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="mb-4 min-w-0 border-0 p-0" :disabled="optionsDisabled">
              <legend class="mb-2 text-xs font-semibold text-muted">{{ $t('export.labels.format') }}</legend>
              <div class="grid grid-cols-2 gap-1.5 rounded-xl bg-panel2 p-1">
                <label class="cursor-pointer">
                  <input type="radio" name="export-format" class="peer sr-only" checked disabled />
                  <span class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill">{{ $t('export.formats.mp4') }}</span>
                </label>
                <label class="cursor-not-allowed">
                  <input type="radio" name="export-format" class="peer sr-only" disabled />
                  <span class="flex min-h-11 flex-col items-center justify-center rounded-lg text-sm font-semibold text-muted opacity-60">
                    <span>{{ $t('export.formats.gif') }}</span>
                    <span class="text-[11px] font-normal">{{ $t('export.formats.soon') }}</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div v-if="phase === 'checking'" role="status" class="mb-3 text-sm text-muted">{{ $t('export.checking') }}</div>

            <template v-else-if="phase === 'ready' || phase === 'running'">
              <p class="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span>{{ $t('export.estimate', { duration: durationText, size: sizeText }) }}</span>
                <small class="text-xs text-muted">{{ $t('export.estimateNote') }}</small>
              </p>
              <p v-if="encoders?.video" class="mb-3 text-xs text-muted">
                {{ $t('export.encoder', { codec: codecLabel }) }}
                <span v-if="codecFallback" class="block">{{ $t('export.codecNote') }}</span>
              </p>
            </template>

            <p v-if="phase === 'ready' && totalDuration <= 0" role="status" class="mb-3 text-sm text-muted">{{ $t('export.errors.empty') }}</p>
            <div v-if="noEncoder" role="alert" class="mb-3 rounded-lg border border-[var(--jc-danger)] bg-panel2 px-3 py-2 text-sm">
              {{ $t('export.errors.noEncoder') }}
            </div>
            <div v-if="phase === 'ready' && missingNames.length > 0" role="alert" class="mb-3 rounded-lg border border-[var(--jc-danger)] bg-panel2 px-3 py-2 text-sm">
              {{ missingText }}
            </div>

            <div v-if="phase === 'running'" class="mt-1">
              <div class="mb-2 flex items-baseline justify-between gap-3 text-sm">
                <span class="font-semibold">{{ $t('export.running') }}</span>
                <span class="tabular-nums">{{ $t('export.percent', { percent: percent }) }}</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="percent"
                :aria-label="$t('export.progressLabel')"
                class="h-3 overflow-hidden rounded-full bg-panel2"
              >
                <div class="h-full rounded-full bg-fill transition-[width] duration-300" :style="{ width: `${percent}%` }" />
              </div>
              <p class="mt-2 text-xs text-muted">{{ timingText }}</p>
              <p v-if="!inWorker" class="mt-2 text-xs text-muted">{{ $t('export.keepOpen') }}</p>
            </div>
          </template>

          <!-- Done -->
          <div v-else-if="phase === 'done' && result" class="py-2">
            <p class="text-base font-bold">{{ $t('export.done') }}</p>
            <p class="mt-1 text-sm">{{ $t('export.doneText') }}</p>
            <p class="mt-2 break-all text-sm text-muted">{{ $t('export.fileSize', { name: result.fileName, size: resultSizeText }) }}</p>
          </div>

          <!-- Error and cancelled -->
          <div v-else-if="phase === 'error'" role="alert" class="rounded-lg border border-[var(--jc-danger)] bg-panel2 px-3 py-3 text-sm">
            {{ errorText }}
          </div>
          <div v-else-if="phase === 'cancelled'" role="status" class="py-2 text-sm">{{ $t('export.cancelled') }}</div>
        </div>

        <div class="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
          <template v-if="phase === 'checking' || phase === 'ready'">
            <button type="button" class="min-h-11 rounded-lg px-4 text-sm font-semibold text-fg hover:bg-panel2" @click="close">
              {{ $t('export.cancel') }}
            </button>
            <button
              type="button"
              class="min-h-11 rounded-lg bg-signal px-4 text-sm font-bold text-signal-fg enabled:hover:brightness-95 disabled:opacity-40"
              :disabled="!canStart"
              @click="start"
            >
              {{ $t('export.start') }}
            </button>
          </template>
          <template v-else-if="phase === 'running'">
            <button type="button" class="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-fg hover:bg-panel2" @click="cancel">
              {{ $t('export.cancel') }}
            </button>
          </template>
          <template v-else-if="phase === 'done'">
            <button type="button" class="min-h-11 rounded-lg px-4 text-sm font-semibold text-fg hover:bg-panel2" @click="close">
              {{ $t('export.close') }}
            </button>
            <button type="button" class="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-fg hover:bg-panel2" @click="reset">
              {{ $t('export.again') }}
            </button>
            <button type="button" class="min-h-11 rounded-lg bg-signal px-5 text-sm font-bold text-signal-fg hover:brightness-95" @click="save">
              {{ $t('export.save') }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="min-h-11 rounded-lg px-4 text-sm font-semibold text-fg hover:bg-panel2" @click="close">
              {{ $t('export.close') }}
            </button>
            <button type="button" class="min-h-11 rounded-lg bg-signal px-5 text-sm font-bold text-signal-fg hover:brightness-95" @click="reset">
              {{ $t('export.back') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
