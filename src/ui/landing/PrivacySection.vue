<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'PrivacySection'
})
</script>

<template>
  <div class="jc-privacy jc-reveal">
    <div>
      <h2 class="jc-display jc-h2">{{ $t('landing.privacy.title') }}</h2>
      <p>{{ $t('landing.privacy.text') }}</p>
      <ul class="jc-checks">
        <li><svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{{ $t('landing.privacy.account') }}</li>
        <li><svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{{ $t('landing.privacy.ads') }}</li>
        <li><svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{{ $t('landing.privacy.upload') }}</li>
      </ul>
    </div>
    <svg class="jc-art jc-reveal" viewBox="0 0 360 260" role="img" :aria-label="$t('landing.privacy.art')">
      <rect class="jc-art__device" x="30" y="30" width="200" height="150" rx="22" />
      <rect class="jc-art__screen" x="48" y="48" width="164" height="114" rx="12" />
      <rect class="jc-art__track" x="62" y="66" width="96" height="20" rx="6" />
      <rect class="jc-art__track--b" x="72" y="96" width="120" height="20" rx="6" />
      <rect class="jc-art__track--c" x="62" y="126" width="70" height="20" rx="6" />
      <path class="jc-art__arrow" d="M120 196 C 160 232 230 236 262 214" />
      <g class="jc-art__lock">
        <path class="jc-art__shackle" d="M216 124v-14a14 14 0 0 1 28 0v14" />
        <rect class="jc-art__lock-body" x="204" y="122" width="52" height="44" rx="12" />
        <circle class="jc-art__keyhole" cx="230" cy="140" r="5" />
      </g>
      <path class="jc-art__cloud" d="M262 214H316A10 10 0 0 0 316 194A15 15 0 0 0 290 186A12 12 0 0 0 268 198A8 8 0 0 0 262 214Z" />
      <path class="jc-art__slash" d="M254 226L326 176" />
    </svg>
  </div>
</template>
