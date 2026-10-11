<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({ name: 'LandingView' })
</script>

<template>
  <main class="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
    <h1 class="text-4xl font-bold">{{ $t('landing.title') }}</h1>
    <p class="max-w-md text-base text-muted">{{ $t('landing.tagline') }}</p>
    <a
      href="./app/"
      class="inline-flex min-h-[44px] items-center rounded-lg bg-signal px-6 font-bold text-signal-fg"
    >
      {{ $t('landing.open') }}
    </a>
    <p class="max-w-md text-sm text-muted">{{ $t('pwa.offline') }}</p>
    <p class="text-xs text-muted">{{ $t('landing.soon') }}</p>
  </main>
</template>
