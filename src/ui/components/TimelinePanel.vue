<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import TimelineItem from './timeline/TimelineItem.vue'
import { useEditorStore } from '../stores/editor'
import type { Micros } from '../../core/time'
import { frameDuration } from '../../core/time'
import { clipEnd } from '../../core/timeline/edit'
import type { ItemRef } from '../../core/timeline/ops'
import { collectSnapPoints, snapTime } from '../../core/timeline/snap'
import {
  clampPxPerSecond,
  DEFAULT_PX_PER_SECOND,
  fitPxPerSecond,
  microsToPx,
  pxToMicros,
  rulerTicks,
  sliderFromZoom,
  zoomFromSlider,
  type RulerTick
} from '../../core/timeline/ruler'

const LABEL_COLUMN_PX = 124
const RULER_HEIGHT_PX = 22
const LANE_HEIGHT_PX = 38
/** Room after the last item, so the end of the track can be reached by scrolling. */
const CONTENT_MARGIN_PX = 24
/** Keeps the fitted track clear of the scroll container edge. */
const FIT_PADDING_PX = 32
const DRAG_THRESHOLD_PX = 4
const SNAP_THRESHOLD_PX = 8
const ZOOM_FACTOR = 1.5
const REVEAL_MARGIN_PX = 16

type Variant = 'video' | 'text' | 'music' | 'audio'
type GestureKind = 'scrub' | 'reorder' | 'trim-start' | 'trim-end' | 'move-text'

interface LaneItem {
  key: string
  ref: ItemRef | null
  variant: Variant
  tone: 1 | 2 | 3
  label: string
  ariaLabel: string
  startMicros: Micros
  endMicros: Micros
  leftPx: number
  widthPx: number
}

interface Lane {
  id: string
  icon: string
  label: string
  items: LaneItem[]
}

/** State of one pointer press. Edits during a press are computed from the origin values stored here. */
interface Gesture {
  kind: GestureKind
  pointerId: number
  originX: number
  moved: boolean
  key: string
  id: string
  itemKind: ItemRef['kind'] | null
  originStart: Micros
  originEnd: Micros
  originLeftPx: number
  originWidthPx: number
  candidates: Micros[]
  others: { leftPx: number; endPx: number }[]
  originIndex: number
  dropIndex: number
}

function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true
  }
  return target instanceof HTMLElement && target.isContentEditable
}

// Kept outside the component data: Vue must not wrap a ResizeObserver in a proxy.
const observers = new WeakMap<object, ResizeObserver>()

