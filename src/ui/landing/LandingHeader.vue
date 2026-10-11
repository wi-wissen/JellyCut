<script lang="ts">
import { defineComponent } from 'vue'
import ThemeToggle from '../site/ThemeToggle.vue'
import logo from '../../assets/logo.svg'

export default defineComponent({
  name: 'LandingHeader',
  components: { ThemeToggle },
  data() {
    return { logo }
  }
})
</script>

<template>
  <header class="jc-header">
    <a class="jc-brand jc-display" href="./">
      <img :src="logo" alt="" width="34" height="34" />
      {{ $t('landing.brand') }}
    </a>
    <div class="jc-header__actions">
      <a class="jc-help-link" href="./help/">{{ $t('landing.help') }}</a>
      <ThemeToggle />
    </div>
  </header>
</template>
