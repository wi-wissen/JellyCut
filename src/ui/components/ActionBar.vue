<script lang="ts">
import { defineComponent } from 'vue'
import { mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'

interface ActionDef {
  key: 'split' | 'fineCut' | 'duplicate' | 'flip' | 'rotate' | 'speed' | 'mute' | 'delete'
  icon: string
  hot?: boolean
}

const ACTIONS: ActionDef[] = [
  { key: 'split', icon: 'split', hot: true },
  { key: 'fineCut', icon: 'crop' },
  { key: 'duplicate', icon: 'copy' },
  { key: 'flip', icon: 'flip' },
  { key: 'rotate', icon: 'rotate' },
  { key: 'speed', icon: 'speed' },
  { key: 'mute', icon: 'mute' },
  { key: 'delete', icon: 'trash' }
]

export default defineComponent({
  name: 'ActionBar',
  components: { Icon },
  data() {
    return { actions: ACTIONS }
  },
  computed: {
    ...mapState(useEditorStore, ['timecode'])
  }
})
</script>

<template>
  <div class="flex shrink-0 flex-wrap items-center gap-0.5 border-y border-line bg-panel px-2 py-1.5">
    <button
      type="button"
      class="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill text-fill-fg"
      :aria-label="$t('actions.play')"
    >
      <Icon name="play" class="size-[18px]" />
    </button>
    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
      :aria-label="$t('actions.frameBack')"
    >
      <Icon name="back" class="size-[18px]" />
    </button>
    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
      :aria-label="$t('actions.frameForward')"
    >
      <Icon name="fwd" class="size-[18px]" />
    </button>
    <span class="px-1.5 font-mono text-[13px] font-medium tabular-nums">{{ timecode }}</span>

    <span class="mx-1 h-9 w-px bg-line" aria-hidden="true" />

    <button
      v-for="action in actions"
      :key="action.key"
      type="button"
      class="flex min-h-11 min-w-[50px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-[10.5px] font-semibold hover:bg-panel2"
      :class="action.hot ? 'bg-signal text-signal-fg hover:bg-signal' : 'text-fg'"
    >
      <Icon :name="action.icon" class="size-[18px]" />
      <span>{{ $t(`actions.${action.key}`) }}</span>
    </button>
  </div>
</template>
