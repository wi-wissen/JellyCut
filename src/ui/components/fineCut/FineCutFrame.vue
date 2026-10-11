<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import { elementFallback, getAssetFile, getFrameProvider } from '../../stores/media'
import type { DecodedFrame } from '../../../engine/media/frames'

// Its own decoder lane, so the two images do not pull the preview decoder back and forth.
const LANE = 'fine-view'

export default defineComponent({
  name: 'FineCutFrame',
  props: {
    assetId: { type: String, required: true },
    srcTime: { type: Number, required: true },
    caption: { type: String, required: true },
    detail: { type: String, required: true },
    badge: { type: String, default: '' }
  },
  data() {
    return { loading: true, failed: false, token: 0, media: null as { el: HTMLVideoElement; url: string; assetId: string } | null }
  },
  watch: {
    srcTime(): void {
      void this.load()
    },
    assetId(): void {
      void this.load()
    }
  },
  mounted() {
    void this.load()
  },
  beforeUnmount() {
    this.releaseMedia()
  },
  methods: {
    /** The asset's own media element, only created when the exact picture is missing or black. */
    mediaElement(): HTMLVideoElement | null {
      if (this.media && (this.media.assetId !== this.assetId || this.media.el.error)) this.releaseMedia()
      if (this.media) return this.media.el
      const file = getAssetFile(this.assetId)
      if (!file) return null
      const el = document.createElement('video')
      el.playsInline = true
      el.muted = true
      el.preload = 'auto'
      const url = URL.createObjectURL(file)
      el.src = url
      this.media = markRaw({ el, url, assetId: this.assetId })
      return el
    },
    releaseMedia(): void {
      if (!this.media) return
      this.media.el.removeAttribute('src')
      this.media.el.load()
      URL.revokeObjectURL(this.media.url)
      this.media = null
    },
    async load(): Promise<void> {
      const token = ++this.token
      this.loading = true
      this.failed = false
      let exact: DecodedFrame | null = null
      let threw = false
      try {
        exact = await getFrameProvider().getFrame(this.assetId, this.srcTime, LANE)
      } catch {
        threw = true
      }
      const frame = await elementFallback.pick(this.assetId, this.srcTime, exact, threw, () => this.mediaElement())
      if (token !== this.token) return
      const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
      if (frame && canvas) {
        const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width
        const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')?.drawImage(frame, 0, 0)
        canvas.dataset.fallback = frame === exact ? '' : 'element'
      }
      this.failed = !frame
      this.loading = false
    }
  }
})
</script>

<template>
  <figure class="m-0 flex min-w-0 flex-1 flex-col gap-1.5">
    <div class="relative overflow-hidden rounded-lg border-2 bg-panel2" :class="badge ? 'border-fill' : 'border-line'">
      <canvas ref="canvas" data-testid="fine-frame" class="block aspect-video h-auto w-full bg-stage object-contain" :aria-label="caption" role="img" />
      <span
        v-if="loading"
        class="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted"
        role="status"
      >
        {{ $t('fineCut.loadingFrame') }}
      </span>
      <span
        v-else-if="failed"
        class="absolute inset-0 flex items-center justify-center p-3 text-center text-sm font-semibold"
        role="status"
      >
        {{ $t('fineCut.frameFailed') }}
      </span>
      <span
        v-if="badge"
        class="absolute right-2 top-2 rounded-md bg-fill px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-fill-fg"
      >
        {{ badge }}
      </span>
    </div>
    <figcaption class="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
      <span class="font-semibold">{{ caption }}</span>
      <span class="font-mono tabular-nums text-muted">{{ detail }}</span>
    </figcaption>
  </figure>
</template>
