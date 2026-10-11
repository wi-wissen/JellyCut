<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import BackLink from './BackLink.vue'
import RangeField from './RangeField.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { useEditorStore } from '../../stores/editor'
import { SPEED_STEPS, speedStepIndex } from '../../../core/timeline/speed'
import { canHaveTransition } from '../../../core/timeline/transitionOps'
import { isFilterId } from '../../../core/filters/filters'
import type { Clip } from '../../../core/project/types'
import { formatNumber } from '../../numberFormat'

export default defineComponent({
  name: 'ClipPanel',
  components: { BackLink, RangeField, ToggleSwitch },
  data() {
    return { speedSteps: SPEED_STEPS }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'selectedClip']),
    clip(): Clip | null {
      return this.selectedClip
    },
    header(): string {
      const clip = this.clip
      const name = clip ? (this.project.assets.find((a) => a.id === clip.assetId)?.name ?? '') : ''
      return this.$t('clip.header', { name })
    },
    isFirst(): boolean {
      return this.clip !== null && !canHaveTransition(this.project, this.clip.id)
    },
    zoomPercent(): number {
      return Math.round((this.clip?.transform.scale ?? 1) * 100)
    },
    volumePercent(): number {
      return Math.round((this.clip?.volume ?? 1) * 100)
    },
    speedIndex(): number {
      return speedStepIndex(this.clip?.speed ?? 1)
    },
    speedText(): string {
      return this.$t('units.tempo', { value: formatNumber(this.clip?.speed ?? 1, 2) })
    },
    transitionType(): string | null {
      return this.clip?.transitionIn?.type ?? null
    },
    filterSummary(): string {
      const id = this.clip?.filter
      if (!isFilterId(id) || id === 'none') return this.$t('clip.filterNone')
      return this.$t('clip.filterSummary', { name: this.$t(`filters.names.${id}`) })
    },
    transitionSummary(): string {
      const t = this.clip?.transitionIn
      if (!t) return this.$t('clip.noTransition')
      const seconds = this.$t('units.seconds', { value: formatNumber(t.duration / 1_000_000, 1) })
      return this.$t('clip.transitionSummary', { name: this.$t(`transitions.types.${t.type}`), seconds })
    }
  },
  methods: {
    ...mapActions(useEditorStore, [
      'setSelectedClipProps',
      'removeTransition',
      'setActiveTab',
      'setActiveGroup',
      'endGesture'
    ]),
    keyFor(field: string): string {
      return `clip-${field}:${this.clip?.id ?? ''}`
    },
    onZoom(percent: number): void {
      this.setSelectedClipProps({ transform: { scale: percent / 100 } }, this.keyFor('zoom'))
    },
    onVolume(percent: number): void {
      this.setSelectedClipProps({ volume: percent / 100 }, this.keyFor('volume'))
    },
    toggleOriginalAudio(): void {
      if (this.clip) this.setSelectedClipProps({ muted: !this.clip.muted })
    },
    onSpeed(index: number): void {
      const speed = SPEED_STEPS[Math.round(index)]
      if (speed !== undefined) this.setSelectedClipProps({ speed }, this.keyFor('speed'))
    },
    openTransitions(): void {
      this.setActiveGroup('look', 'transitions')
    },
    openFilters(): void {
      this.setActiveGroup('look', 'filter')
    },
    removeCut(): void {
      if (this.clip) this.removeTransition(this.clip.id)
    },
    endEdit(): void {
      this.endGesture()
    }
  }
})
</script>

<template>
  <div v-if="clip" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <BackLink />
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ header }}</h2>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('clip.picture') }}</h3>
      <RangeField
        :label="$t('clip.zoom')"
        :model-value="zoomPercent"
        :min="25"
        :max="400"
        :display="$t('units.percent', { value: zoomPercent })"
        @update="onZoom"
        @commit="endEdit"
      />
    </section>

    <section class="flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('clip.sound') }}</h3>
      <RangeField
        :label="$t('clip.volume')"
        :model-value="volumePercent"
        :min="0"
        :max="200"
        :display="$t('units.percent', { value: volumePercent })"
        @update="onVolume"
        @commit="endEdit"
      />
      <ToggleSwitch
        :label="$t('clip.originalAudio')"
        :state-text="clip.muted ? $t('timeline.off') : $t('timeline.on')"
        :checked="!clip.muted"
        @toggle="toggleOriginalAudio"
      />
    </section>

    <section class="flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('clip.timing') }}</h3>
      <RangeField
        :label="$t('clip.tempo')"
        :model-value="speedIndex"
        :min="0"
        :max="speedSteps.length - 1"
        :step="1"
        :display="speedText"
        @update="onSpeed"
        @commit="endEdit"
      />
    </section>

    <section class="flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('clip.filter') }}</h3>
      <p class="text-xs text-muted" data-testid="filter-summary">{{ filterSummary }}</p>
      <div>
        <button
          type="button"
          class="min-h-11 rounded-lg bg-panel2 px-3 text-xs font-semibold text-fg hover:bg-panel"
          @click="openFilters"
        >
          {{ $t('clip.filterChange') }}
        </button>
      </div>
    </section>

    <section class="flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('clip.transition') }}</h3>
      <p v-if="isFirst" class="text-xs text-muted">{{ $t('clip.firstClip') }}</p>
      <template v-else>
        <p class="text-xs text-muted" data-testid="transition-summary">{{ transitionSummary }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="min-h-11 rounded-lg bg-panel2 px-3 text-xs font-semibold text-fg hover:bg-panel"
            @click="openTransitions"
          >
            {{ $t('clip.transitionChange') }}
          </button>
          <button
            v-if="transitionType"
            type="button"
            class="min-h-11 rounded-lg px-3 text-xs font-semibold text-txt hover:bg-panel2"
            @click="removeCut"
          >
            {{ $t('clip.transitionRemove') }}
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
