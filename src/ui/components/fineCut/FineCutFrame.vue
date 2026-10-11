<script lang="ts">
import { defineComponent } from 'vue'
import { getFrameProvider } from '../../stores/media'
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
    return { loading: true, token: 0 }
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
  methods: {
    async load(): Promise<void> {
      const token = ++this.token
      this.loading = true
      let frame: DecodedFrame | null = null
      try {
        frame = await getFrameProvider().getFrame(this.assetId, this.srcTime, LANE)
      } catch {
        frame = null
      }
      if (token !== this.token) return
      const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
      if (frame && canvas) {
        canvas.width = frame.width
        canvas.height = frame.height
        canvas.getContext('2d')?.drawImage(frame, 0, 0)
      }
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
