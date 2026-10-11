<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { useCreditsStore } from '../stores/credits'
import { assetsNeedingCredit } from '../../core/credits/credits'
import { EXPORT_FPS, EXPORT_QUALITIES, EXPORT_RESOLUTIONS, GIF_FPS, GIF_WIDTHS } from '../../core/export/presets'
import { exportDuration, formatBytes, formatClock, formatEta } from '../../core/export/format'
import { formatEstimateValue, type TimeRange } from '../../core/export/estimate'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const TRIGGER_ID = 'export-button'
const TITLE_ID = 'export-dialog-title'
const CREDITS_HINT_BUTTON_ID = 'export-credits-hint-button'

export default defineComponent({
  name: 'ExportDialog',
  data() {
    return {
      resolutions: EXPORT_RESOLUTIONS,
      fpsValues: EXPORT_FPS,
      qualities: EXPORT_QUALITIES,
      formats: ['mp4', 'gif'] as const,
      gifWidths: GIF_WIDTHS,
      gifFpsValues: GIF_FPS,
      titleId: TITLE_ID,
      creditsHintButtonId: CREDITS_HINT_BUTTON_ID,
      creditsHintDismissed: false
    }
  },
  computed: {
    ...mapState(useExportStore, [
      'open',
      'options',
      'format',
      'gif',
      'gifTooBig',
      'phase',
      'progress',
      'result',
      'error',
      'notice',
      'encoders',
      'inWorker',
      'estimatedBytes',
      'estimate',
      'missingNames',
      'canStart',
      'runFileName',
      'hiddenNow'
    ]),
    ...mapState(useEditorStore, ['project']),
    ...mapState(useCreditsStore, { creditsOpen: 'open' }),
    locale(): string {
      return this.$i18n.locale
    },
    exportLength(): number {
      return exportDuration(this.project)
    },
    durationText(): string {
      return formatClock(this.exportLength)
    },
    sizeText(): string {
      return formatBytes(this.estimatedBytes, this.locale)
    },
    /** Quality only changes the size; resolution and frame rate change the time. */
    /** GIF sizes are rough: the picture decides how well the frames compress. */
    estimateNoteText(): string {
      return this.format === 'gif' ? this.$t('export.roughNote') : this.$t('export.estimateNote')
    },
    /** Video length, file size and export time as separate lines: the time is a range while uncertain. */
    videoLine(): string {
      return this.$t('export2.estimate.video', { duration: this.durationText })
    },
    sizeLine(): string {
      return this.$t('export2.estimate.size', { size: this.sizeText })
    },
    timeLine(): string {
      return this.$t('export2.estimate.time', { time: this.rangeText(this.estimate.range) })
    },
    calibrationSamples(): number {
      return this.estimate.samples
    },
    detailRows(): { key: string; label: string; estimated: string; measured: string }[] {
      const r = this.result
      if (!r?.estimatedPhases || !r.measuredPhases) return []
      const est = r.estimatedPhases
      const meas = r.measuredPhases
      const rows = [
        { key: 'decode', est: est.decode, meas: meas.decode },
        { key: 'draw', est: est.draw, meas: meas.draw },
        { key: 'encode', est: est.encode, meas: meas.encode },
        { key: 'other', est: est.audio + est.fixed, meas: meas.audio + meas.fixed }
      ]
      return rows.map((row) => ({
        key: row.key,
        label: this.$t(`export2.details.phases.${row.key}`),
        estimated: this.secondsText(row.est),
        measured: this.secondsText(row.meas)
      }))
    },
    comparisonText(): string {
      if (!this.result) return ''
      return this.$t('export2.compare', {
        estimated: this.rangeText(formatEstimateValue(this.result.estimatedSeconds)),
        actual: this.rangeText(formatEstimateValue(this.result.elapsedMs / 1000))
      })
    },
    classText(): string {
      return this.result ? this.$t(`export2.details.class.${this.result.featureClass}`) : ''
    },
    calibrationText(): string {
      return this.calibrationSamples > 0
        ? this.$t('export2.details.samples', { count: this.calibrationSamples })
        : this.$t('export2.details.none')
    },
    savedText(): string {
      if (!this.result) return ''
      return this.result.savedAs === 'file'
        ? this.$t('export2.saved.file', { name: this.result.fileName })
        : this.$t('export2.saved.download', { name: this.result.fileName })
    },
    savingText(): string {
      return this.runFileName
        ? this.$t('export2.saving.file', { name: this.runFileName })
        : this.$t('export2.saving.download')
    },
    noticeText(): string {
      return this.notice ? this.$t(this.notice.key, this.notice.params) : ''
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
      return this.format === 'mp4' && this.phase === 'ready' && !this.encoders?.video
    },
    errorText(): string {
      return this.error ? this.$t(this.error.key, this.error.params) : ''
    },
    resultSizeText(): string {
      return this.result ? formatBytes(this.result.size, this.locale) : ''
    },
    creditsHintVisible(): boolean {
      return !this.creditsHintDismissed && assetsNeedingCredit(this.project).length > 0
    },
    missingText(): string {
      return this.$t('export.errors.missing', { names: this.missingNames.join(', ') })
    }
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) {
        this.creditsHintDismissed = false
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
    ...mapActions(useExportStore, ['show', 'close', 'setOptions', 'setFormat', 'setGifOptions', 'start', 'cancel', 'save', 'reset']),
    /** Number with the locale's separator, one decimal at most. */
    numberText(value: number): string {
      return new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 }).format(value)
    },
    /** A range or single value of a duration, in words for the dialog's language. */
    rangeText(range: TimeRange): string {
      const unit = this.$t(`export2.unit.${range.unit}`)
      if (range.low === range.high) return this.$t('export2.time.single', { value: this.numberText(range.low), unit })
      return this.$t('export2.time.range', { low: this.numberText(range.low), high: this.numberText(range.high), unit })
    },
    /** Seconds with one decimal, for the details table. */
    secondsText(seconds: number): string {
      return this.$t('export2.time.single', { value: this.numberText(Math.round(seconds * 10) / 10), unit: this.$t('export2.unit.seconds') })
    },
    /** Opens the credits dialog above this one; focus returns to the hint when it closes. */
    openCredits(): void {
      useCreditsStore().show({ returnId: CREDITS_HINT_BUTTON_ID })
    },
    dismissCreditsHint(): void {
      this.creditsHintDismissed = true
      void nextTick(() => this.focusInside(false))
    },
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
      // The credits dialog stacks on top and handles its own keys.
      if (!this.open || this.creditsOpen) return
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
              <legend class="mb-2 text-xs font-semibold text-muted">{{ $t('export.labels.format') }}</legend>
              <div class="grid grid-cols-2 gap-1.5 rounded-xl bg-panel2 p-1">
                <label v-for="f in formats" :key="f" class="cursor-pointer">
                  <input
                    type="radio"
                    name="export-format"
                    class="peer sr-only"
                    :checked="format === f"
                    @change="setFormat(f)"
                  />
                  <span class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:cursor-default">{{ $t(`export.formats.${f}`) }}</span>
                </label>
              </div>
            </fieldset>

            <template v-if="format === 'mp4'">
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
                  <span class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:cursor-default">{{ $t('export.resolutionValue', { value: r }) }}</span>
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
            </template>

            <template v-if="format === 'gif'">
              <fieldset class="mb-4 min-w-0 border-0 p-0" :disabled="optionsDisabled">
                <legend class="mb-2 text-xs font-semibold text-muted">{{ $t('export.labels.width') }}</legend>
                <div class="grid grid-cols-3 gap-1.5 rounded-xl bg-panel2 p-1">
                  <label v-for="w in gifWidths" :key="w" class="cursor-pointer">
                    <input
                      type="radio"
                      name="export-gif-width"
                      class="peer sr-only"
                      :checked="gif.width === w"
                      @change="setGifOptions({ width: w })"
                    />
                    <span class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:cursor-default">{{ $t('export.widthValue', { value: w }) }}</span>
                  </label>
                </div>
              </fieldset>

              <fieldset class="mb-4 min-w-0 border-0 p-0" :disabled="optionsDisabled">
                <legend class="mb-2 text-xs font-semibold text-muted">{{ $t('export.labels.fps') }}</legend>
                <div class="grid grid-cols-3 gap-1.5 rounded-xl bg-panel2 p-1">
                  <label v-for="f in gifFpsValues" :key="f" class="cursor-pointer">
                    <input
                      type="radio"
                      name="export-gif-fps"
                      class="peer sr-only"
                      :checked="gif.fps === f"
                      @change="setGifOptions({ fps: f })"
                    />
                    <span class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold peer-checked:bg-fill peer-checked:text-fill-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:cursor-default">{{ f }}</span>
                  </label>
                </div>
              </fieldset>

              <fieldset class="mb-4 min-w-0 border-0 p-0" :disabled="optionsDisabled">
                <label class="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
                  <span>{{ $t('export.loop') }}</span>
                  <span class="relative inline-flex h-6 w-11 shrink-0 items-center">
                    <input type="checkbox" role="switch" class="peer sr-only" :checked="gif.loop" @change="setGifOptions({ loop: ($event.target as HTMLInputElement).checked })" />
                    <span class="absolute inset-0 rounded-full border border-line bg-panel2 peer-checked:bg-fill peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fill peer-disabled:opacity-60" aria-hidden="true" />
                    <span class="absolute left-0.5 h-5 w-5 rounded-full bg-panel shadow transition-transform peer-checked:translate-x-5" aria-hidden="true" />
                  </span>
                </label>
              </fieldset>
            </template>

            <div v-if="phase === 'checking'" role="status" class="mb-3 text-sm text-muted">{{ $t('export.checking') }}</div>

            <template v-else-if="phase === 'ready' || phase === 'running'">
              <div class="mb-3 space-y-1 text-sm">
                <p>{{ videoLine }}</p>
                <p>{{ sizeLine }}</p>
                <p class="flex flex-wrap items-baseline gap-x-2 font-semibold">
                  <span>{{ timeLine }}</span>
                  <small class="text-xs font-normal text-muted">{{ estimateNoteText }}</small>
                </p>
              </div>
              <p v-if="phase === 'ready'" class="mb-2 text-xs text-muted">{{ $t('export2.hidden.ready') }}</p>
              <p v-if="!estimate.calibrated" class="mb-3 text-xs text-muted">{{ $t('export.calibrationHint') }}</p>
              <p v-if="format === 'mp4' && encoders?.video" class="mb-3 text-xs text-muted">
                {{ $t('export.encoder', { codec: codecLabel }) }}
                <span v-if="codecFallback" class="block">{{ $t('export.codecNote') }}</span>
              </p>
            </template>

            <p v-if="phase === 'ready' && exportLength <= 0" role="status" class="mb-3 text-sm text-muted">{{ $t('export.errors.empty') }}</p>
            <div v-if="noEncoder" role="alert" class="mb-3 rounded-lg border border-[var(--jc-danger)] bg-panel2 px-3 py-2 text-sm">
              {{ $t('export.errors.noEncoder') }}
            </div>
            <div v-if="phase === 'ready' && missingNames.length > 0" role="alert" class="mb-3 rounded-lg border border-[var(--jc-danger)] bg-panel2 px-3 py-2 text-sm">
              {{ missingText }}
            </div>
            <div v-if="phase === 'ready' && gifTooBig" role="alert" class="mb-3 rounded-lg border border-[var(--jc-danger)] bg-panel2 px-3 py-2 text-sm">
              {{ $t('export.errors.gifTooLarge') }}
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
              <p class="mt-2 text-xs text-muted">{{ savingText }}</p>
              <p v-if="hiddenNow" role="status" class="mt-2 rounded-lg bg-panel2 px-3 py-2 text-sm">{{ $t('export2.hidden.running') }}</p>
              <p v-if="!inWorker" class="mt-2 text-xs text-muted">{{ $t('export.keepOpen') }}</p>
            </div>
          </template>

          <!-- Done -->
          <div v-else-if="phase === 'done' && result" class="py-2">
            <p class="text-base font-bold">{{ $t('export.done') }}</p>
            <p class="mt-1 text-sm">{{ savedText }}</p>
            <p class="mt-2 break-all text-sm text-muted">{{ $t('export.fileSize', { name: result.fileName, size: resultSizeText }) }}</p>
            <p class="mt-2 text-sm">{{ comparisonText }}</p>
            <div v-if="noticeText" role="alert" class="mt-3 rounded-lg border border-[var(--jc-danger)] bg-panel2 px-3 py-2 text-sm">
              {{ noticeText }}
            </div>
            <details v-if="detailRows.length" class="mt-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
              <summary class="min-h-11 cursor-pointer py-2 font-semibold">{{ $t('export2.details.title') }}</summary>
              <table class="mb-2 w-full text-left text-sm">
                <thead>
                  <tr class="text-xs text-muted">
                    <th class="py-1 font-semibold">{{ $t('export2.details.step') }}</th>
                    <th class="py-1 text-right font-semibold">{{ $t('export2.details.estimated') }}</th>
                    <th class="py-1 text-right font-semibold">{{ $t('export2.details.measured') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in detailRows" :key="row.key">
                    <td class="py-1">{{ row.label }}</td>
                    <td class="py-1 text-right tabular-nums">{{ row.estimated }}</td>
                    <td class="py-1 text-right tabular-nums">{{ row.measured }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="text-xs text-muted">{{ classText }} · {{ calibrationText }}</p>
              <p v-if="result.hiddenShare > 0.1" class="mt-1 text-xs text-muted">{{ $t('export2.hidden.skipped') }}</p>
            </details>
            <div v-if="creditsHintVisible" class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
              <p class="w-full">{{ $t('export.creditsHint.text') }}</p>
              <button :id="creditsHintButtonId" type="button" class="min-h-11 rounded-lg px-3 font-semibold text-fg underline hover:bg-panel" @click="openCredits">
                {{ $t('export.creditsHint.open') }}
              </button>
              <button type="button" class="min-h-11 rounded-lg px-3 text-muted hover:bg-panel" @click="dismissCreditsHint">
                {{ $t('export.creditsHint.hide') }}
              </button>
            </div>
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
              {{ $t('export2.saveAgain') }}
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