export default defineComponent({
  name: 'TimelinePanel',
  components: { Icon, TimelineItem },
  data() {
    return {
      labelColumn: LABEL_COLUMN_PX,
      rulerHeight: RULER_HEIGHT_PX,
      laneHeight: LANE_HEIGHT_PX,
      pxPerSecond: DEFAULT_PX_PER_SECOND,
      /** True until the user zooms by hand; then resizing keeps the zoom. */
      fitted: true,
      viewportWidth: 0,
      snapping: true,
      gesture: null as Gesture | null,
      dragKey: null as string | null,
      dragOffset: 0,
      dropPx: null as number | null
    }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'totalDuration', 'playheadMicros', 'selection']),
    fps(): number {
      return this.project.format.fps
    },
    contentWidth(): number {
      return Math.max(this.viewportWidth, Math.ceil(microsToPx(this.totalDuration, this.pxPerSecond)) + CONTENT_MARGIN_PX)
    },
    playheadPx(): number {
      return microsToPx(this.playheadMicros, this.pxPerSecond)
    },
    ticks(): RulerTick[] {
      return rulerTicks(pxToMicros(this.contentWidth, this.pxPerSecond), this.pxPerSecond, this.fps)
    },
    zoomSlider: {
      get(): number {
        return sliderFromZoom(this.pxPerSecond, this.fps)
      },
      set(value: number) {
        this.setZoom(zoomFromSlider(Number(value), this.fps))
      }
    },
    lanes(): Lane[] {
      const project = this.project
      const pps = this.pxPerSecond
      const names = new Map(project.assets.map((a) => [a.id, a.name]))
      // Pictures and files without a sound track have nothing to show on the original audio lane.
      const hasSound = new Map(project.assets.map((a) => [a.id, a.kind === 'video' && a.hasAudio !== false]))
      const px = (t: Micros): number => microsToPx(t, pps)
      const sortedClips = [...project.clips].sort((a, b) => a.start - b.start)

      const videoItems = sortedClips.map((clip, i): LaneItem => {
        const name = names.get(clip.assetId) ?? ''
        const end = clipEnd(clip)
        return {
          key: `clip:${clip.id}`,
          ref: { kind: 'clip', id: clip.id },
          variant: 'video',
          tone: ((i % 3) + 1) as 1 | 2 | 3,
          label: name,
          ariaLabel: this.$t('timeline.clipLabel', { name }),
          startMicros: clip.start,
          endMicros: end,
          leftPx: px(clip.start),
          widthPx: px(end - clip.start)
        }
      })
      const originalAudioItems = sortedClips
        .filter((clip) => !clip.muted && hasSound.get(clip.assetId) === true)
        .map((clip): LaneItem => {
          const end = clipEnd(clip)
          return {
            key: `audio:${clip.id}`,
            ref: null,
            variant: 'audio',
            tone: 1,
            label: names.get(clip.assetId) ?? '',
            ariaLabel: '',
            startMicros: clip.start,
            endMicros: end,
            leftPx: px(clip.start),
            widthPx: px(end - clip.start)
          }
        })
      const textItems = project.texts.map((text): LaneItem => {
        const end = text.start + text.duration
        return {
          key: `text:${text.id}`,
          ref: { kind: 'text', id: text.id },
          variant: 'text',
          tone: 1,
          label: text.text,
          ariaLabel: this.$t('timeline.textLabel', { name: text.text }),
          startMicros: text.start,
          endMicros: end,
          leftPx: px(text.start),
          widthPx: px(text.duration)
        }
      })
      const musicItems = project.music.map((music): LaneItem => {
        const name = names.get(music.assetId) ?? ''
        const end = music.start + (music.srcOut - music.srcIn)
        return {
          key: `music:${music.id}`,
          ref: { kind: 'music', id: music.id },
          variant: 'music',
          tone: 1,
          label: name,
          ariaLabel: this.$t('timeline.musicLabel', { name }),
          startMicros: music.start,
          endMicros: end,
          leftPx: px(music.start),
          widthPx: px(end - music.start)
        }
      })

      return [
        { id: 'text', icon: 'text', label: 'timeline.text', items: textItems },
        { id: 'overlay', icon: 'sticker', label: 'timeline.overlay', items: [] },
        { id: 'video', icon: 'media', label: 'timeline.video', items: videoItems },
        { id: 'originalAudio', icon: 'audio', label: 'timeline.originalAudio', items: originalAudioItems },
        { id: 'music', icon: 'audio', label: 'timeline.music', items: musicItems }
      ]
    },
    dropTop(): number {
      const index = this.lanes.findIndex((lane) => lane.id === 'video')
      return RULER_HEIGHT_PX + Math.max(0, index) * LANE_HEIGHT_PX + 4
    }
  },
  mounted() {
    const el = this.$refs.scroller as HTMLElement
    this.viewportWidth = el.clientWidth
    this.fitToWidth()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      this.viewportWidth = el.clientWidth
      if (this.fitted) this.fitToWidth()
    })
    observers.set(this, observer)
    observer.observe(el)
  },
  beforeUnmount() {
    observers.get(this)?.disconnect()
    observers.delete(this)
  },
  methods: {
    ...mapActions(useEditorStore, [
      'select',
      'setPlayhead',
      'stepFrame',
      'splitAtPlayhead',
      'deleteSelected',
      'trimStart',
      'trimEnd',
      'trimTextStart',
      'trimTextEnd',
      'moveText',
      'reorderClip',
      'beginGesture',
      'endGesture'
    ]),

    isSelected(item: LaneItem): boolean {
      const sel = this.selection
      return item.ref !== null && sel !== null && sel.kind === item.ref.kind && sel.id === item.ref.id
    },
    handlesFor(item: LaneItem): boolean {
      return this.isSelected(item) && item.ref !== null && item.ref.kind !== 'music'
    },
    offsetFor(item: LaneItem): number {
      return this.dragKey === item.key ? this.dragOffset : 0
    },

    // --- zoom ---
    setZoom(pxPerSecond: number) {
      this.pxPerSecond = clampPxPerSecond(pxPerSecond, this.fps)
      this.fitted = false
      this.$nextTick(() => this.revealPlayhead())
    },
    zoomIn() {
      this.setZoom(this.pxPerSecond * ZOOM_FACTOR)
    },
    zoomOut() {
      this.setZoom(this.pxPerSecond / ZOOM_FACTOR)
    },
    fitToWidth() {
      this.fitted = true
      this.pxPerSecond = fitPxPerSecond(this.viewportWidth - FIT_PADDING_PX, this.totalDuration, this.fps)
      const el = this.$refs.scroller as HTMLElement | undefined
      if (el) el.scrollLeft = 0
    },
    /** Scrolls the lanes so the playhead is visible. */
    revealPlayhead() {
      const el = this.$refs.scroller as HTMLElement | undefined
      if (!el) return
      const x = this.playheadPx
      const start = el.scrollLeft
      const end = start + el.clientWidth
      if (x >= start + REVEAL_MARGIN_PX && x <= end - REVEAL_MARGIN_PX) return
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
    },

    // --- pointer: playhead, selection, trims, reorder ---
    /** Timeline time under a screen x coordinate (the lanes scroll, so the scroll offset counts). */
    microsAt(clientX: number): Micros {
      const el = this.$refs.scroller as HTMLElement
      const rect = el.getBoundingClientRect()
      return pxToMicros(clientX - rect.left + el.scrollLeft, this.pxPerSecond)
    },
    makeGesture(kind: GestureKind, event: PointerEvent, item?: LaneItem): Gesture {
      return {
        kind,
        pointerId: event.pointerId,
        originX: event.clientX,
        moved: false,
        key: item?.key ?? '',
        id: item?.ref?.id ?? '',
        itemKind: item?.ref?.kind ?? null,
        originStart: item?.startMicros ?? 0,
        originEnd: item?.endMicros ?? 0,
        originLeftPx: item?.leftPx ?? 0,
        originWidthPx: item?.widthPx ?? 0,
        candidates: [],
        others: [],
        originIndex: -1,
        dropIndex: -1
      }
    },
    onScrubDown(event: PointerEvent) {
      if (event.button !== 0) return
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      ;(this.$refs.scroller as HTMLElement).focus({ preventScroll: true })
      this.gesture = this.makeGesture('scrub', event)
      this.setPlayhead(this.microsAt(event.clientX))
    },
    onSelect(item: LaneItem) {
      if (item.ref) this.select(item.ref)
    },
    onBodyDown(event: PointerEvent, item: LaneItem) {
      if (!item.ref) return
      this.select(item.ref)
      if (item.ref.kind === 'clip') {
        const videoItems = this.lanes.find((lane) => lane.id === 'video')?.items ?? []
        const gesture = this.makeGesture('reorder', event, item)
        gesture.originIndex = videoItems.findIndex((other) => other.key === item.key)
        gesture.others = videoItems
          .filter((other) => other.key !== item.key)
          .map((other) => ({ leftPx: other.leftPx, endPx: other.leftPx + other.widthPx }))
        this.gesture = gesture
      } else if (item.ref.kind === 'text') {
        this.beginGesture()
        const gesture = this.makeGesture('move-text', event, item)
        gesture.candidates = collectSnapPoints(this.project, item.ref.id, this.playheadMicros)
        this.gesture = gesture
      }
    },
    onHandleDown(edge: 'start' | 'end', event: PointerEvent, item: LaneItem) {
      if (!item.ref || item.ref.kind === 'music') return
      this.beginGesture()
      const gesture = this.makeGesture(edge === 'start' ? 'trim-start' : 'trim-end', event, item)
      gesture.candidates = collectSnapPoints(this.project, item.ref.id, this.playheadMicros)
      this.gesture = gesture
    },
    onPointerMove(event: PointerEvent) {
      const gesture = this.gesture
      if (!gesture || event.pointerId !== gesture.pointerId) return
      // A release that was never delivered (e.g. window switch) must not keep editing.
      if (event.buttons === 0) {
        this.finishGesture()
        return
      }
      if (gesture.kind === 'scrub') this.setPlayhead(this.microsAt(event.clientX))
      else if (gesture.kind === 'reorder') this.updateReorder(gesture, event)
      else if (gesture.kind === 'move-text') this.updateTextMove(gesture, event)
      else this.updateTrim(gesture, event)
    },
    updateTrim(gesture: Gesture, event: PointerEvent) {
      const dx = event.clientX - gesture.originX
      if (dx === 0 && !gesture.moved) return
      gesture.moved = true
      const isStart = gesture.kind === 'trim-start'
      const origin = isStart ? gesture.originStart : gesture.originEnd
      let t = origin + pxToMicros(dx, this.pxPerSecond)
      if (this.snapping) t = snapTime(t, gesture.candidates, pxToMicros(SNAP_THRESHOLD_PX, this.pxPerSecond))
      const minLength = frameDuration(this.fps)
      // Start can only shrink: the video track is closed, so a clip cannot leave its neighbour.
      t = isStart
        ? Math.min(Math.max(t, gesture.originStart), gesture.originEnd - minLength)
        : Math.max(t, gesture.originStart + minLength)
      if (gesture.itemKind === 'clip') {
        if (isStart) this.trimStart(gesture.id, t)
        else this.trimEnd(gesture.id, t)
      } else if (isStart) {
        this.trimTextStart(gesture.id, t)
      } else {
        this.trimTextEnd(gesture.id, t)
      }
    },
    updateTextMove(gesture: Gesture, event: PointerEvent) {
      const dx = event.clientX - gesture.originX
      if (dx === 0 && !gesture.moved) return
      gesture.moved = true
      let t = gesture.originStart + pxToMicros(dx, this.pxPerSecond)
      if (this.snapping) t = snapTime(t, gesture.candidates, pxToMicros(SNAP_THRESHOLD_PX, this.pxPerSecond))
      this.moveText(gesture.id, Math.max(0, t))
    },
    updateReorder(gesture: Gesture, event: PointerEvent) {
      const dx = event.clientX - gesture.originX
      if (!gesture.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
        gesture.moved = true
      }
      // The dragged clip goes before every other clip whose middle is right of the pointer.
      const center = gesture.originLeftPx + gesture.originWidthPx / 2 + dx
      let index = 0
      for (const other of gesture.others) {
        if ((other.leftPx + other.endPx) / 2 < center) index++
      }
      gesture.dropIndex = index
      this.dragKey = gesture.key
      this.dragOffset = dx
      const before = gesture.others[index]
      this.dropPx = before ? before.leftPx : (gesture.others[gesture.others.length - 1]?.endPx ?? 0)
    },
    onPointerEnd(event: PointerEvent) {
      const gesture = this.gesture
      if (!gesture || event.pointerId !== gesture.pointerId) return
      this.finishGesture()
    },
    finishGesture() {
      const gesture = this.gesture
      if (!gesture) return
      if (gesture.kind === 'reorder') {
        if (gesture.moved && gesture.dropIndex >= 0 && gesture.dropIndex !== gesture.originIndex) {
          this.reorderClip(gesture.id, gesture.dropIndex)
        }
      } else if (gesture.kind !== 'scrub') {
        this.endGesture()
      }
      this.gesture = null
      this.dragKey = null
      this.dragOffset = 0
      this.dropPx = null
    },

    // --- keyboard (active while focus is inside the timeline) ---
    onKeydown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event.target)) return
      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          this.deleteSelected()
          break
        case 's':
        case 'S':
          event.preventDefault()
          this.splitAtPlayhead()
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault()
          const frames = event.shiftKey ? 10 : 1
          this.stepFrame(event.key === 'ArrowLeft' ? -frames : frames)
          this.revealPlayhead()
          break
        }
      }
    }
  }
})
</script>

