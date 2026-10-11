<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import RangeField from './RangeField.vue'
import { useEditorStore } from '../../stores/editor'
import { TRANSITION_TYPES, type TransitionType } from '../../../core/render/types'
import { secondsToMicros } from '../../../core/time'
import { formatNumber } from '../../numberFormat'

const DEFAULT_SECONDS = 0.5

export default defineComponent({
  name: 'TransitionsPanel',
  components: { RangeField },
  data() {
    return { types: TRANSITION_TYPES, seconds: DEFAULT_SECONDS }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'transitionTargetId']),
    targetClip(): { id: string; name: string; transitionIn: { type: string; duration: number } | null } | null {
      const id = this.transitionTargetId
      if (!id) return null
      const clip = this.project.clips.find((c) => c.id === id)
      if (!clip) return null
      return {
        id,
        name: this.project.assets.find((a) => a.id === clip.assetId)?.name ?? '',
        transitionIn: clip.transitionIn
      }
    },
    activeType(): string | null {
      return this.targetClip?.transitionIn?.type ?? null
    },
    durationDisplay(): string {
      return this.$t('units.seconds', { value: formatNumber(this.seconds, 1) })
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['applyTransition', 'removeTransition', 'endGesture']),
    apply(type: TransitionType): void {
      this.applyTransition(type, secondsToMicros(this.seconds))
    },
    /** While a transition is set on the target, dragging the duration changes that transition. */
    onDuration(seconds: number): void {
      this.seconds = seconds
      const target = this.targetClip
      if (!target?.transitionIn) return
      this.applyTransition(target.transitionIn.type as TransitionType, secondsToMicros(seconds), `transition-duration:${target.id}`)
    },
    remove(): void {
      if (this.targetClip) this.removeTransition(this.targetClip.id)
    },
    endEdit(): void {
      this.endGesture()
    },
    typeName(type: string): string {
      return this.$t(`transitions.types.${type}`)
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('transitions.title') }}</h2>

    <p v-if="!targetClip" class="rounded-lg bg-panel2 p-3 text-xs font-semibold text-fg">
      {{ $t('transitions.pickClip') }}
    </p>

    <section class="flex flex-col gap-2 rounded-[10px] border border-line bg-bg p-3">
      <RangeField
        :label="$t('transitions.duration')"
        :model-value="seconds"
        :min="0.1"
        :max="2"
        :step="0.1"
        :display="durationDisplay"
        @update="onDuration"
        @commit="endEdit"
      />
      <p v-if="targetClip" class="text-xs text-muted">{{ $t('transitions.target', { name: targetClip.name }) }}</p>
    </section>

    <div class="grid grid-cols-2 gap-2.5" role="group" :aria-label="$t('transitions.title')">
      <button
        v-for="type in types"
        :key="type"
        type="button"
        class="flex flex-col gap-1.5 rounded-lg text-left disabled:opacity-50"
        :disabled="!targetClip"
        :aria-pressed="activeType === type"
        @click="apply(type)"
      >
        <span class="jc-preview relative block aspect-[16/10] w-full overflow-hidden rounded-lg bg-stage" :class="`type-${type}`" aria-hidden="true">
          <i class="a absolute inset-0" />
          <i class="b absolute inset-0" />
        </span>
        <span class="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="activeType === type ? 'bg-fill' : 'bg-transparent'"
            aria-hidden="true"
          />
          {{ typeName(type) }}
        </span>
      </button>
    </div>

    <button
      v-if="activeType"
      type="button"
      class="min-h-11 self-start rounded-lg px-3 text-xs font-semibold text-txt hover:bg-panel2"
      @click="remove"
    >
      {{ $t('transitions.remove') }}
    </button>
  </div>
</template>

<style scoped>
.jc-preview .a {
  background: var(--jc-track-video-1);
}
.jc-preview .b {
  background: var(--jc-track-video-2);
}
.jc-preview .a,
.jc-preview .b {
  animation-duration: 1.8s;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}

.type-fade .b {
  animation-name: tr-fade;
}
.type-wipeLeft .b {
  animation-name: tr-wipe-left;
}
.type-wipeRight .b {
  animation-name: tr-wipe-right;
}
.type-wipeUp .b {
  animation-name: tr-wipe-up;
}
.type-wipeDown .b {
  animation-name: tr-wipe-down;
}
.type-slideLeft .a {
  animation-name: tr-slide-out-left;
}
.type-slideLeft .b {
  animation-name: tr-slide-in-left;
}
.type-slideRight .a {
  animation-name: tr-slide-out-right;
}
.type-slideRight .b {
  animation-name: tr-slide-in-right;
}
.type-zoomIn .b {
  animation-name: tr-zoom-in;
}
.type-zoomOut .a {
  animation-name: tr-zoom-out;
}
.type-blur .b {
  animation-name: tr-blur;
}

@keyframes tr-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes tr-wipe-left {
  from { clip-path: inset(0 0 0 100%); }
  to { clip-path: inset(0 0 0 0); }
}
@keyframes tr-wipe-right {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}
@keyframes tr-wipe-up {
  from { clip-path: inset(100% 0 0 0); }
  to { clip-path: inset(0 0 0 0); }
}
@keyframes tr-wipe-down {
  from { clip-path: inset(0 0 100% 0); }
  to { clip-path: inset(0 0 0 0); }
}
@keyframes tr-slide-out-left {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
}
@keyframes tr-slide-in-left {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
@keyframes tr-slide-out-right {
  from { transform: translateX(0); }
  to { transform: translateX(100%); }
}
@keyframes tr-slide-in-right {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
@keyframes tr-zoom-in {
  from { transform: scale(0.3); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes tr-zoom-out {
  from { transform: scale(1); opacity: 1; }
  to { transform: scale(0.3); opacity: 0; }
}
@keyframes tr-blur {
  from { filter: blur(10px); opacity: 0; }
  to { filter: blur(0); opacity: 1; }
}

/* Reduced motion: one still frame with the two colours side by side. */
@media (prefers-reduced-motion: reduce) {
  .jc-preview .a,
  .jc-preview .b {
    animation: none !important;
  }
  .jc-preview .b {
    clip-path: inset(0 50% 0 0);
  }
}
</style>
