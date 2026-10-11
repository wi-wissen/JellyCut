<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'SchoolStrip'
})
</script>

<template>
  <div class="jc-reveal">
    <h2 class="jc-display jc-h2">{{ $t('landing.school.title') }}</h2>
    <ul class="jc-school">
      <li>
        <span class="jc-school__icon" aria-hidden="true"><svg viewBox="0 0 24 24" class="jc-icon"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18" /></svg></span>
        <h3 class="jc-display">{{ $t('landing.school.browser.title') }}</h3>
        <p>{{ $t('landing.school.browser.text') }}</p>
      </li>
      <li>
        <span class="jc-school__icon" aria-hidden="true"><svg viewBox="0 0 24 24" class="jc-icon"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></svg></span>
        <h3 class="jc-display">{{ $t('landing.school.offline.title') }}</h3>
        <p>{{ $t('pwa.offline') }}</p>
      </li>
      <li>
        <span class="jc-school__icon" aria-hidden="true"><svg viewBox="0 0 24 24" class="jc-icon"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /></svg></span>
        <h3 class="jc-display">{{ $t('landing.school.guide.title') }}</h3>
        <p>{{ $t('landing.school.guide.text') }}</p>
        <a href="./help/">{{ $t('landing.school.guide.link') }}</a>
      </li>
    </ul>
  </div>
</template>
