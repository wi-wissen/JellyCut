<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'

export default defineComponent({
  name: 'TopBar',
  components: { Icon },
  data() {
    return { logoUrl: `${import.meta.env.BASE_URL}logo.svg` }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'resolvedDark'])
  },
  methods: {
    ...mapActions(useEditorStore, ['toggleTheme'])
  }
})
</script>

<template>
  <header class="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line bg-panel px-3">
    <div class="flex items-center gap-2 pr-1">
      <img :src="logoUrl" alt="" class="h-8 w-auto" />
      <span class="text-[15px] font-bold tracking-tight">{{ $t('app.name') }}</span>
    </div>

    <button
      type="button"
      class="flex h-8 items-center rounded-full border border-line bg-panel2 px-3 text-xs font-semibold"
    >
      {{ project.name }}
    </button>
    <button
      type="button"
      class="flex h-8 items-center gap-1.5 rounded-full border border-line bg-panel2 px-3 text-xs font-semibold"
    >
      <Icon name="ratio" class="size-3.5" />
      {{ project.format.ratio }}
    </button>

    <div class="ml-1 flex items-center">
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
        :aria-label="$t('top.undo')"
      >
        <Icon name="undo" class="size-5" />
      </button>
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
        :aria-label="$t('top.redo')"
      >
        <Icon name="redo" class="size-5" />
      </button>
    </div>

    <div class="flex-1" />

    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
      :aria-label="resolvedDark ? $t('top.lightMode') : $t('top.darkMode')"
      @click="toggleTheme"
    >
      <Icon :name="resolvedDark ? 'sun' : 'moon'" class="size-5" />
    </button>
    <button
      type="button"
      class="flex h-9 items-center rounded-lg bg-signal px-4 text-sm font-bold text-signal-fg"
    >
      {{ $t('top.export') }}
    </button>
  </header>
</template>
