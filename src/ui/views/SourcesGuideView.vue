<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'SourcesGuideView',
  data() {
    return { sections: ['images', 'music', 'videos', 'credits'] as const }
  }
})
</script>

<template>
  <main class="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-8">
    <h1 class="text-2xl font-bold">{{ $t('guide.sourcesTitle') }}</h1>
    <p class="mt-3 text-base text-muted">{{ $t('guide.sourcesIntro') }}</p>
    <section v-for="key in sections" :key="key" class="mt-6">
      <h2 class="text-lg font-semibold">{{ $t(`guide.${key}`) }}</h2>
      <p class="mt-1 text-sm text-muted">{{ $t('guide.todo') }}</p>
    </section>
  </main>
</template>
