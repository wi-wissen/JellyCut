<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import turtleUrl from '../../assets/photos/turtle.jpg'
import { formatNumber } from '../numberFormat'

const WIDTH = 800
const HEIGHT = 447
// Zoomed detail: the turtle's head, in the 800 px picture.
const CROP = { x: 530, y: 140, w: 96, h: 72 }
const ZOOM = 4
const BLOCK = 8

// Lossy compression with the browser's JPEG encoder: the lower the quality, the more detail is lost.
export default defineComponent({
  name: 'JpegQualityDemo',
  data() {
    return {
      quality: 25,
      grid: false,
      ready: false,
      base: null as HTMLCanvasElement | null,
      sizeBytes: 0,
      seq: 0,
      cropWidth: CROP.w * ZOOM,
      cropHeight: CROP.h * ZOOM,
      rawKilobytes: (WIDTH * HEIGHT * 3) / 1000
    }
  },
  watch: {
    quality() {
      void this.encode()
    },
    grid() {
      void this.encode()
    }
  },
  async mounted() {
    const image = new Image()
    image.src = turtleUrl
    await image.decode()
    const base = document.createElement('canvas')
    base.width = WIDTH
    base.height = HEIGHT
    base.getContext('2d')!.drawImage(image, 0, 0, WIDTH, HEIGHT)
    this.base = markRaw(base)
    this.drawOriginal()
    this.ready = true
    await this.encode()
  },
  methods: {
    format(value: number, digits = 0): string {
      return formatNumber(value, digits)
    },
    drawOriginal(): void {
      if (!this.base) return
      const ctx = (this.$refs.original as HTMLCanvasElement).getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this.base, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, this.cropWidth, this.cropHeight)
    },
    async encode(): Promise<void> {
      if (!this.base) return
      const seq = ++this.seq
      const blob = await new Promise<Blob | null>((resolve) => this.base!.toBlob(resolve, 'image/jpeg', this.quality / 100))
      if (!blob || seq !== this.seq) return
      const decoded = await createImageBitmap(blob)
      if (seq !== this.seq) return
      const canvas = this.$refs.compressed as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(decoded, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, this.cropWidth, this.cropHeight)
      if (this.grid) {
        ctx.strokeStyle = 'rgba(109, 76, 245, 0.8)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = Math.ceil(CROP.x / BLOCK) * BLOCK; x < CROP.x + CROP.w; x += BLOCK) {
          const px = (x - CROP.x) * ZOOM + 0.5
          ctx.moveTo(px, 0)
          ctx.lineTo(px, this.cropHeight)
        }
        for (let y = Math.ceil(CROP.y / BLOCK) * BLOCK; y < CROP.y + CROP.h; y += BLOCK) {
          const py = (y - CROP.y) * ZOOM + 0.5
          ctx.moveTo(0, py)
          ctx.lineTo(this.cropWidth, py)
        }
        ctx.stroke()
      }
      this.sizeBytes = blob.size
    }
  },
  computed: {
    sizeText(): string {
      return this.$t('help.compression.jpeg.size', { value: this.format(this.sizeBytes / 1000) })
    },
    rawText(): string {
      return this.$t('help.compression.jpeg.raw', { value: this.format(this.rawKilobytes / 1000, 1) })
    }
  }
})
</script>

<template>
  <div class="space-y-5 rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <div class="grid gap-4 sm:grid-cols-2">
      <figure class="m-0">
        <canvas
          ref="original"
          :width="cropWidth"
          :height="cropHeight"
          role="img"
          :aria-label="$t('help.compression.jpeg.originalLabel')"
          class="block aspect-[4/3] w-full rounded-lg bg-panel2"
        ></canvas>
        <figcaption class="mt-2 text-sm text-muted">{{ $t('help.compression.jpeg.originalCaption') }}</figcaption>
      </figure>
      <figure class="m-0">
        <canvas
          ref="compressed"
          :width="cropWidth"
          :height="cropHeight"
          role="img"
          :aria-label="$t('help.compression.jpeg.compressedLabel', { quality: quality })"
          class="block aspect-[4/3] w-full rounded-lg bg-panel2"
        ></canvas>
        <figcaption class="mt-2 text-sm text-muted">{{ $t('help.compression.jpeg.compressedCaption', { quality: quality }) }}</figcaption>
      </figure>
    </div>

    <label class="block">
      <span class="flex items-center justify-between gap-3 text-sm font-semibold">
        {{ $t('help.compression.jpeg.qualityLabel') }}
        <output class="tabular-nums text-muted" data-stat="quality">{{ quality }} %</output>
      </span>
      <input v-model.number="quality" type="range" min="5" max="100" step="1" class="mt-2 block h-11 w-full accent-fill" />
    </label>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <label class="inline-flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input v-model="grid" type="checkbox" class="size-5 accent-fill" />
        <span>{{ $t('help.compression.jpeg.grid') }}</span>
      </label>
      <p class="text-sm tabular-nums" data-stat="size" aria-live="polite">
        <span class="font-semibold">{{ sizeText }}</span>
        <span class="text-muted"> · {{ rawText }}</span>
      </p>
    </div>
  </div>
</template>
