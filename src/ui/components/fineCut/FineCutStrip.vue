<script lang="ts">
import { defineComponent } from 'vue'
import { mapState } from 'pinia'
import { useFineCutStore } from '../../stores/fineCut'
import { getFrameProvider } from '../../stores/media'
import type { DecodedFrame } from '../../../engine/media/frames'
import { frameIndexLabel, timelineToSrc } from '../../../core/timeline/fineCut'
import { frameDuration, type Micros } from '../../../core/time'

/** Frames shown on each side of the cut: at least 8, and as many as fill the visible span (up to 64). */
const HALF_MIN = 8
const HALF_MAX = 64
const TILE_HEIGHT = 56
/** Decoded frames are kept this small; the tiles only need a thumbnail. */
const THUMB_WIDTH = 160
const CACHE_LIMIT = 96
const LANE = 'fine-strip'

interface Tile {
  frame: number
  src: Micros
  key: boolean
  /** Position relative to the cut, in frames. */
  offset: number
}

// Not reactive: decoded thumbnails and the tile canvases are DOM and pixel data.
const thumbs = new Map<number, HTMLCanvasElement>()
const canvases = new Map<number, HTMLCanvasElement>()

function paint(target: HTMLCanvasElement, source: HTMLCanvasElement, tileWidth: number): void {
  const dpr = window.devicePixelRatio || 1
  target.width = Math.max(1, Math.round(tileWidth * dpr))
  target.height = Math.max(1, Math.round(TILE_HEIGHT * dpr))
  const ctx = target.getContext('2d')
  if (!ctx) return
  // Cover: fill the tile and crop the overflow centred.
  const scale = Math.max(target.width / source.width, target.height / source.height)
  const w = source.width * scale
  const h = source.height * scale
  ctx.drawImage(source, (target.width - w) / 2, (target.height - h) / 2, w, h)
}

export default defineComponent({
  name: 'FineCutStrip',
  props: {
    /** Width of the whole time axis in CSS pixels. */
    width: { type: Number, required: true },
    /** Pixels per frame at the current zoom. */
    px: { type: Number, required: true }
  },
  data() {
    return { tiles: [] as Tile[], queue: [] as { frame: number; src: Micros }[], pumping: false, assetKey: '' }
  },
  computed: {
    ...mapState(useFineCutStore, ['cutSrc', 'fps', 'assetId', 'keyframeTimes', 'frameMicros']),
    innerWidth(): number {
      return Math.max(this.width, 16 * this.px)
    },
    cutX(): number {
      return this.innerWidth / 2
    },
    half(): number {
      return Math.min(HALF_MAX, Math.max(HALF_MIN, Math.ceil(this.cutX / this.px) + 1))
    }
  },
  watch: {
    cutSrc(): void {
      this.refresh()
    },
    keyframeTimes(): void {
      this.refresh()
    },
    assetId(): void {
      thumbs.clear()
      this.refresh()
    },
    px(): void {
      this.refresh()
    },
    innerWidth(): void {
      this.refresh()
    }
  },
  mounted() {
    this.refresh()
  },
  beforeUnmount() {
    canvases.clear()
  },
  methods: {
    refresh(): void {
      const clip = useFineCutStore().clip
      if (!clip || !this.assetId) {
        this.tiles = []
        return
      }
      const fl = this.frameMicros
      const half = this.half
      const tiles: Tile[] = []
      for (let offset = -half; offset < half; offset++) {
        const src = Math.max(0, this.cutSrc + offset * fl)
        const key = this.keyframeTimes.some((k) => Math.abs(k - src) < fl / 2)
        tiles.push({ frame: frameIndexLabel(src, this.fps), src, key, offset })
      }
      this.tiles = tiles
      // Nearest tiles first: the cut matters most.
      const order = [...tiles].sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))
      this.queue = order.filter((t) => !thumbs.has(t.frame)).map((t) => ({ frame: t.frame, src: t.src }))
      this.repaintAll()
      void this.pump()
    },
    async pump(): Promise<void> {
      if (this.pumping) return
      this.pumping = true
      try {
        while (this.queue.length > 0) {
          const job = this.queue.shift()!
          if (thumbs.has(job.frame) || !this.tiles.some((t) => t.frame === job.frame)) continue
          const assetId = this.assetId
          if (!assetId) break
          let frame: DecodedFrame | null = null
          try {
            frame = await getFrameProvider().getFrame(assetId, job.src, LANE)
          } catch {
            frame = null
          }
          if (!frame || assetId !== this.assetId) continue
          const small = document.createElement('canvas')
          const scale = Math.min(1, THUMB_WIDTH / frame.width)
          small.width = Math.max(1, Math.round(frame.width * scale))
          small.height = Math.max(1, Math.round(frame.height * scale))
          small.getContext('2d')?.drawImage(frame, 0, 0, small.width, small.height)
          if (thumbs.size >= CACHE_LIMIT) {
            const oldest = thumbs.keys().next().value
            if (oldest !== undefined) thumbs.delete(oldest)
          }
          thumbs.set(job.frame, small)
          this.paintFrame(job.frame)
        }
      } finally {
        this.pumping = false
      }
    },
    bind(frame: number, el: HTMLCanvasElement | null): void {
      if (!el) return
      canvases.set(frame, el)
      this.paintFrame(frame)
    },
    paintFrame(frame: number): void {
      const target = canvases.get(frame)
      const source = thumbs.get(frame)
      if (target && source) paint(target, source, this.px)
    },
    repaintAll(): void {
      for (const t of this.tiles) this.paintFrame(t.frame)
    }
  }
})
</script>

<template>
  <div class="relative overflow-hidden" :style="{ width: innerWidth + 'px', height: '56px' }">
    <div
      v-for="tile in tiles"
      :key="tile.frame"
      data-testid="fine-tile"
      :data-key="tile.key ? 'true' : 'false'"
      class="absolute top-0 flex h-14 flex-col overflow-hidden border-r border-line/60"
      :class="tile.key ? 'bg-fill/20' : 'bg-panel2'"
      :style="{ left: cutX + tile.offset * px + 'px', width: px + 'px' }"
    >
      <canvas :ref="(el) => bind(tile.frame, el as HTMLCanvasElement | null)" class="block h-14 w-full" aria-hidden="true" />
      <span
        class="absolute bottom-0 left-0 right-0 truncate bg-bg/70 px-0.5 text-center font-mono text-[9px] leading-tight"
        :class="tile.key ? 'font-bold text-txt' : 'text-muted'"
      >
        {{ tile.key ? $t('fineCut.keyTile', { n: tile.frame }) : $t('fineCut.frameTile', { n: tile.frame }) }}
      </span>
    </div>
    <div class="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-signal" :style="{ left: cutX - 1 + 'px' }" aria-hidden="true" />
  </div>
</template>
