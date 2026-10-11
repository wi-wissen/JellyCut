<script lang="ts">
import { defineComponent } from 'vue'
import { mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'

export default defineComponent({
  name: 'PlayerStage',
  computed: {
    ...mapState(useEditorStore, ['subtitle'])
  }
})
</script>

<template>
  <section class="relative flex min-h-0 flex-1 items-center justify-center bg-stage p-3.5 [container-type:size]">
    <div
      class="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden rounded-xl"
      style="background: linear-gradient(135deg, var(--jc-track-video-1), var(--jc-fill) 55%, var(--jc-track-video-2))"
    >
      <button
        type="button"
        class="absolute right-2.5 top-2.5 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold text-white"
      >
        {{ $t('player.fitFill') }}
      </button>

      <p class="absolute inset-x-3 bottom-[7%] text-center text-[clamp(14px,4.2cqw,26px)] font-bold leading-tight text-white">
        {{ subtitle.lead }}
        <span v-if="subtitle.accent" class="rounded-md bg-signal px-1.5 text-signal-fg">{{ subtitle.accent }}</span>
      </p>
    </div>
  </section>
</template>
