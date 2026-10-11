<script lang="ts">
import { defineComponent } from 'vue'
import { mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'

export default defineComponent({
  name: 'PlayerToolbar',
  components: { Icon },
  computed: {
    ...mapState(useEditorStore, ['project'])
  }
})
</script>

<template>
  <div class="flex gap-1.5 text-[11px] font-semibold text-white">
    <button type="button" class="flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1" :aria-label="$t('player.ratio')">
      <Icon name="ratio" class="size-3.5" />
      {{ project.format.ratio }}
    </button>
    <button type="button" class="rounded-full bg-black/35 px-2.5 py-1">
      {{ $t('player.fitFill') }}
    </button>
  </div>
</template>
