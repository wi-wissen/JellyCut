<script lang="ts">
import { defineComponent } from 'vue'
import { fineHover, motionAllowed } from './motion'

// The wrapper follows the pointer a little (magnetic); the link itself keeps its hover style.
export default defineComponent({
  name: 'CtaButton',
  props: {
    href: { type: String, required: true },
    label: { type: String, required: true }
  },
  mounted() {
    if (!fineHover() || !motionAllowed()) return
    this.$el.addEventListener('pointermove', this.follow)
    this.$el.addEventListener('pointerleave', this.release)
  },
  unmounted() {
    this.$el.removeEventListener('pointermove', this.follow)
    this.$el.removeEventListener('pointerleave', this.release)
  },
  methods: {
    follow(event: PointerEvent): void {
      const box = (this.$el as HTMLElement).getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2)
      const dy = event.clientY - (box.top + box.height / 2)
      ;(this.$el as HTMLElement).style.transform = `translate(${dx * 0.2}px, ${dy * 0.3}px)`
    },
    release(): void {
      ;(this.$el as HTMLElement).style.transform = ''
    }
  }
})
</script>

<template>
  <span class="jc-magnet">
    <a :href="href" class="jc-cta">
      <span>{{ label }}</span>
      <svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true" focusable="false">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </a>
  </span>
</template>
