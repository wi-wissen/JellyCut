<script lang="ts">
import { defineComponent } from 'vue'
import { mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'

const GRADIENTS = [
  'linear-gradient(135deg, var(--jc-track-video-1), var(--jc-fill))',
  'linear-gradient(135deg, var(--jc-track-video-2), var(--jc-track-video-3))',
  'linear-gradient(135deg, var(--jc-wave), var(--jc-track-video-1))'
]

export default defineComponent({
  name: 'LibraryPanel',
  components: { Icon },
  computed: {
    ...mapState(useEditorStore, ['mediaAssets']),
    sourcesHref(): string {
      return this.$router.resolve({ name: 'sources' }).href
    }
  },
  methods: {
    gradient(index: number): string {
      return GRADIENTS[index % GRADIENTS.length] ?? GRADIENTS[0] ?? ''
    }
  }
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-3 bg-panel p-3">
    <h2 class="text-sm font-bold">{{ $t('library.media') }}</h2>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="grid grid-cols-2 gap-2.5">
        <div
          v-for="(asset, index) in mediaAssets"
          :key="asset.id"
          class="relative aspect-[16/10] overflow-hidden rounded-lg"
          :style="{ background: gradient(index) }"
        >
          <span class="absolute bottom-1.5 left-2 right-2 truncate text-[11px] font-semibold text-white">
            {{ asset.name }}
          </span>
      </div>

      <button
        type="button"
        class="flex aspect-[16/10] items-center justify-center rounded-lg border-2 border-dashed border-line text-muted hover:border-fill hover:text-fg"
        :aria-label="$t('library.addMedia')"
      >
        <Icon name="plus" class="size-6" />
      </button>
      </div>
    </div>

    <a
      :href="sourcesHref"
      target="_blank"
      rel="noopener"
      class="shrink-0 self-start text-xs font-semibold text-txt underline underline-offset-2"
    >
      {{ $t('library.freeSources') }}
    </a>
  </section>
</template>
