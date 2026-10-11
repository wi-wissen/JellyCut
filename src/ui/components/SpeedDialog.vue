<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { takeSpeedOpener, useSpeedDialogStore } from '../stores/speedDialog'
import { AUDIO_MAX_SPEED, SPEED_MAX, SPEED_MIN, SPEED_PRESETS, hasClipSound, parseSpeedInput } from '../../core/timeline/speed'
import { formatNumber } from '../numberFormat'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** Element that had focus before the dialog opened; focus goes back there on close. */
let returnTarget: HTMLElement | null = null

/**
 * Tempo of the clip the dialog was opened for: quick-choice presets, or an own value from 0.1x to 100x.
 * Modal dialog: Escape closes, Tab stays inside, focus returns to the opener.
 */
export default defineComponent({
  name: 'SpeedDialog',
  data() {
    return {
      draft: '',
      /** Set when applying the value was refused (the clip would be too short). Cleared on every edit. */
      tooShort: false,
      presets: SPEED_PRESETS,
      audioMax: AUDIO_MAX_SPEED,
      titleId: 'speed-dialog-title',
      inputId: 'speed-custom-input',
      errorId: 'speed-custom-error'
    }
  },
  computed: {
    ...mapState(useSpeedDialogStore, ['isOpen', 'clipId']),
    ...mapState(useEditorStore, ['project']),
    clip() {
      return this.clipId ? (this.project.clips.find((c) => c.id === this.clipId) ?? null) : null
    },
    currentText(): string {
      return this.$t('speedDialog.current', { value: this.tempoText(this.clip?.speed ?? 1) })
    },
    parsed() {
      return parseSpeedInput(this.draft)
    },
    errorText(): string {
      if (this.tooShort) return this.$t('speedDialog.tooShort')
      const parsed = this.parsed
      if (parsed.ok || parsed.reason === 'empty') return ''
      if (parsed.reason === 'range') {
        return this.$t('speedDialog.rangeError', { min: formatNumber(SPEED_MIN, 1), max: formatNumber(SPEED_MAX) })
      }
      return this.$t('speedDialog.invalidError')
    },
    /** The tempo the clip gets: the typed one when it is valid, otherwise the current one. */
    previewSpeed(): number {
      const parsed = this.parsed
      return parsed.ok ? parsed.speed : (this.clip?.speed ?? 1)
    },
    silent(): boolean {
      return !hasClipSound(this.previewSpeed)
    },
    applyDisabled(): boolean {
      return this.draft.trim() === ''
    }
  },
  watch: {
    isOpen(open: boolean) {
      if (open) {
        returnTarget = takeSpeedOpener() ?? (document.activeElement as HTMLElement | null)
        this.draft = ''
        this.tooShort = false
        void nextTick(() => this.focusInput())
        return
      }
      const target = returnTarget
      returnTarget = null
      void nextTick(() => {
        if (target?.isConnected) target.focus({ preventScroll: true })
      })
    },
    draft() {
      this.tooShort = false
    }
  },
  mounted() {
    window.addEventListener('keydown', this.onWindowKeydown, true)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onWindowKeydown, true)
  },
  methods: {
    ...mapActions(useSpeedDialogStore, ['close']),
    ...mapActions(useEditorStore, ['setClipSpeed']),
    panel(): HTMLElement | null {
      return (this.$refs.panel as HTMLElement | undefined) ?? null
    },
    focusInput(): void {
      const input = this.$refs.input as HTMLInputElement | undefined
      input?.focus()
    },
    fmt(value: number): string {
      return formatNumber(value)
    },
    tempoText(speed: number): string {
      return this.$t('units.tempo', { value: formatNumber(speed, 2) })
    },
    /** A quick choice applies at once and closes the dialog. */
    applyPreset(speed: number): void {
      this.apply(speed)
    },
    applyDraft(): void {
      const parsed = this.parsed
      if (!parsed.ok) {
        // Empty: nothing to do. Out of range or not a number: the message explains it, the field keeps focus.
        this.focusInput()
        return
      }
      this.apply(parsed.speed)
    },
    apply(speed: number): void {
      const id = this.clipId
      if (!id) return
      if (this.setClipSpeed(id, speed)) {
        this.close()
        return
      }
      this.tooShort = true
      this.focusInput()
    },
    onWindowKeydown(event: KeyboardEvent): void {
      if (!this.isOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close()
        return
      }
      if (event.key !== 'Tab') return
      // Focus stays inside the dialog while it is open.
      const items = Array.from(this.panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || !this.panel()?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !this.panel()?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
  }
})
</script>

<template>
  <div
    v-if="isOpen && clip"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
    data-role="speed-backdrop"
    @pointerdown.self="close"
  >
    <section
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      class="jc-speed-dialog flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-line bg-panel p-4 text-fg shadow-xl"
    >
      <header class="flex items-center justify-between gap-2">
        <h2 :id="titleId" class="text-base font-bold">{{ $t('speedDialog.title') }}</h2>
        <button type="button" class="min-h-11 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-panel2" @click="close">
          {{ $t('speedDialog.close') }}
        </button>
      </header>

      <p class="text-sm text-muted" data-role="speed-current">{{ currentText }}</p>

      <div class="flex flex-col gap-2">
        <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('speedDialog.presets') }}</h3>
        <div class="grid grid-cols-4 gap-2" role="group" :aria-label="$t('speedDialog.presets')">
          <button
            v-for="speed in presets"
            :key="speed"
            type="button"
            class="jc-speed-chip min-h-11 rounded-full border px-2 text-sm font-semibold tabular-nums"
            :class="clip.speed === speed ? 'border-fill bg-fill text-fill-fg' : 'border-line bg-panel2 text-fg hover:bg-panel'"
            :aria-pressed="clip.speed === speed"
            :data-speed="speed"
            @click="applyPreset(speed)"
          >
            {{ tempoText(speed) }}
          </button>
        </div>
      </div>

      <form class="flex flex-col gap-2 border-t border-line pt-3" novalidate @submit.prevent="applyDraft">
        <label :for="inputId" class="text-xs font-semibold">{{ $t('speedDialog.custom') }}</label>
        <div class="flex items-center gap-2">
          <input
            :id="inputId"
            ref="input"
            v-model="draft"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            class="jc-speed-input min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-base tabular-nums text-fg"
            :placeholder="$t('speedDialog.placeholder')"
            :aria-invalid="errorText !== '' ? 'true' : undefined"
            :aria-describedby="errorText !== '' ? errorId : undefined"
          />
          <span class="text-sm font-semibold text-muted" aria-hidden="true">{{ $t('speedDialog.unit') }}</span>
        </div>
        <p v-if="errorText" :id="errorId" role="alert" class="text-xs font-semibold text-[var(--jc-danger)]">{{ errorText }}</p>
        <p v-if="silent" class="text-xs text-muted" data-role="speed-silent">
          {{ $t('speedDialog.soundNote', { max: fmt(audioMax) }) }}
        </p>
        <button
          type="submit"
          class="min-h-11 rounded-lg bg-fill px-4 font-bold text-fill-fg hover:opacity-90 disabled:opacity-40"
          :disabled="applyDisabled"
        >
          {{ $t('speedDialog.apply') }}
        </button>
      </form>
    </section>
  </div>
</template>
