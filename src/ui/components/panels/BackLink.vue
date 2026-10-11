<script lang="ts">
import { defineComponent } from 'vue'
import Icon from '../Icon.vue'
import { mapActions } from 'pinia'
import { useEditorStore } from '../../stores/editor'

export default defineComponent({
  name: 'BackLink',
  components: { Icon },
  props: {
    /** Empty means the library; a selected item says "Back" instead. */
    label: { type: String, default: '' }
  },
  methods: {
    ...mapActions(useEditorStore, ['select'])
  }
})
</script>

<template>
  <button
    type="button"
    class="flex min-h-11 items-center gap-1.5 self-start rounded-lg pr-2 text-[13px] font-semibold text-txt hover:bg-panel2"
    @click="select(null)"
  >
    <Icon name="back" class="size-4" />
    {{ label || $t('leftPanel.backToLibrary') }}
  </button>
</template>
