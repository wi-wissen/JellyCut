<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useMediaStore } from '../stores/media'

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
const TITLE_ID = 'remove-asset-title'

/** Small confirmation before a media file that is used on the timeline is removed. */
export default defineComponent({
  name: 'RemoveAssetConfirm',
  data() {
    return { titleId: TITLE_ID }
  },
  computed: {
    ...mapState(useMediaStore, ['pendingRemoval']),
    clipText(): string {
      const count = this.pendingRemoval?.clips ?? 0
      return this.$t('relink.confirm.clips', { count }, count)
    },
    musicText(): string {
      return this.$t('relink.confirm.music', { count: this.pendingRemoval?.music ?? 0 })
    }
  },
  watch: {
    pendingRemoval(value: unknown) {
      if (value) void nextTick(() => this.focusCancel())
    }
  },
  mounted() {
    window.addEventListener('keydown', this.onWindowKeydown, true)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onWindowKeydown, true)
  },
  methods: {
    ...mapActions(useMediaStore, ['confirmRemoval', 'cancelRemoval']),
    panel(): HTMLElement | null {
      return (this.$refs.panel as HTMLElement | undefined) ?? null
    },
    focusCancel(): void {
      const cancel = this.panel()?.querySelector<HTMLElement>('[data-cancel]')
      cancel?.focus()
    },
    onWindowKeydown(event: KeyboardEvent): void {
      if (!this.pendingRemoval) return
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelRemoval()
        return
      }
      if (event.key !== 'Tab') return
      // Only two buttons: keep focus between them.
      const items = Array.from(this.panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="pendingRemoval" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3">
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="`${titleId}-text`"
        class="w-full max-w-[400px] rounded-2xl border border-line bg-panel p-5 shadow-xl"
      >
        <h2 :id="titleId" class="text-base font-bold">{{ $t('relink.confirm.title') }}</h2>
        <p :id="`${titleId}-text`" class="mt-2 text-sm text-fg">
          <span class="block">{{ clipText }}</span>
          <span v-if="pendingRemoval && pendingRemoval.music > 0" class="mt-1 block text-muted">{{ musicText }}</span>
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-cancel
            class="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold hover:bg-panel2"
            @click="cancelRemoval"
          >
            {{ $t('relink.confirm.cancel') }}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-lg bg-[var(--jc-danger)] px-4 text-sm font-semibold text-white"
            @click="confirmRemoval"
          >
            {{ $t('relink.confirm.remove') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
