<script lang="ts">
import { defineComponent } from 'vue'
import turtle from '../../assets/photos/turtle.jpg'
import { fineHover, motionAllowed } from './motion'

// A looping 10 s demo built from CSS keyframes. The pointer only tilts it and shifts the photo.
export default defineComponent({
  name: 'HeroMock',
  data() {
    return { photo: turtle }
  },
  mounted() {
    if (!fineHover() || !motionAllowed()) return
    this.$el.addEventListener('pointermove', this.aim)
    this.$el.addEventListener('pointerleave', this.reset)
  },
  unmounted() {
    this.$el.removeEventListener('pointermove', this.aim)
    this.$el.removeEventListener('pointerleave', this.reset)
  },
  methods: {
    aim(event: PointerEvent): void {
      const box = (this.$el as HTMLElement).getBoundingClientRect()
      this.set((event.clientX - box.left) / box.width - 0.5, (event.clientY - box.top) / box.height - 0.5)
    },
    reset(): void {
      this.set(0, 0)
    },
    set(x: number, y: number): void {
      const style = (this.$el as HTMLElement).style
      style.setProperty('--jc-px', x.toFixed(3))
      style.setProperty('--jc-py', y.toFixed(3))
    }
  }
})
</script>

<template>
  <div class="jc-mock" role="img" :aria-label="$t('landing.mock.label')">
    <div class="jc-mock__window" aria-hidden="true">
      <div class="jc-mock__bar">
        <i></i><i></i><i></i>
        <span>{{ $t('landing.mock.project') }}</span>
      </div>
      <div class="jc-mock__screen">
        <div class="jc-mock__parallax">
          <img class="jc-mock__photo" :src="photo" alt="" />
        </div>
        <div class="jc-mock__scene-b">
          <img class="jc-mock__photo" :src="photo" alt="" />
        </div>
        <span class="jc-mock__wipe"></span>
        <span class="jc-mock__sticker">{{ $t('landing.mock.sticker') }}</span>
      </div>
      <div class="jc-mock__timeline">
        <div class="jc-mock__toolbar">
          <span class="jc-mock__play">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
          </span>
          <span class="jc-mock__tool">
            <svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" /><path d="M14.8 14.8 20 20" /></svg>
          </span>
          <span class="jc-mock__tool">
            <svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
          </span>
          <span class="jc-mock__tool jc-mock__tool--hot">
            <svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><circle cx="9" cy="12" r="7" /><circle cx="15" cy="12" r="7" /></svg>
          </span>
        </div>
        <div class="jc-mock__tracks">
          <div class="jc-mock__track">
            <span class="jc-mock__clip jc-mock__clip--text">{{ $t('landing.mock.text') }}</span>
          </div>
          <div class="jc-mock__track">
            <span class="jc-mock__clip jc-mock__clip--1" style="--jc-d: 0">{{ $t('landing.mock.clipIntro') }}</span>
            <span class="jc-mock__clip jc-mock__clip--2" style="--jc-d: 0.3">{{ $t('landing.mock.clipTurtle') }}</span>
            <span class="jc-mock__clip jc-mock__clip--3" style="--jc-d: 0.6">{{ $t('landing.mock.clipReef') }}</span>
          </div>
          <div class="jc-mock__track jc-mock__track--audio">
            <span class="jc-mock__wave"></span>
          </div>
          <span class="jc-mock__playhead"></span>
        </div>
      </div>
    </div>
  </div>
</template>
