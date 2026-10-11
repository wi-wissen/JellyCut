<script lang="ts">
import { defineComponent } from 'vue'
import { mapState } from 'pinia'
import Icon from './Icon.vue'
import { useEditorStore, type TimelineSpan } from '../stores/editor'

/** Width of the track label column; the ruler and playhead are offset by it. */
const LABEL_COLUMN = '124px'

interface TrackRow {
  id: string
  icon: string
  label: string
  kind: 'text' | 'overlay' | 'video' | 'audio' | 'music'
  spans: TimelineSpan[]
}

export default defineComponent({
  name: 'TimelinePanel',
  components: { Icon },
  data() {
    return { zoom: 50, snapping: true, labelColumn: LABEL_COLUMN }
  },
  computed: {
    ...mapState(useEditorStore, ['videoSpans', 'originalAudioSpans', 'textSpans', 'musicSpans', 'rulerTicks', 'playheadPct']),
    rows(): TrackRow[] {
      return [
        { id: 'text', icon: 'text', label: 'timeline.text', kind: 'text', spans: this.textSpans },
        { id: 'overlay', icon: 'sticker', label: 'timeline.overlay', kind: 'overlay', spans: [] },
        { id: 'video', icon: 'media', label: 'timeline.video', kind: 'video', spans: this.videoSpans },
        { id: 'originalAudio', icon: 'audio', label: 'timeline.originalAudio', kind: 'audio', spans: this.originalAudioSpans },
        { id: 'music', icon: 'audio', label: 'timeline.music', kind: 'music', spans: this.musicSpans }
      ]
    },
    playheadLeft(): string {
      return `calc(${LABEL_COLUMN} + (100% - ${LABEL_COLUMN}) * ${this.playheadPct / 100})`
    }
  },
  methods: {
    laneStyle(span: TimelineSpan, kind: TrackRow['kind']): Record<string, string> {
      const background = {
        text: 'var(--jc-fill)',
        overlay: 'var(--jc-fill)',
        video: `var(--jc-track-video-${span.tone ?? 1})`,
        audio:
          'repeating-linear-gradient(90deg, color-mix(in srgb, var(--jc-wave) 60%, transparent) 0 3px, transparent 3px 6px), color-mix(in srgb, var(--jc-wave) 22%, var(--jc-panel2))',
        music: 'var(--jc-music)'
      }[kind]
      return {
        left: `${span.leftPct}%`,
        width: `${span.widthPct}%`,
        background,
        color: kind === 'audio' ? 'var(--jc-fg)' : '#ffffff',
        boxShadow: 'inset 0 0 0 1px var(--jc-panel)'
      }
    }
  }
})
</script>

<template>
  <section class="flex shrink-0 flex-col border-t border-line bg-panel">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-md"
        :class="snapping ? 'bg-fill text-fill-fg' : 'text-muted hover:bg-panel2'"
        :aria-label="$t('timeline.magnet')"
        :aria-pressed="snapping"
        @click="snapping = !snapping"
      >
        <Icon name="magnet" class="size-4" />
      </button>
      <span class="text-xs font-semibold text-muted">{{ $t('timeline.snapOn') }}</span>

      <div class="flex-1" />

      <button type="button" class="flex size-8 items-center justify-center rounded-md text-muted hover:bg-panel2" :aria-label="$t('timeline.zoomOut')">
        <Icon name="zoom" class="size-4" />
      </button>
      <input
        v-model.number="zoom"
        type="range"
        min="0"
        max="100"
        class="w-28 accent-fill"
        :aria-label="$t('timeline.zoom')"
      />
      <button type="button" class="flex size-8 items-center justify-center rounded-md text-muted hover:bg-panel2" :aria-label="$t('timeline.fit')">
        <Icon name="fit" class="size-4" />
      </button>
    </div>

    <div class="relative">
      <div class="flex h-[22px] border-b border-line">
        <div class="shrink-0 border-r border-line" :style="{ width: labelColumn }" />
        <div class="relative flex-1">
          <span
            v-for="tick in rulerTicks"
            :key="tick.label + tick.leftPct"
            class="absolute top-0 h-full border-l border-line pl-1 font-mono text-[10px] leading-[22px] text-muted"
            :style="{ left: `${tick.leftPct}%` }"
          >{{ tick.label }}</span>
        </div>
      </div>

      <div
        v-for="row in rows"
        :key="row.id"
        class="flex h-[38px] border-b border-line/60"
      >
        <div class="flex shrink-0 items-center gap-1.5 border-r border-line px-2.5 text-[11px] text-muted" :style="{ width: labelColumn }">
          <Icon :name="row.icon" class="size-3.5 shrink-0" />
          <span class="truncate">{{ $t(row.label) }}</span>
        </div>
        <div class="relative flex-1">
          <div
            v-for="span in row.spans"
            :key="span.id"
            class="absolute inset-y-1 flex items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold"
            :style="laneStyle(span, row.kind)"
          >
            <span class="truncate">{{ span.label }}</span>
          </div>
        </div>
      </div>

      <div
        class="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 -translate-x-px bg-fill"
        :style="{ left: playheadLeft }"
        aria-hidden="true"
      >
        <span class="absolute -left-[6px] top-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-fill" />
      </div>
    </div>
  </section>
</template>
