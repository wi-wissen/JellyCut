<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import { animatedFrameIndex, animatedSticker, sheetCell } from '../../../core/render/stickerAnimations'
import { animatedSheetBitmap, loadAnimatedSheet } from '../../../engine/render/stickerAnimations'
import { subscribeToTicks } from './animationTicker'

/**
 * The moving version of a picture sticker, drawn from its sprite sheet. The sheet is only requested once the tile
 * is (nearly) on screen; until it is decoded the still picture below stays visible. With "reduce motion" the
 * first frame is shown and nothing moves.
 */
export default defineComponent({
  name: 'StickerAnimation',
  props: {
    id: { type: String, required: true }
  },
  data() {
    // Plain bookkeeping, not reactive (an observer must not be wrapped in a proxy).
    return { ready: false, state: markRaw({ observer: null as IntersectionObserver | null, stop: null as (() => void) | null, gone: false, shown: -1 }) }
  },
  mounted() {
    const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
    if (!canvas || typeof IntersectionObserver === 'undefined') {
      void this.start()
      return
    }
    const state = this.state
    state.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          state.observer?.disconnect()
          state.observer = null
          void this.start()
        }
      },
      { rootMargin: '120px' }
    )
    state.observer.observe(canvas)
  },
  beforeUnmount() {
    this.state.observer?.disconnect()
    this.state.stop?.()
    this.state.gone = true
  },
  methods: {
    async start(): Promise<void> {
      if (!(await loadAnimatedSheet(this.id)) || this.state.gone) return
      this.ready = true
      this.draw(0)
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reduced) this.state.stop = subscribeToTicks((now) => this.draw(Math.round(now * 1000)))
    },
    draw(micros: number): void {
      const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
      const animation = animatedSticker(this.id)
      const bitmap = animatedSheetBitmap(this.id)
      const ctx = canvas?.getContext('2d')
      if (!canvas || !animation || !bitmap || !ctx) return
      const index = animatedFrameIndex(micros, animation.loopMicros, animation.frames)
      if (index === this.state.shown) return
      this.state.shown = index
      const { col, row } = sheetCell(animation, index)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, col * animation.cell, row * animation.cell, animation.cell, animation.cell, 0, 0, canvas.width, canvas.height)
    }
  }
})
</script>

<template>
  <canvas
    ref="canvas"
    width="128"
    height="128"
    aria-hidden="true"
    data-sticker-animation
    :data-sticker-animation-id="id"
    :style="{ visibility: ready ? 'visible' : 'hidden' }"
  />
</template>
