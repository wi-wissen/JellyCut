<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions } from 'pinia'
import Icon from '../../Icon.vue'
import { useEditorStore } from '../../../stores/editor'

/** Duplicate and delete of the selected item (text or overlay). Both are undo steps. */
export default defineComponent({
  name: 'ItemActions',
  components: { Icon },
  methods: {
    ...mapActions(useEditorStore, ['duplicateSelected', 'deleteSelected'])
  }
})
</script>

<template>
  <div class="grid grid-cols-2 gap-2">
    <button
      type="button"
      class="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-panel2 text-xs font-semibold text-fg hover:bg-panel"
      @click="duplicateSelected"
    >
      <Icon name="copy" class="size-4" />
      {{ $t('design.duplicate') }}
    </button>
    <button
      type="button"
      class="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-panel2 text-xs font-semibold text-[var(--jc-danger)] hover:bg-panel"
      @click="deleteSelected"
    >
      <Icon name="trash" class="size-4" />
      {{ $t('design.delete') }}
    </button>
  </div>
</template>
