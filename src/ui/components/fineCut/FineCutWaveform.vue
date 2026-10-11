<script lang="ts">
import { defineComponent } from 'vue'
import { mapState } from 'pinia'
import { useFineCutStore } from '../../stores/fineCut'
import { useEditorStore } from '../../stores/editor'
import { peaksForRange, type Pause } from '../../../core/audio/peaks'

const HEIGHT = 96

interface PauseView {
  key: string
  left: number
  width: number
  label: string
}

export default defineComponent({
  name: 'FineCutWaveform',
  props: {
    /** Width of the whole time axis in CSS pixels; the cut sits in the middle. */
    width: { type: Number, required: true },
    /** Pixels per frame at the current zoom. */
    px: { type: Number, required: true }
  },
  data() {
    return { height: HEIGHT }
  },
  computed: {
    ...mapState(useFineCutStore, [
      'cutSrc',
      'frameMicros',
      'pauses',
      'hasAudio',
      'waveformLoading',
      'waveformFraction',
      'waveformRevision'
    ]),
    ...mapState(useEditorStore, ['resolvedDark']),
    locale(): string {
      return this.$i18n.locale
    },
    cutX(): number {
      return this.width / 2
    },
    pauseViews(): PauseView[] {
      const formatter = new Intl.NumberFormat(this.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const scale = this.px / this.frameMicros
      return (this.pauses as Pause[])
        .map((p, i) => {
          const left = this.cutX + (p.start - this.cutSrc) * scale
          const width = (p.end - p.start) * scale
          return {
            key: `${i}-${p.start}`,
            left,
            width,
            label: this.$t('fineCut.pauseLabel', { seconds: formatter.format((p.end - p.start) / 1_000_000) })
          }
        })
        .filter((v) => v.left + v.width > 0 && v.left < this.width)
    }
  },
  watch: {
    width(): void {
      this.draw()
    },
    px(): void {
      this.draw()
    },
    cutSrc(): void {
      this.draw()
    },
    waveformRevision(): void {
      this.draw()
    },
    resolvedDark(): void {
      this.draw()
    }
  },
  mounted() {
    this.draw()
  },
  methods: {
    draw(): void {
      const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(this.width))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(this.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, this.height)
      const data = useFineCutStore().waveformData()
      const wf = data?.waveform
      if (!wf) return
      // Source time per pixel. The visible span is centred on the cut.
      const perPx = this.frameMicros / this.px
      const start = this.cutSrc - this.cutX * perPx
      const end = this.cutSrc + (w - this.cutX) * perPx
      const peaks = peaksForRange(wf, start, end, w)
      const style = getComputedStyle(canvas)
      const wave = style.getPropertyValue('--jc-wave').trim() || '#2e9e63'
      ctx.fillStyle = wave
      const mid = this.height / 2
      for (let x = 0; x < w; x++) {
        const amp = Math.min(1, peaks[x] ?? 0)
        const h = Math.max(1, amp * (this.height - 8))
        ctx.fillRect(x, mid - h / 2, 1, h)
      }
    }
  }
})
</script>

<template>
  <div class="relative overflow-hidden" :style="{ width: width + 'px', height: height + 'px' }">
    <canvas ref="canvas" data-testid="fine-waveform" class="block" :style="{ width: width + 'px', height: height + 'px' }" aria-hidden="true" />
    <div
      v-for="p in pauseViews"
      :key="p.key"
      data-pause
      class="pointer-events-none absolute inset-y-0 overflow-hidden bg-signal/35"
      :style="{ left: p.left + 'px', width: Math.max(2, p.width) + 'px' }"
    >
      <span class="block truncate px-1 pt-0.5 text-[11px] font-semibold text-fg">{{ p.label }}</span>
    </div>
    <div class="pointer-events-none absolute inset-y-0 w-0.5 bg-signal" :style="{ left: cutX - 1 + 'px' }" aria-hidden="true" />
    <p
      v-if="hasAudio === false"
      class="absolute inset-0 flex items-center justify-center text-sm font-semibold text-muted"
      role="status"
    >
      {{ $t('fineCut.noSound') }}
    </p>
    <div
      v-if="waveformLoading"
      class="absolute bottom-0 left-0 h-1 bg-fill transition-[width]"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(waveformFraction * 100)"
      :aria-label="$t('fineCut.waveformLoading')"
      :style="{ width: Math.round(waveformFraction * 100) + '%' }"
    />
  </div>
</template>
