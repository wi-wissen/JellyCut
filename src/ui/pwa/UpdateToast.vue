<script lang="ts">
import { defineComponent } from 'vue'
import { applyUpdate, isUpdateReady, onUpdateReady } from '../../platform/offline'

export default defineComponent({
  name: 'UpdateToast',
  data() {
    return { visible: isUpdateReady(), stop: null as null | (() => void) }
  },
  mounted() {
    this.stop = onUpdateReady(() => {
      this.visible = true
    })
  },
  beforeUnmount() {
    this.stop?.()
  },
  methods: {
    reload(): void {
      applyUpdate()
    }
  }
})
</script>

<template>
  <div
    v-if="visible"
    role="status"
    class="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-2 text-sm text-fg shadow-lg"
  >
    <span>{{ $t('pwa.updateAvailable') }}</span>
    <button
      type="button"
      class="min-h-[44px] rounded-md px-3 font-bold text-txt hover:bg-panel2"
      @click="reload"
    >
      {{ $t('pwa.reload') }}
    </button>
  </div>
</template>
