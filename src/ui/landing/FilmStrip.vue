<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'FilmStrip',
  data() {
    return {
      frames: [
        { key: 'cut', tone: 'violet' },
        { key: 'text', tone: 'lime' },
        { key: 'transitions', tone: 'amber' },
        { key: 'filter', tone: 'teal' },
        { key: 'sticker', tone: 'rose' },
        { key: 'export', tone: 'lime' }
      ]
    }
  }
})
</script>

<template>
  <div class="jc-strip" aria-hidden="true">
    <div class="jc-strip__track">
      <div v-for="copy in 2" :key="copy" class="jc-strip__set">
        <span v-for="(frame, i) in frames" :key="frame.key" class="jc-strip__frame" :class="`jc-strip__frame--${frame.tone}`">
          <small>{{ String(i + 1).padStart(2, '0') }}</small>
          {{ $t(`landing.strip.${frame.key}`) }}
        </span>
      </div>
    </div>
  </div>
</template>
