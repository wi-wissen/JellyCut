<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useFineCutStore } from '../../stores/fineCut'
import { frameIndexLabel, pxPerFrameForZoom } from '../../../core/timeline/fineCut'
import { formatTimecode, frameStart } from '../../../core/time'
import FineCutFrame from './FineCutFrame.vue'
import FineCutStrip from './FineCutStrip.vue'
import FineCutWaveform from './FineCutWaveform.vue'
import Icon from '../Icon.vue'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const TRIGGER_ID = 'fine-cut-button'
const TITLE_ID = 'fine-cut-title'
/** Same count as the frame strip: 8 tiles on each side of the cut. */
const STRIP_TILES = 16
const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'k', 'K', 'p', 'P'])

export default defineComponent({
  name: 'FineCutOverlay',
  components: { FineCutFrame, FineCutStrip, FineCutWaveform, Icon },
  data() {
    return {
      titleId: TITLE_ID,
      viewport: 0,
      fullscreen: false,
      fullscreenSupported: typeof document !== 'undefined' && document.fullscreenEnabled === true,
      resizeObserver: null as ResizeObserver | null
    }
  },
  computed: {
    ...mapState(useFineCutStore, [
      'isOpen',
      'assetId',
      'assetName',
      'fps',
      'cutSrc',
      'zoom',
      'snapKeyframes',
      'soundOnStep',
      'hasAudio',
      'error',
      'canCut',
      'frameMicros',
      'mediaReady',
      'mediaProblem',
      'hintVisible',
      'scanFraction'
    ]),
    locale(): string {
      return this.$i18n.locale
    },
    px(): number {
      return pxPerFrameForZoom(this.zoom, this.viewport, this.fps)
    },
    innerWidth(): number {
      return Math.max(this.viewport, STRIP_TILES * this.px)
    },
    frameIndex(): number {
      return frameIndexLabel(this.cutSrc, this.fps)
    },
    beforeDetail(): string {
      return this.detail(this.frameIndex - 1)
    },
    afterDetail(): string {
      return this.detail(this.frameIndex)
    },
    chip(): string {
      return this.$t('fineCut.chip', { name: this.assetName, fps: this.fps })
    },
    pauseEnabled(): boolean {
      return this.hasAudio === true
    },
    /** A missing file is explained in the picture area instead; see unavailableText. */
    errorText(): string {
      if (this.error === 'too-short') return this.$t('fineCut.tooShort')
      if (this.error === 'cannot-cut') return this.$t('fineCut.cannotCut')
      return ''
    },
    unavailableText(): string {
      return this.mediaProblem === 'unsupported' ? this.$t('fineCut.unsupported') : this.$t('fineCut.unavailable')
    },
    /** The main action is "Cut here" when a cut can be made, otherwise "Back" (closes without a change). */
    primaryIsCut(): boolean {
      return this.canCut && this.mediaReady
    },
    /** Tooltip of the disabled cut buttons. */
    cutBlockedReason(): string {
      return this.mediaReady ? this.errorText : this.unavailableText
    },
    zoomPx(): number {
      return Math.round(this.px)
    },
    stateSnap(): string {
      return this.snapKeyframes ? this.$t('fineCut.on') : this.$t('fineCut.off')
    },
    stateSound(): string {
      return this.soundOnStep ? this.$t('fineCut.on') : this.$t('fineCut.off')
    }
  },
  watch: {
    isOpen(open: boolean): void {
      if (open) {
        void nextTick(() => {
          this.observeWidth()
          this.focusPanel()
        })
      } else {
        this.resizeObserver?.disconnect()
        this.resizeObserver = null
        void nextTick(() => (document.getElementById(TRIGGER_ID) as HTMLElement | null)?.focus())
      }
    },
    innerWidth(): void {
      this.centerCut()
    },
    cutSrc(): void {
      this.centerCut()
    }
  },
  mounted() {
    // Capture phase on window: the view is modal, so editor shortcuts (Space, Delete, Ctrl+Z) must not see its keys.
    window.addEventListener('keydown', this.onWindowKeydown, true)
    document.addEventListener('fullscreenchange', this.onFullscreenChange)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onWindowKeydown, true)
    document.removeEventListener('fullscreenchange', this.onFullscreenChange)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
  },
  methods: {
    ...mapActions(useFineCutStore, [
      'close',
      'cutHere',
      'stepFrames',
      'jumpKeyframe',
      'jumpPause',
      'setZoom',
      'setSnap',
      'setSound',
      'dismissHint'
    ]),
    detail(frame: number): string {
      const time = formatTimecode(frameStart(Math.max(0, frame), this.fps), this.fps)
      return this.$t('fineCut.frameInfo', { frame: Math.max(0, frame), time })
    },
    panel(): HTMLElement | null {
      return (this.$refs.panel as HTMLElement | undefined) ?? null
    },
    focusables(): HTMLElement[] {
      return Array.from(this.panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    },
    /** Focus starts on the view itself, so a reflex Enter cuts instead of pressing a header button. */
    focusPanel(): void {
      this.panel()?.focus()
    },
    observeWidth(): void {
      const scroll = this.$refs.scroll as HTMLElement | undefined
      if (!scroll) return
      this.measure()
      if (typeof ResizeObserver === 'undefined') return
      this.resizeObserver?.disconnect()
      this.resizeObserver = new ResizeObserver(() => this.measure())
      this.resizeObserver.observe(scroll)
    },
    measure(): void {
      const scroll = this.$refs.scroll as HTMLElement | undefined
      if (scroll) this.viewport = scroll.clientWidth
    },
    /** Keeps the cut in the middle of the scrollable time axis. */
    centerCut(): void {
      void nextTick(() => {
        const scroll = this.$refs.scroll as HTMLElement | undefined
        if (scroll) scroll.scrollLeft = Math.max(0, (this.innerWidth - scroll.clientWidth) / 2)
      })
    },
    cut(): void {
      if (!this.primaryIsCut) return
      void this.cutHere()
    },
    /** The header's main action: cut when that is possible, otherwise just go back. */
    primary(): void {
      if (this.primaryIsCut) this.cut()
      else this.close()
    },
    onZoomInput(event: Event): void {
      this.setZoom(Number((event.target as HTMLInputElement).value))
    },
    toggleFullscreen(): void {
      try {
        if (document.fullscreenElement) {
          void document.exitFullscreen()
        } else {
          void this.panel()?.requestFullscreen?.()?.catch(() => undefined)
        }
      } catch {
        // Fullscreen is refused in some embedded contexts; the view still works.
      }
    },
    onFullscreenChange(): void {
      this.fullscreen = document.fullscreenElement === this.panel()
    },
    onWindowKeydown(event: KeyboardEvent): void {
      const store = useFineCutStore()
      if (!store.isOpen) return
      event.stopPropagation()
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Without a picture there is nothing to step through.
      if (!this.mediaReady && STEP_KEYS.has(event.key)) return
      const target = event.target as HTMLElement | null
      const onButton = target?.tagName === 'BUTTON'
      const onRange = target instanceof HTMLInputElement && target.type === 'range'
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          this.close()
          return
        case 'Tab':
          this.trapTab(event)
          return
        case 'ArrowLeft':
        case 'ArrowRight':
          if (onRange) return
          event.preventDefault()
          void this.stepFrames((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1))
          return
        case 'Enter':
          // Buttons keep their own Enter; elsewhere Enter cuts.
          if (onButton || target instanceof HTMLInputElement) return
          event.preventDefault()
          this.cut()
          return
        case 'k':
        case 'K':
          event.preventDefault()
          void this.jumpKeyframe(event.shiftKey ? -1 : 1)
          return
        case 'p':
        case 'P':
          event.preventDefault()
          void this.jumpPause(event.shiftKey ? -1 : 1)
          return
      }
    },
    /** Keeps Tab inside the view; focus cannot wander into the editor behind it. */
    trapTab(event: KeyboardEvent): void {
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
      v-if="isOpen"
      ref="panel"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-labelledby="titleId"
      class="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg text-fg"
    >
      <header class="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button
          type="button"
          data-testid="fine-back"
          class="flex min-h-12 items-center rounded-lg border-2 border-fill px-4 text-base font-bold hover:bg-panel2"
          @click="close"
        >
          <span aria-hidden="true" class="mr-2">←</span>{{ $t('fineCut.backToEditor') }}
        </button>
        <h2 :id="titleId" class="text-base font-bold">{{ $t('fineCut.title') }}</h2>
        <span class="max-w-[40vw] truncate rounded-full bg-panel2 px-2.5 py-1 font-mono text-xs text-muted">{{ chip }}</span>
        <span class="flex-1" />
        <button
          v-if="fullscreenSupported"
          type="button"
          class="min-h-11 rounded-lg border border-line px-3 text-sm font-semibold hover:bg-panel2"
          @click="toggleFullscreen"
        >
          {{ fullscreen ? $t('fineCut.exitFullscreen') : $t('fineCut.fullscreen') }}
        </button>
        <button
          type="button"
          data-testid="fine-primary"
          class="min-h-12 rounded-lg px-5 text-sm font-bold"
          :class="primaryIsCut ? 'bg-signal text-signal-fg' : 'border border-line bg-panel2'"
          @click="primary"
        >
          {{ primaryIsCut ? $t('fineCut.cutHere') : $t('fineCut.back') }}
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div
          v-if="hintVisible && mediaReady"
          role="note"
          data-testid="fine-hint"
          class="mx-auto flex w-full max-w-[980px] shrink-0 flex-wrap items-center gap-3 rounded-xl border border-fill bg-panel px-4 py-2 text-sm"
        >
          <p class="min-w-0 flex-1">{{ $t('fineCut.hintIntro') }}</p>
          <button
            type="button"
            class="min-h-11 rounded-lg border border-line px-4 font-semibold hover:bg-panel2"
            @click="dismissHint"
          >
            {{ $t('fineCut.hintDismiss') }}
          </button>
        </div>

        <p
          v-if="scanFraction !== null && mediaReady"
          role="status"
          data-testid="fine-preparing"
          class="mx-auto w-full max-w-[980px] shrink-0 text-sm text-muted"
        >
          {{ $t('fineCut.preparing', { percent: Math.round(scanFraction * 100) }) }}
        </p>

        <div
          v-if="!mediaReady"
          data-testid="fine-unavailable"
          role="alert"
          class="mx-auto flex min-h-64 w-full max-w-[980px] shrink-0 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-line bg-panel p-6 text-center"
        >
          <p class="max-w-md text-base font-semibold">{{ unavailableText }}</p>
          <button
            type="button"
            class="min-h-12 rounded-lg bg-fill px-5 text-sm font-bold text-fill-fg"
            @click="close"
          >
            {{ $t('fineCut.backToEditor') }}
          </button>
        </div>

        <div v-else class="mx-auto flex w-full max-w-[980px] shrink-0 flex-col gap-3 sm:flex-row">
          <FineCutFrame
            :asset-id="assetId ?? ''"
            :src-time="Math.max(0, cutSrc - frameMicros / 2)"
            :caption="$t('fineCut.before')"
            :detail="beforeDetail"
          />
          <FineCutFrame
            :asset-id="assetId ?? ''"
            :src-time="cutSrc"
            :caption="$t('fineCut.after')"
            :detail="afterDetail"
            :badge="$t('fineCut.cutBadge')"
          />
        </div>

        <div
          v-if="mediaReady"
          ref="scroll"
          class="relative mx-auto w-full max-w-[980px] shrink-0 overflow-x-auto rounded-xl border border-line bg-panel"
        >
          <div class="relative" :style="{ width: innerWidth + 'px' }">
            <FineCutStrip :width="innerWidth" :px="px" />
            <FineCutWaveform :width="innerWidth" :px="px" />
          </div>
        </div>

        <div v-if="mediaReady" class="mx-auto flex shrink-0 flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            class="flex min-h-11 items-center rounded-xl bg-panel2 px-3 text-sm font-semibold disabled:opacity-40"
            :disabled="!pauseEnabled"
            :aria-label="$t('fineCut.previousPause')"
            @click="jumpPause(-1)"
          >
            <Icon name="back" class="mr-1 size-4" />{{ $t('fineCut.pause') }}
          </button>
          <button
            type="button"
            class="flex min-h-11 items-center rounded-xl bg-panel2 px-3 text-sm font-semibold"
            :aria-label="$t('fineCut.previousKeyframe')"
            @click="jumpKeyframe(-1)"
          >
            <Icon name="back" class="mr-1 size-4" />{{ $t('fineCut.keyframe') }}
          </button>
          <button
            type="button"
            class="flex min-h-11 items-center rounded-xl bg-panel2 px-3 text-sm font-semibold"
            :aria-label="$t('fineCut.previousFrame')"
            @click="stepFrames(-1)"
          >
            <Icon name="back" class="mr-1 size-4" />{{ $t('fineCut.frame') }}
          </button>
          <button
            type="button"
            class="flex min-h-11 items-center rounded-xl bg-signal px-5 text-sm font-bold text-signal-fg disabled:opacity-40"
            :disabled="!canCut"
            :title="!canCut ? cutBlockedReason : undefined"
            @click="cut"
          >
            {{ $t('fineCut.cutHere') }}
          </button>
          <button
            type="button"
            class="flex min-h-11 items-center rounded-xl bg-panel2 px-3 text-sm font-semibold"
            :aria-label="$t('fineCut.nextFrame')"
            @click="stepFrames(1)"
          >
            {{ $t('fineCut.frame') }}<Icon name="fwd" class="ml-1 size-4" />
          </button>
          <button
            type="button"
            class="flex min-h-11 items-center rounded-xl bg-panel2 px-3 text-sm font-semibold"
            :aria-label="$t('fineCut.nextKeyframe')"
            @click="jumpKeyframe(1)"
          >
            {{ $t('fineCut.keyframe') }}<Icon name="fwd" class="ml-1 size-4" />
          </button>
          <button
            type="button"
            class="flex min-h-11 items-center rounded-xl bg-panel2 px-3 text-sm font-semibold disabled:opacity-40"
            :disabled="!pauseEnabled"
            :aria-label="$t('fineCut.nextPause')"
            @click="jumpPause(1)"
          >
            {{ $t('fineCut.pause') }}<Icon name="fwd" class="ml-1 size-4" />
          </button>
        </div>

        <p v-if="errorText" role="status" class="mx-auto shrink-0 text-center text-sm font-semibold text-[var(--jc-danger)]">{{ errorText }}</p>

        <div v-if="mediaReady" class="mx-auto flex w-full max-w-[980px] shrink-0 flex-wrap items-center justify-center gap-2 text-sm">
          <label class="flex items-center gap-2">
            <span class="font-semibold">{{ $t('fineCut.zoom') }}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              class="h-11 w-40 accent-[var(--jc-fill)]"
              :value="zoom"
              :aria-label="$t('fineCut.zoom')"
              :aria-valuetext="$t('fineCut.zoomValue', { px: zoomPx })"
              @input="onZoomInput"
            />
          </label>
          <span class="font-mono text-xs text-muted">{{ $t('fineCut.zoomValue', { px: zoomPx }) }}</span>
          <button
            type="button"
            role="switch"
            class="min-h-11 rounded-full border border-line px-3 text-xs font-semibold hover:bg-panel2"
            :class="snapKeyframes ? 'bg-fill text-fill-fg' : 'bg-panel2'"
            :aria-checked="snapKeyframes"
            @click="setSnap(!snapKeyframes)"
          >
            {{ $t('fineCut.snap', { state: stateSnap }) }}
          </button>
          <button
            type="button"
            role="switch"
            class="min-h-11 rounded-full border border-line px-3 text-xs font-semibold hover:bg-panel2"
            :class="soundOnStep ? 'bg-fill text-fill-fg' : 'bg-panel2'"
            :aria-checked="soundOnStep"
            @click="setSound(!soundOnStep)"
          >
            {{ $t('fineCut.sound', { state: stateSound }) }}
          </button>
          <span class="rounded-full bg-panel2 px-3 py-2 text-xs text-muted">{{ $t('fineCut.fade') }}</span>
        </div>

        <p v-if="mediaReady" class="mx-auto shrink-0 text-center text-xs text-muted">{{ $t('fineCut.hint') }}</p>
      </div>
    </div>
  </Teleport>
</template>
