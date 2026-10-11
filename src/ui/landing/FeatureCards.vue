<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'FeatureCards',
  data() {
    return { keys: ['cut', 'text', 'transitions', 'blur', 'record', 'export'] }
  }
})
</script>

<template>
  <ul class="jc-grid">
    <li v-for="(key, i) in keys" :key="key" class="jc-reveal" :style="{ '--jc-delay': `${i * 90}ms` }">
      <article class="jc-card">
        <div class="jc-card__icon" :class="`jc-card__icon--${key}`" aria-hidden="true">
          <svg v-if="key === 'cut'" viewBox="0 0 24 24" class="jc-icon"><circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" /><path d="M14.8 14.8 20 20" /></svg>
          <svg v-else-if="key === 'text'" viewBox="0 0 24 24" class="jc-icon"><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
          <svg v-else-if="key === 'transitions'" viewBox="0 0 24 24" class="jc-icon"><circle cx="9" cy="12" r="7" /><circle cx="15" cy="12" r="7" /></svg>
          <svg v-else-if="key === 'blur'" viewBox="0 0 24 24" class="jc-icon"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20" /></svg>
          <svg v-else-if="key === 'record'" viewBox="0 0 24 24" class="jc-icon"><circle cx="12" cy="12" r="8" /><circle class="jc-dot" cx="12" cy="12" r="3.5" /></svg>
          <svg v-else viewBox="0 0 24 24" class="jc-icon"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
        </div>
        <h3 class="jc-card__title jc-display">{{ $t(`landing.features.${key}.title`) }}</h3>
        <p class="jc-card__text">{{ $t(`landing.features.${key}.text`) }}</p>
      </article>
    </li>
  </ul>
</template>