<template>
  <section
    class="flex shrink-0 flex-col border-t border-line bg-panel"
    @keydown="onKeydown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
  >
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
      <button
        type="button"
        role="switch"
        class="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold hover:bg-panel2"
        :aria-checked="snapping"
        :title="$t('timeline.snapHint')"
        @click="snapping = !snapping"
      >
        <Icon name="magnet" class="size-4" :class="snapping ? 'text-txt' : 'text-muted'" />
        <span>{{ $t('timeline.snap') }}</span>
        <span
          class="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
          :class="snapping ? 'bg-fill text-fill-fg' : 'bg-panel2 text-muted'"
        >
          {{ snapping ? $t('timeline.on') : $t('timeline.off') }}
        </span>
      </button>

      <div class="flex-1" />

      <button
        type="button"
        class="flex h-8 items-center rounded-md px-2 text-xs font-semibold text-muted hover:bg-panel2"
        :aria-label="$t('timeline.fit')"
        :title="$t('timeline.fit')"
        @click="fitToWidth"
      >
        {{ $t('timeline.fit') }}
      </button>
      <button type="button" class="flex size-8 items-center justify-center rounded-md text-muted hover:bg-panel2" :aria-label="$t('timeline.zoomOut')" @click="zoomOut">
        <Icon name="zoomOut" class="size-4" />
      </button>
      <input
        v-model.number="zoomSlider"
        type="range"
        min="0"
        max="100"
        class="w-28 accent-fill"
        :aria-label="$t('timeline.zoom')"
      />
      <button type="button" class="flex size-8 items-center justify-center rounded-md text-muted hover:bg-panel2" :aria-label="$t('timeline.zoomIn')" @click="zoomIn">
        <Icon name="zoomIn" class="size-4" />
      </button>
    </div>

    <div class="flex">
      <div class="shrink-0 border-r border-line" :style="{ width: labelColumn + 'px' }">
        <div class="border-b border-line" :style="{ height: rulerHeight + 'px' }" />
        <div
          v-for="lane in lanes"
          :key="lane.id"
          class="flex items-center gap-1.5 border-b border-line/60 px-2.5 text-[11px] text-muted"
          :style="{ height: laneHeight + 'px' }"
        >
          <Icon :name="lane.icon" class="size-3.5 shrink-0" />
          <span class="truncate">{{ $t(lane.label) }}</span>
        </div>
      </div>

      <div
        ref="scroller"
        class="relative min-w-0 flex-1 overflow-x-auto"
        role="group"
        tabindex="0"
        :aria-label="$t('timeline.area')"
      >
        <div
          class="relative select-none touch-none"
          :style="{ width: contentWidth + 'px' }"
          :data-px-per-second="pxPerSecond"
          @pointerdown="onScrubDown"
        >
          <div class="pointer-events-none relative border-b border-line" :style="{ height: rulerHeight + 'px' }" data-role="ruler">
            <span
              v-for="tick in ticks"
              :key="tick.micros"
              class="absolute top-0 h-full border-l border-line pl-1 font-mono text-[10px] leading-[22px] text-muted"
              :style="{ left: tick.px + 'px' }"
            >{{ tick.label }}</span>
          </div>

          <div
            v-for="lane in lanes"
            :key="lane.id"
            class="relative border-b border-line/60"
            :style="{ height: laneHeight + 'px' }"
            :data-lane="lane.id"
          >
            <TimelineItem
              v-for="item in lane.items"
              :key="item.key"
              :label="item.label"
              :aria-label="item.ariaLabel"
              :variant="item.variant"
              :tone="item.tone"
              :left="item.leftPx"
              :width="item.widthPx"
              :offset="offsetFor(item)"
              :selected="isSelected(item)"
              :interactive="item.ref !== null"
              :handles="handlesFor(item)"
              :start-label="$t('timeline.trimStart')"
              :end-label="$t('timeline.trimEnd')"
              @select="onSelect(item)"
              @body-down="onBodyDown($event, item)"
              @handle-down="(edge, event) => onHandleDown(edge, event, item)"
            />
          </div>

          <div
            v-if="dropPx !== null"
            class="pointer-events-none absolute z-20 w-[3px] -translate-x-px rounded-full bg-signal shadow-[0_0_0_1px_var(--jc-signal-fg)]"
            :style="{ left: dropPx + 'px', top: dropTop + 'px', height: (laneHeight - 8) + 'px' }"
            data-role="drop-indicator"
            aria-hidden="true"
          />

          <div
            class="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 -translate-x-px bg-fill"
            :style="{ left: playheadPx + 'px' }"
            data-role="playhead"
            aria-hidden="true"
          >
            <span class="absolute -left-[6px] top-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-fill" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
