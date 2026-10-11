<script lang="ts">
import { defineComponent } from 'vue'

export const REPO_URL = 'https://github.com/wi-wissen/JellyCut'

export default defineComponent({
  name: 'SiteFooter',
  data() {
    return { repoUrl: REPO_URL, version: __APP_VERSION__ }
  }
})
</script>

<template>
  <footer class="border-t border-line px-4 py-6 text-center text-sm text-muted">
    <p>
      {{ $t('site.footer.text') }}
      <a :href="repoUrl" target="_blank" rel="noopener noreferrer" class="font-semibold text-txt underline underline-offset-2">{{ $t('site.footer.github') }}</a>
      <span class="ml-1 text-xs tabular-nums text-muted" :aria-label="$t('site.version', { id: version })" :title="`Build ${version}`">v{{ version }}</span>
    </p>
  </footer>
</template>
