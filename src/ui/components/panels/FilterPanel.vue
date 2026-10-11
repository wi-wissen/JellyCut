<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import RangeField from './RangeField.vue'
import ChoiceTile from './ChoiceTile.vue'
import { useEditorStore } from '../../stores/editor'
import { getFrameProvider } from '../../stores/media'
import { Compositor } from '../../../engine/render/compositor'
import type { DecodedFrame } from '../../../engine/media/frames'
import { FILTER_IDS, isIdentity, resolveGrade, type FilterId, type Grade } from '../../../core/filters/filters'
import { gradeTargetClipId } from '../../../core/filters/ops'
import type { Clip, ColorAdjust, ProjectFormat } from '../../../core/project/types'
import type { Scene } from '../../../core/render/types'
import type { Micros } from '../../../core/time'
import { formatNumber } from '../../numberFormat'

/** Size of one filter tile's picture, in pixels. */
const TILE_W = 96
const TILE_H = 54
/** Frame requests wait this long after the last change (scrubbing, slider drags). */
const REFRESH_DEBOUNCE_MS = 120
/** Own decoder lane, so the thumbnails do not share a cache with the preview. */
const THUMB_LANE = 'filter-thumb'
const THUMB_FRAME = 'thumb'
const NEUTRAL: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0 }

// Non-reactive: one shared offscreen compositor for all tiles, and the picture the tiles are drawn from.
let thumbCanvas: HTMLCanvasElement | null = null
let thumbCompositor: Compositor | null = null
let placeholder: HTMLCanvasElement | null = null
let source: HTMLCanvasElement | null = null
let sourceKey = ''
let requestSeq = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** A coloured stand-in picture, used when no frame can be read yet. It goes through the same grade. */
function makePlaceholder(): HTMLCanvasElement {
  const c = makeCanvas(TILE_W, TILE_H)
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, TILE_W, TILE_H)
    g.addColorStop(0, '#2b6cb0')
    g.addColorStop(0.55, '#68a77a')
    g.addColorStop(1, '#f6ad55')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, TILE_W, TILE_H)
    ctx.fillStyle = '#fefcbf'
    ctx.beginPath()
    ctx.arc(TILE_W * 0.7, TILE_H * 0.35, TILE_H * 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  return c
}

/** Copies a decoded frame into a small canvas. The decoder may reuse its canvas, so the copy is needed. */
function copySmall(frame: DecodedFrame): HTMLCanvasElement | null {
  const w = frame.width
  const h = frame.height
  if (!(w > 0 && h > 0)) return null
  const c = makeCanvas(TILE_W, Math.max(1, Math.round((TILE_W * h) / w)))
  c.getContext('2d')?.drawImage(frame as CanvasImageSource, 0, 0, c.width, c.height)
  return c
}

/** Flat colours for the tiles when WebGL is not available. */
const FALLBACK_SWATCH: Record<FilterId, string> = {
  none: '#7a8290',
  blackWhite: '#8a8a8a',
  sepia: '#a88a62',
  warm: '#c99468',
  cool: '#6c8fb0',
  vivid: '#3fa3b8',
  fade: '#b5b0aa',
  vintage: '#a7987d',
  noir: '#3a3a3a',
  dream: '#d8cfe6'
}

/** One picture drawn at the tile size; the compositor is resized to the tile, so the format only sets the background. */
function thumbScene(format: ProjectFormat, grade: Grade | null): Scene {
  return {
    time: 0,
    format,
    videos: [
      {
        clipId: THUMB_FRAME,
        assetId: THUMB_FRAME,
        srcTime: 0,
        transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
        transition: null,
        grade
      }
    ],
    overlays: [],
    texts: []
  }
}

