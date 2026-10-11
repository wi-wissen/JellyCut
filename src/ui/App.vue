<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({ name: 'App' })
</script>

<template>
  <div class="flex h-full items-center justify-center text-lg font-bold">{{ $t('app.name') }}</div>
</template>
