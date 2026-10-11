<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore } from '../stores/editor'
import { useFineCutStore } from '../stores/fineCut'
import { clipForFineCut } from '../../core/timeline/fineCut'

type ActionKey = 'split' | 'fineCut' | 'duplicate' | 'flip' | 'rotate' | 'speed' | 'mute' | 'delete'

interface ActionDef {
  key: ActionKey
  icon: string
  hot?: boolean
}

const ACTIONS: ActionDef[] = [
  { key: 'split', icon: 'split', hot: true },
  { key: 'fineCut', icon: 'fineCut' },
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
    ...mapState(useEditorStore, ['timecode', 'isPlaying', 'selection', 'selectedClip', 'canSplitAtPlayhead', 'project', 'playheadMicros']),
    playLabel(): string {
      return this.$t(this.isPlaying ? 'actions.pause' : 'actions.play')
    },
    speedValue(): string {
      return this.selectedClip ? `${this.selectedClip.speed}×` : this.$t('actions.speed')
    }
  },
  methods: {
    ...mapActions(useFineCutStore, { openFineCut: 'open' }),
    ...mapActions(useEditorStore, [
      'togglePlaying',
      'stepFrame',
      'splitAtPlayhead',
      'duplicateSelected',
      'deleteSelected',
      'flipSelected',
      'rotateSelected',
      'cycleSpeedSelected',
      'toggleMuteSelected'
    ]),
    /** Actions that need a suitable selection are disabled (aria-disabled) without one. */
    enabled(key: ActionKey): boolean {
      switch (key) {
        case 'split':
          return this.canSplitAtPlayhead
        case 'fineCut':
          return clipForFineCut(this.project, this.playheadMicros, this.selection) !== null
        case 'duplicate':
        case 'delete':
          return this.selection !== null
        case 'flip':
        case 'rotate':
        case 'speed':
        case 'mute':
          return this.selectedClip !== null
      }
    },
    pressed(key: ActionKey): boolean | undefined {
      if (key === 'mute') return this.selectedClip?.muted ?? false
      if (key === 'flip') return this.selectedClip?.transform.flipX ?? false
      return undefined
    },
    run(key: ActionKey) {
      if (!this.enabled(key)) return
      switch (key) {
        case 'split':
          this.splitAtPlayhead()
          break
        case 'duplicate':
          this.duplicateSelected()
          break
        case 'delete':
          this.deleteSelected()
          break
        case 'flip':
          this.flipSelected()
          break
        case 'rotate':
          this.rotateSelected()
          break
        case 'speed':
          this.cycleSpeedSelected()
          break
        case 'mute':
          this.toggleMuteSelected()
          break
        case 'fineCut':
          void this.openFineCut()
          break
      }
    }
  }
})
</script>

<template>
  <div class="flex shrink-0 flex-wrap items-center gap-0.5 border-y border-line bg-panel px-2 py-1.5">
    <button
      type="button"
      class="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill text-fill-fg"
      :aria-label="playLabel"
      :aria-pressed="isPlaying"
      @click="togglePlaying"
    >
      <Icon :name="isPlaying ? 'pause' : 'play'" class="size-[18px]" />
    </button>
    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
      :aria-label="$t('actions.frameBack')"
      @click="stepFrame(-1)"
    >
      <Icon name="back" class="size-[18px]" />
    </button>
    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-lg text-fg hover:bg-panel2"
      :aria-label="$t('actions.frameForward')"
      @click="stepFrame(1)"
    >
      <Icon name="fwd" class="size-[18px]" />
    </button>
    <span class="px-1.5 font-mono text-[13px] font-medium tabular-nums">{{ timecode }}</span>

    <span class="mx-1 h-9 w-px bg-line" aria-hidden="true" />

    <button
      v-for="action in actions"
      :key="action.key"
      type="button"
      class="flex min-h-11 min-w-[50px] flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 text-[10.5px] font-semibold"
      :class="[
        action.hot ? 'bg-signal text-signal-fg hover:bg-signal' : 'text-fg hover:bg-panel2',
        enabled(action.key) ? '' : 'cursor-not-allowed opacity-40'
      ]"
      :id="action.key === 'fineCut' ? 'fine-cut-button' : undefined"
      :aria-haspopup="action.key === 'fineCut' ? 'dialog' : undefined"
      :aria-disabled="!enabled(action.key)"
      :aria-pressed="pressed(action.key)"
      :aria-label="action.key === 'speed' ? `${$t('actions.speed')}: ${speedValue}` : undefined"
      @click="run(action.key)"
    >
      <Icon :name="action.icon" class="size-[18px]" />
      <span>{{ action.key === 'speed' ? speedValue : $t(`actions.${action.key}`) }}</span>
    </button>
  </div>
</template>
