<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useMediaStore } from '../stores/media'

const TITLE_ID = 'folder-project-title'
/** Element that had focus before the dialog opened; focus goes back there on close. */
let returnTarget: HTMLElement | null = null

/** Asks which project to open when an opened folder holds more than one project file. */
export default defineComponent({
  name: 'FolderProjectChoice',
  data() {
    return { titleId: TITLE_ID }
  },
  computed: {
    ...mapState(useMediaStore, ['folderChoice'])
  },
  watch: {
    folderChoice(value: unknown) {
      if (value) {
        returnTarget = document.activeElement as HTMLElement | null
        void nextTick(() => (this.$refs.panel as HTMLElement | undefined)?.querySelector<HTMLElement>('button')?.focus())
        return
      }
      const target = returnTarget
      returnTarget = null
      void nextTick(() => {
        if (target?.isConnected) target.focus()
      })
    }
  },
  mounted() {
    window.addEventListener('keydown', this.onWindowKeydown, true)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onWindowKeydown, true)
  },
  methods: {
    ...mapActions(useMediaStore, ['chooseFolderProject', 'cancelFolderChoice']),
    onWindowKeydown(event: KeyboardEvent): void {
      if (!this.folderChoice) return
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelFolderChoice()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from((this.$refs.panel as HTMLElement | undefined)?.querySelectorAll<HTMLElement>('button') ?? [])
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="folderChoice" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3">
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="w-full max-w-[420px] rounded-2xl border border-line bg-panel p-5 shadow-xl"
      >
        <h2 :id="titleId" class="text-base font-bold">{{ $t('relink.folder.choose.title') }}</h2>
        <p class="mt-2 text-sm text-fg">{{ $t('relink.folder.choose.text', { name: folderChoice.folder }) }}</p>
        <ul class="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
          <li v-for="name in folderChoice.names" :key="name">
            <button
              type="button"
              class="min-h-11 w-full rounded-lg border border-line px-3 text-left text-sm font-semibold hover:bg-panel2"
              @click="chooseFolderProject(name)"
            >
              {{ name }}
            </button>
          </li>
        </ul>
        <div class="mt-4 flex justify-end">
          <button type="button" class="min-h-11 rounded-lg px-4 text-sm font-semibold hover:bg-panel2" @click="cancelFolderChoice">
            {{ $t('relink.confirm.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
