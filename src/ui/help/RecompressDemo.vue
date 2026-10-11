<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import turtleUrl from '../../assets/photos/turtle.jpg'
import { meanDifferencePercent } from '../../core/learn/demo'
import { formatNumber } from '../numberFormat'

const W = 480
const H = 270
const AMPLIFY = 8
const MAX_PASSES = 30
const QUALITIES = [
  { id: 'good', value: 0.9 },
  { id: 'small', value: 0.6 },
  { id: 'tiny', value: 0.3 }
]

// Saves the picture again and again with a lossy encoder. Earlier passes are cached, so the slider stays fast.
export default defineComponent({
  name: 'RecompressDemo',
  data() {
    return {
      qualities: QUALITIES,
      qualityId: 'good',
      passes: 10,
      maxPasses: MAX_PASSES,
      amplify: AMPLIFY,
      W,
      H,
      status: 'loading' as 'loading' | 'working' | 'ready',
      seq: 0,
      work: null as HTMLCanvasElement | null,
      chain: markRaw([]) as ImageData[],
      drift: 0
    }
  },
  computed: {
    quality(): number {
      return QUALITIES.find((q) => q.id === this.qualityId)!.value
    }
  },
  watch: {
    qualityId() {
      this.chain = markRaw(this.chain.slice(0, 1))
      void this.extend()
    },
    passes() {
      void this.extend()
    }
  },
  async mounted() {
    const image = new Image()
    image.src = turtleUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0, W, H)
    const original = ctx.getImageData(0, 0, W, H)
    this.work = markRaw(canvas)
    this.chain = markRaw([original])
    this.put('original', original)
    await this.extend()
  },
  methods: {
    format(value: number, digits = 0): string {
      return formatNumber(value, digits)
    },
    put(name: 'original' | 'generation' | 'diff', data: ImageData): void {
      const canvas = this.$refs[name] as HTMLCanvasElement | undefined
      canvas?.getContext('2d')!.putImageData(data, 0, 0)
    },
    async extend(): Promise<void> {
      if (!this.work) return
      const seq = ++this.seq
      const ctx = this.work.getContext('2d', { willReadFrequently: true })!
      this.status = 'working'
      while (this.chain.length <= this.passes) {
        ctx.putImageData(this.chain[this.chain.length - 1]!, 0, 0)
        const blob = await new Promise<Blob | null>((resolve) => this.work!.toBlob(resolve, 'image/jpeg', this.quality))
        if (seq !== this.seq) return
        if (!blob) break
        const decoded = await createImageBitmap(blob)
        if (seq !== this.seq) return
        ctx.clearRect(0, 0, W, H)
        ctx.drawImage(decoded, 0, 0, W, H)
        this.chain.push(ctx.getImageData(0, 0, W, H))
      }
      this.status = 'ready'
      this.show()
    },
    show(): void {
      const original = this.chain[0]
      const generation = this.chain[this.passes]
      if (!original || !generation) return
      this.put('generation', generation)
      const diff = new ImageData(W, H)
      for (let i = 0; i < diff.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          diff.data[i + c] = Math.min(255, Math.abs(original.data[i + c]! - generation.data[i + c]!) * AMPLIFY)
        }
        diff.data[i + 3] = 255
      }
      this.put('diff', diff)
      this.drift = meanDifferencePercent(original.data, generation.data)
    }
  },
})
</script>

<template>
  <div class="space-y-5 rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <fieldset class="m-0 border-0 p-0">
      <legend class="text-sm font-semibold">{{ $t('help.encoding.loss.qualityLabel') }}</legend>
      <div class="mt-2 grid grid-cols-3 gap-2">
        <label
          v-for="quality in qualities"
          :key="quality.id"
          class="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-panel2 px-2 text-center text-sm font-semibold text-fg has-[:checked]:border-fill has-[:checked]:bg-panel has-[:checked]:ring-2 has-[:checked]:ring-fill has-[:focus-visible]:ring-2"
        >
          <input v-model="qualityId" type="radio" name="recompress-quality" :value="quality.id" class="sr-only" />
          <span>{{ $t(`export.qualities.${quality.id}`) }}</span>
        </label>
      </div>
    </fieldset>

    <label class="block">
      <span class="flex items-center justify-between gap-3 text-sm font-semibold">
        {{ $t('help.encoding.loss.passesLabel') }}
        <output class="tabular-nums text-muted" data-stat="passes">{{ passes }}</output>
      </span>
      <input v-model.number="passes" type="range" min="1" :max="maxPasses" step="1" class="mt-2 block h-11 w-full accent-fill" />
    </label>

    <div class="grid gap-4 sm:grid-cols-3">
      <figure class="m-0">
        <canvas ref="original" :width="W" :height="H" role="img" :aria-label="$t('help.encoding.loss.originalLabel')" class="block aspect-video w-full rounded-lg bg-panel2"></canvas>
        <figcaption class="mt-2 text-sm text-muted">{{ $t('help.encoding.loss.originalCaption') }}</figcaption>
      </figure>
      <figure class="m-0">
        <canvas ref="generation" :width="W" :height="H" role="img" :aria-label="$t('help.encoding.loss.generationLabel', { n: passes })" class="block aspect-video w-full rounded-lg bg-panel2"></canvas>
        <figcaption class="mt-2 text-sm text-muted">{{ $t('help.encoding.loss.generationCaption', { n: passes }) }}</figcaption>
      </figure>
      <figure class="m-0">
        <canvas ref="diff" :width="W" :height="H" role="img" :aria-label="$t('help.encoding.loss.diffLabel', { amplify: amplify })" class="block aspect-video w-full rounded-lg bg-panel2"></canvas>
        <figcaption class="mt-2 text-sm text-muted">{{ $t('help.encoding.loss.diffCaption', { amplify: amplify }) }}</figcaption>
      </figure>
    </div>

    <p class="text-sm" aria-live="polite">
      <span class="font-semibold" data-stat="drift">{{ $t('help.encoding.loss.drift', { percent: format(drift, 1) }) }}</span>
      <span class="text-muted"> · {{ status === 'ready' ? $t('help.encoding.loss.ready') : $t('help.encoding.loss.working') }}</span>
    </p>
  </div>
</template>