export default defineComponent({
  name: 'FilterPanel',
  components: { RangeField, ChoiceTile },
  data() {
    return { filterIds: FILTER_IDS, tileW: TILE_W, tileH: TILE_H }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'selection', 'playheadMicros', 'isPlaying']),
    targetId(): string | null {
      return gradeTargetClipId(this.project, this.selection, this.playheadMicros)
    },
    targetClip(): Clip | null {
      return this.project.clips.find((c) => c.id === this.targetId) ?? null
    },
    targetName(): string {
      const clip = this.targetClip
      return clip ? (this.project.assets.find((a) => a.id === clip.assetId)?.name ?? '') : ''
    },
    currentFilter(): string {
      return this.targetClip?.filter ?? 'none'
    },
    amount(): number {
      return this.targetClip?.filterAmount ?? 1
    },
    amountPercent(): number {
      return Math.round(this.amount * 100)
    },
    adjust(): ColorAdjust {
      return this.targetClip?.adjust ?? NEUTRAL
    },
    /** Source picture of the target at the playhead (or its first frame when the playhead is elsewhere). */
    thumbSource(): { assetId: string; srcTime: Micros } | null {
      const clip = this.targetClip
      if (!clip) return null
      const t = this.playheadMicros
      const inside = clip.start <= t && t < clip.start + Math.round((clip.srcOut - clip.srcIn) / clip.speed)
      const srcTime = inside ? clip.srcIn + Math.round((t - clip.start) * clip.speed) : clip.srcIn
      return { assetId: clip.assetId, srcTime }
    },
    frameKey(): string {
      const s = this.thumbSource
      return s ? `${s.assetId}@${s.srcTime}` : ''
    },
    /** Changes whenever a tile would look different. */
    gradeKey(): string {
      return JSON.stringify([this.currentFilter, this.amount, this.adjust.brightness, this.adjust.contrast, this.adjust.saturation])
    },
    intensityText(): string {
      return this.$t('units.percent', { value: this.amountPercent })
    }
  },
  watch: {
    frameKey(): void {
      this.scheduleRefresh()
    },
    isPlaying(playing: boolean): void {
      if (!playing) this.scheduleRefresh()
    },
    gradeKey: {
      flush: 'post',
      handler(): void {
        this.renderTiles()
      }
    },
    targetId: {
      flush: 'post',
      handler(): void {
        this.renderTiles()
      }
    }
  },
  mounted() {
    thumbCanvas = makeCanvas(TILE_W, TILE_H)
    try {
      thumbCompositor = new Compositor(thumbCanvas)
      thumbCompositor.resize(TILE_W, TILE_H)
    } catch {
      thumbCompositor = null
    }
    placeholder = makePlaceholder()
    source = null
    sourceKey = ''
    this.scheduleRefresh()
  },
  beforeUnmount() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
    thumbCompositor?.dispose()
    thumbCompositor = null
    thumbCanvas = null
    placeholder = null
    source = null
    sourceKey = ''
    requestSeq++
  },
  methods: {
    ...mapActions(useEditorStore, ['setClipGrade', 'applyGradeToAllClips', 'endGesture']),
    scheduleRefresh(): void {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void this.refreshSource()
      }, REFRESH_DEBOUNCE_MS)
    },
    /** Reads the frame under the playhead for the target clip. Keeps the previous picture while the decoder works. */
    async refreshSource(): Promise<void> {
      if (this.isPlaying) return
      const seq = ++requestSeq
      const s = this.thumbSource
      if (!s) {
        source = null
        sourceKey = ''
        this.renderTiles()
        return
      }
      const key = this.frameKey
      if (key === sourceKey && source) return
      let frame: DecodedFrame | null = null
      try {
        frame = await getFrameProvider().getFrame(s.assetId, s.srcTime, THUMB_LANE)
      } catch {
        frame = null
      }
      if (seq !== requestSeq) return
      source = frame ? copySmall(frame) : null
      sourceKey = source ? key : ''
      this.renderTiles()
    },
    /** Draws every tile from the shared picture with its own filter at the target's current intensity and adjustments. */
    renderTiles(): void {
      const canvases = (this.$refs.tiles as HTMLCanvasElement[] | undefined) ?? []
      const picture = source ?? placeholder
      for (const canvas of canvases) {
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        const id = (canvas.dataset.filter ?? 'none') as FilterId
        const comp = thumbCompositor
        if (!comp || !thumbCanvas || !picture) {
          ctx.fillStyle = FALLBACK_SWATCH[id]
          ctx.fillRect(0, 0, TILE_W, TILE_H)
          continue
        }
        const grade = resolveGrade(id === 'none' ? null : id, this.amount, this.adjust)
        comp.draw(thumbScene(this.project.format, isIdentity(grade) ? null : grade), new Map([[THUMB_FRAME, picture]]))
        ctx.clearRect(0, 0, TILE_W, TILE_H)
        ctx.drawImage(thumbCanvas, 0, 0)
      }
    },
    chooseFilter(id: FilterId): void {
      if (this.targetId) this.setClipGrade(this.targetId, { filter: id })
    },
    keyFor(field: string): string {
      return `filter-${field}:${this.targetId ?? ''}`
    },
    onAmount(percent: number): void {
      if (this.targetId) this.setClipGrade(this.targetId, { filterAmount: percent / 100 }, this.keyFor('amount'))
    },
    onAdjust(field: keyof ColorAdjust, percent: number): void {
      if (this.targetId) this.setClipGrade(this.targetId, { adjust: { [field]: percent / 100 } }, this.keyFor(`adjust-${field}`))
    },
    adjustPercent(field: keyof ColorAdjust): number {
      return Math.round(this.adjust[field] * 100)
    },
    adjustText(field: keyof ColorAdjust): string {
      const value = this.adjustPercent(field)
      return this.$t('units.percent', { value: value > 0 ? `+${formatNumber(value, 0)}` : formatNumber(value, 0) })
    },
    resetAdjust(): void {
      if (this.targetId) this.setClipGrade(this.targetId, { adjust: { ...NEUTRAL } })
    },
    applyAll(): void {
      if (this.targetId) this.applyGradeToAllClips(this.targetId)
    },
    endEdit(): void {
      this.endGesture()
    },
    filterName(id: string): string {
      return this.$t(`filters.names.${id}`)
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('filters.title') }}</h2>

    <p v-if="!targetClip" class="rounded-lg bg-panel2 p-3 text-xs font-semibold text-fg">
      {{ $t('filters.pickClip') }}
    </p>

    <template v-else>
      <p class="text-xs text-muted" data-testid="filter-target">{{ $t('filters.target', { name: targetName }) }}</p>

      <div class="grid grid-cols-2 gap-2.5" role="group" :aria-label="$t('filters.title')">
        <ChoiceTile
          v-for="id in filterIds"
          :key="id"
          :label="filterName(id)"
          :selected="currentFilter === id"
          :data-testid="`filter-tile-${id}`"
          @choose="chooseFilter(id)"
        >
          <canvas
            ref="tiles"
            :data-filter="id"
            :width="tileW"
            :height="tileH"
            class="block size-full"
            aria-hidden="true"
          />
        </ChoiceTile>
      </div>

      <section class="flex flex-col gap-2 border-t border-line pt-3">
        <RangeField
          :label="$t('filters.intensity')"
          :model-value="amountPercent"
          :min="0"
          :max="100"
          :step="1"
          :display="intensityText"
          @update="onAmount"
          @commit="endEdit"
        />
      </section>

      <section class="flex flex-col gap-2 border-t border-line pt-3">
        <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('filters.adjust') }}</h3>
        <RangeField
          :label="$t('filters.brightness')"
          :model-value="adjustPercent('brightness')"
          :min="-100"
          :max="100"
          :step="1"
          :display="adjustText('brightness')"
          @update="(v: number) => onAdjust('brightness', v)"
          @commit="endEdit"
        />
        <RangeField
          :label="$t('filters.contrast')"
          :model-value="adjustPercent('contrast')"
          :min="-100"
          :max="100"
          :step="1"
          :display="adjustText('contrast')"
          @update="(v: number) => onAdjust('contrast', v)"
          @commit="endEdit"
        />
        <RangeField
          :label="$t('filters.saturation')"
          :model-value="adjustPercent('saturation')"
          :min="-100"
          :max="100"
          :step="1"
          :display="adjustText('saturation')"
          @update="(v: number) => onAdjust('saturation', v)"
          @commit="endEdit"
        />
        <button
          type="button"
          class="min-h-11 self-start rounded-lg px-3 text-xs font-semibold text-txt hover:bg-panel2"
          @click="resetAdjust"
        >
          {{ $t('filters.reset') }}
        </button>
      </section>

      <section class="flex flex-col gap-2 border-t border-line pt-3">
        <button
          type="button"
          class="min-h-11 rounded-lg bg-panel2 px-3 text-xs font-semibold text-fg hover:bg-panel"
          @click="applyAll"
        >
          {{ $t('filters.applyAll') }}
        </button>
      </section>
    </template>
  </div>
</template>
