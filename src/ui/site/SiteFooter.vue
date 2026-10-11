<script lang="ts">
import { defineComponent } from 'vue'

export const REPO_URL = 'https://github.com/wi-wissen/JellyCut'

export default defineComponent({
  name: 'SiteFooter',
  data() {
    return { repoUrl: REPO_URL }
  }
})
</script>

<template>
  <footer class="border-t border-line px-4 py-6 text-center text-sm text-muted">
    <p>
      {{ $t('site.footer.text') }}
      <a :href="repoUrl" target="_blank" rel="noopener noreferrer" class="font-semibold text-txt underline underline-offset-2">{{ $t('site.footer.github') }}</a>
    </p>
  </footer>
</template>
