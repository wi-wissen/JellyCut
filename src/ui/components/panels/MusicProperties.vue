<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions, mapState } from 'pinia'
import BackLink from './BackLink.vue'
import RangeField from './RangeField.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { useEditorStore } from '../../stores/editor'
import type { MusicItem } from '../../../core/project/types'
import { secondsToMicros } from '../../../core/time'
import { formatNumber } from '../../numberFormat'

export default defineComponent({
  name: 'MusicProperties',
  components: { BackLink, RangeField, ToggleSwitch },
  props: {
    item: { type: Object as PropType<MusicItem>, required: true }
  },
  computed: {
    ...mapState(useEditorStore, ['project']),
    name(): string {
      return this.project.assets.find((a) => a.id === this.item.assetId)?.name ?? ''
    },
    header(): string {
      return this.$t('music.header', { name: this.name })
    },
    volumePercent(): number {
      return Math.round(this.item.volume * 100)
    },
    fadeInSeconds(): number {
      return Math.round(this.item.fadeIn / 100_000) / 10
    },
    fadeOutSeconds(): number {
      return Math.round(this.item.fadeOut / 100_000) / 10
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['updateSelectedMusic', 'endGesture']),
    toggleSound(): void {
      this.updateSelectedMusic({ muted: !this.item.muted })
    },
    keyFor(field: string): string {
      return `music-${field}:${this.item.id}`
    },
    seconds(value: number): string {
      return this.$t('units.seconds', { value: formatNumber(value, 1) })
    },
    onVolume(percent: number): void {
      this.updateSelectedMusic({ volume: percent / 100 }, this.keyFor('volume'))
    },
    onFadeIn(seconds: number): void {
      this.updateSelectedMusic({ fadeIn: secondsToMicros(seconds) }, this.keyFor('fadeIn'))
    },
    onFadeOut(seconds: number): void {
      this.updateSelectedMusic({ fadeOut: secondsToMicros(seconds) }, this.keyFor('fadeOut'))
    },
    endEdit(): void {
      this.endGesture()
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
    <BackLink />
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ header }}</h2>

    <section class="flex flex-col gap-3 rounded-[10px] border border-line bg-bg p-3">
      <ToggleSwitch
        :label="$t('music.sound')"
        :state-text="item.muted ? $t('timeline.off') : $t('timeline.on')"
        :checked="!item.muted"
        @toggle="toggleSound"
      />
      <RangeField
        :label="$t('music.volume')"
        :model-value="volumePercent"
        :min="0"
        :max="200"
        :display="$t('units.percent', { value: volumePercent })"
        @update="onVolume"
        @commit="endEdit"
      />
    </section>

    <section class="flex flex-col gap-3 rounded-[10px] border border-line bg-bg p-3">
      <RangeField
        :label="$t('music.fadeIn')"
        :model-value="fadeInSeconds"
        :min="0"
        :max="5"
        :step="0.1"
        :display="seconds(fadeInSeconds)"
        @update="onFadeIn"
        @commit="endEdit"
      />
      <RangeField
        :label="$t('music.fadeOut')"
        :model-value="fadeOutSeconds"
        :min="0"
        :max="5"
        :step="0.1"
        :display="seconds(fadeOutSeconds)"
        @update="onFadeOut"
        @commit="endEdit"
      />
    </section>
  </div>
</template>
