<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import RangeField from './RangeField.vue'
import ChoiceTile from './ChoiceTile.vue'
import { useEditorStore } from '../../stores/editor'
import { TRANSITION_TYPES, type TransitionType } from '../../../core/render/types'
import { secondsToMicros } from '../../../core/time'
import { formatNumber } from '../../numberFormat'

const DEFAULT_SECONDS = 0.5

export default defineComponent({
  name: 'TransitionsPanel',
  components: { RangeField, ChoiceTile },
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
      <ChoiceTile
        :label="$t('polish.transitions.none')"
        :selected="targetClip !== null && activeType === null"
        :disabled="!targetClip"
        aspect="aspect-[16/10]"
        data-testid="transition-tile-none"
        @choose="remove"
      >
        <span class="flex size-full items-center justify-center text-muted" aria-hidden="true">
          <svg viewBox="0 0 40 24" class="h-6 w-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M8 20 32 4" />
          </svg>
        </span>
      </ChoiceTile>
      <ChoiceTile
        v-for="type in types"
        :key="type"
        :label="typeName(type)"
        :selected="activeType === type"
        :disabled="!targetClip"
        aspect="aspect-[16/10]"
        :data-testid="`transition-tile-${type}`"
        @choose="apply(type)"
      >
        <span class="jc-preview absolute inset-0 block" :class="`type-${type}`" aria-hidden="true">
          <i class="a absolute inset-0" />
          <i class="b absolute inset-0" />
        </span>
      </ChoiceTile>
    </div>
  </div>
</template>

<style scoped>
/* Two colourful frames: A (warm, sun) leaves, B (cool, stripes) arrives. Each type animates one or both. */
.jc-preview .a {
  background:
    radial-gradient(circle at 74% 30%, #ffe27a 0 15%, transparent 16%),
    linear-gradient(150deg, #ff6b57 0%, #ff9f1c 100%);
}
.jc-preview .b {
  background:
    radial-gradient(circle at 28% 72%, rgb(255 255 255 / 0.55) 0 13%, transparent 14%),
    repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.2) 0 8px, transparent 8px 16px),
    linear-gradient(200deg, #1fb5a8 0%, #5b3fd9 100%);
}
.jc-preview .a,
.jc-preview .b {
  animation-duration: 1.2s;
  animation-timing-function: ease-in-out;
  /* Rest: frozen halfway through the effect, so the tile shows what the transition does. */
  animation-delay: -0.6s;
  animation-play-state: paused;
  animation-iteration-count: 1;
  animation-fill-mode: both;
}
/* Selected: plays once and keeps the end state. Hover or keyboard focus: loops while the pointer stays. */
.jc-tile[aria-pressed='true'] .jc-preview .a,
.jc-tile[aria-pressed='true'] .jc-preview .b {
  animation-delay: 0s;
  animation-play-state: running;
}
.jc-tile:hover .jc-preview .a,
.jc-tile:hover .jc-preview .b,
.jc-tile:focus-visible .jc-preview .a,
.jc-tile:focus-visible .jc-preview .b {
  animation-delay: 0s;
  animation-play-state: running;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}
.jc-tile:disabled .jc-preview .a,
.jc-tile:disabled .jc-preview .b {
  animation-play-state: paused;
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
  z-index: 1;
}
.type-zoomOut .b {
  z-index: 0;
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
  to { transform: scale(0.25); opacity: 0; }
}
@keyframes tr-blur {
  from { filter: blur(12px); opacity: 0; }
  to { filter: blur(0); opacity: 1; }
}

/* Reduced motion: no movement at all, the halfway frame stays on screen. */
@media (prefers-reduced-motion: reduce) {
  .jc-preview .a,
  .jc-preview .b {
    animation-play-state: paused !important;
    animation-delay: -0.6s !important;
    animation-iteration-count: 1 !important;
    animation-direction: normal !important;
  }
}
</style>
