<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from './Icon.vue'
import TimelineItem from './timeline/TimelineItem.vue'
import ItemContextMenu, { type MenuEntry } from './timeline/ItemContextMenu.vue'
import { useEditorStore } from '../stores/editor'
import { useFineCutStore } from '../stores/fineCut'
import type { OverlayItem } from '../../core/project/types'
import type { Micros } from '../../core/time'
import { frameDuration } from '../../core/time'
import { clipEnd } from '../../core/timeline/edit'
import { clipForFineCut } from '../../core/timeline/fineCut'
import { planTimeline } from '../../core/render/scene'
import { formatNumber } from '../numberFormat'
import type { ItemRef } from '../../core/timeline/ops'
import { collectSnapPoints, snapTime } from '../../core/timeline/snap'
import { packRows } from '../../core/timeline/overlayRows'
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

const RULER_HEIGHT_PX = 22
const LANE_HEIGHT_PX = 38
/** Fixed panel height, so a new lane row does not push the whole editor around. The user can change it. */
const TIMELINE_HEIGHT_KEY = 'jellycut.timelineHeight'
const DEFAULT_TIMELINE_HEIGHT_PX = 248
const MIN_TIMELINE_HEIGHT_PX = 160
const MAX_TIMELINE_VIEWPORT_SHARE = 0.7
const RESIZE_STEP_PX = 16
const MENU_GAP_PX = 4
/** Coarse pointers (touch): lanes and bars grow so every bar is at least 44 px tall. */
const COARSE_LANE_HEIGHT_PX = 48
const BAR_INSET_PX = 4
const COARSE_BAR_INSET_PX = 2
/** Room after the last item, so the end of the track can be reached by scrolling. */
const CONTENT_MARGIN_PX = 24
/** Keeps the fitted track clear of the scroll container edge. */
const FIT_PADDING_PX = 32
const DRAG_THRESHOLD_PX = 4
const SNAP_THRESHOLD_PX = 8
const ZOOM_FACTOR = 1.5
const REVEAL_MARGIN_PX = 16
/** While playing, the view turns a page once the playhead passes this share of the visible width... */
const FOLLOW_TRIGGER = 0.8
/** ...and then places the playhead this far from the left edge. An instant jump, not an animation: calm and no jitter. */
const FOLLOW_TARGET = 0.2
/** A manual scroll or press in the lanes stops following for this long. */
const FOLLOW_PAUSE_MS = 3000

type Variant = 'video' | 'text' | 'music' | 'audio' | 'overlay'
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
  /** Stacking row inside a lane whose bars overlap (overlay lane only). */
  row?: number
}

interface Lane {
  id: string
  icon: string
  label: string
  /** Colour key of the lane's items, shown as a small swatch in the label column. */
  swatch: string
  items: LaneItem[]
  /** Number of stacked rows; the lane is that many lane heights tall. */
  rows?: number
}

/** State of one pointer press. Edits during a press are computed from the origin values stored here. */
/** Pointer state of a height drag. Not reactive. */
interface GripDrag {
  pointerId: number
  startY: number
  startHeight: number
}

interface ItemMenuState {
  x: number
  y: number
  item: LaneItem
  opener: HTMLElement | null
}

/** Lane that owns the bars of a selected item. */
const LANE_OF_KIND: Record<ItemRef['kind'], string> = {
  clip: 'video',
  text: 'text',
  overlay: 'overlay',
  music: 'music'
}

function loadTimelineHeight(): number {
  try {
    const value = Number(window.localStorage.getItem(TIMELINE_HEIGHT_KEY))
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMELINE_HEIGHT_PX
  } catch {
    return DEFAULT_TIMELINE_HEIGHT_PX
  }
}

function saveTimelineHeight(height: number): void {
  try {
    window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(height))
  } catch {
    // Storage can be blocked; the height then lasts for this visit only.
  }
}

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
const pointerQueries = new WeakMap<object, MediaQueryList>()
let grip: GripDrag | null = null
/** performance.now() until which playback does not move the view (set by manual scrolling). Not reactive. */
let followPausedUntil = 0

export default defineComponent({
  name: 'TimelinePanel',
  components: { Icon, TimelineItem, ItemContextMenu },
  data() {
    return {
      rulerHeight: RULER_HEIGHT_PX,
      /** Primary pointer is coarse (touch); follows the media query, so a change at runtime is picked up. */
      coarse: false,
      pxPerSecond: DEFAULT_PX_PER_SECOND,
      /** True until the user zooms by hand; then resizing keeps the zoom. */
      fitted: true,
      viewportWidth: 0,
      snapping: true,
      gesture: null as Gesture | null,
      dragKey: null as string | null,
      dragOffset: 0,
      dropPx: null as number | null,
      timelineHeight: loadTimelineHeight(),
      minTimelineHeight: MIN_TIMELINE_HEIGHT_PX,
      menu: null as ItemMenuState | null,
      /** Lane rows below the visible part of the lane area; shown as a hint. */
      hiddenBelow: 0
    }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'totalDuration', 'playheadMicros', 'selection', 'isPlaying', 'canSplitAtPlayhead']),
    ...mapState(useFineCutStore, { fineCutOpen: 'isOpen' }),
    fps(): number {
      return this.project.format.fps
    },
    laneHeight(): number {
      return this.coarse ? COARSE_LANE_HEIGHT_PX : LANE_HEIGHT_PX
    },
    barInset(): number {
      return this.coarse ? COARSE_BAR_INSET_PX : BAR_INSET_PX
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
      // Overlapping stickers, shapes and strokes stack in rows instead of covering each other.
      const overlayRows = packRows(project.overlays.map((o) => ({ start: o.start, end: o.start + o.duration })))
      const overlayItems = project.overlays.map((overlay, i): LaneItem => {
        const name = this.overlayName(overlay)
        const end = overlay.start + overlay.duration
        return {
          key: `overlay:${overlay.id}`,
          ref: { kind: 'overlay', id: overlay.id },
          variant: 'overlay',
          tone: 1,
          label: name,
          ariaLabel: this.$t('overlays.timelineLabel', { name }),
          startMicros: overlay.start,
          endMicros: end,
          leftPx: px(overlay.start),
          widthPx: px(overlay.duration),
          row: overlayRows.rows[i]
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
        { id: 'text', icon: 'text', label: 'timeline.text', swatch: 'var(--jc-track-text)', items: textItems },
        { id: 'overlay', icon: 'sticker', label: 'timeline.overlay', swatch: 'var(--jc-track-overlay)', items: overlayItems, rows: overlayRows.count },
        { id: 'video', icon: 'media', label: 'timeline.video', swatch: 'var(--jc-track-video-1)', items: videoItems },
        { id: 'originalAudio', icon: 'audio', label: 'timeline.originalAudio', swatch: 'var(--jc-wave)', items: originalAudioItems },
        { id: 'music', icon: 'audio', label: 'timeline.music', swatch: 'var(--jc-track-music)', items: musicItems }
      ]
    },
    /** Rows of the overlay lane; a change of this number reveals the new row. */
    overlayRowCount(): number {
      return this.lanes.find((lane) => lane.id === 'overlay')?.rows ?? 1
    },
    /** Where two clips overlap during a transition, from the planner (the same geometry as preview and export). */
    transitionZones(): { key: string; leftPx: number; widthPx: number; label: string }[] {
      const planned = planTimeline(this.project)
      return planned.transitions.map((t) => ({
        key: t.clipId,
        leftPx: microsToPx(t.start, this.pxPerSecond),
        widthPx: microsToPx(t.duration, this.pxPerSecond),
        label: this.$t('polish.transitions.zone', { seconds: formatNumber(t.duration / 1_000_000, 1) })
      }))
    },
    /** Entries of the item menu: the action bar's actions for the item (clips), or the common ones for other items. */
    menuEntries(): MenuEntry[] {
      const ref = this.menu?.item.ref
      if (!ref) return []
      const t = (key: string): string => this.$t(`actions.${key}`)
      if (ref.kind !== 'clip') {
        return [
          { key: 'duplicate', label: t('duplicate'), icon: 'copy', enabled: true },
          { key: 'delete', label: t('delete'), icon: 'trash', enabled: true }
        ]
      }
      const clip = this.project.clips.find((c) => c.id === ref.id)
      const spansPlayhead = clip !== undefined && clip.start <= this.playheadMicros && this.playheadMicros < clipEnd(clip)
      const entries: MenuEntry[] = [
        { key: 'split', label: t('split'), icon: 'split', enabled: this.canSplitAtPlayhead },
        {
          key: 'fineCut',
          label: t('fineCut'),
          icon: 'fineCut',
          enabled: clipForFineCut(this.project, this.playheadMicros, this.selection) !== null
        },
        { key: 'duplicate', label: t('duplicate'), icon: 'copy', enabled: true },
        { key: 'flip', label: t('flip'), icon: 'flip', enabled: true },
        { key: 'rotate', label: t('rotate'), icon: 'rotate', enabled: true },
        { key: 'speed', label: t('speed'), icon: 'speed', enabled: true },
        { key: 'mute', label: t('mute'), icon: 'mute', enabled: true }
      ]
      if (spansPlayhead) {
        entries.push({ key: 'freeze', label: this.$t('polish.menu.freezeFrame'), icon: 'camera', enabled: true })
      }
      entries.push({ key: 'delete', label: t('delete'), icon: 'trash', enabled: true })
      return entries
    },
    dropTop(): number {
      const index = this.lanes.findIndex((lane) => lane.id === 'video')
      const above = this.lanes.slice(0, Math.max(0, index))
      return RULER_HEIGHT_PX + above.reduce((sum, lane) => sum + this.laneHeightPx(lane), 0) + this.barInset
    }
  },
  watch: {
    playheadMicros(): void {
      if (this.isPlaying) this.followPlayhead()
      else if (!this.gesture) this.revealPlayhead()
    },
    isPlaying(playing: boolean): void {
      if (playing) this.followPlayhead()
    },
    fineCutOpen(open: boolean): void {
      if (!open) void this.$nextTick(() => this.revealPlayhead())
    },
    selection(next: ItemRef | null): void {
      if (!next) return
      for (const lane of this.lanes) {
        const item = lane.items.find((other) => this.isSelected(other))
        if (item) {
          this.revealLaneRow(lane.id, item.row ?? 0)
          return
        }
      }
    },
    overlayRowCount(next: number, previous: number): void {
      if (next > previous) this.revealLaneRow('overlay', next - 1)
    },
    lanes(): void {
      void this.$nextTick(() => this.updateHidden())
    },
    timelineHeight(): void {
      void this.$nextTick(() => this.updateHidden())
    }
  },
  mounted() {
    const el = this.$refs.scroller as HTMLElement
    this.viewportWidth = el.clientWidth
    this.fitToWidth()
    void this.$nextTick(() => this.updateHidden())
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(pointer: coarse)')
      this.coarse = query.matches
      query.addEventListener('change', this.onPointerKindChange)
      pointerQueries.set(this, query)
    }
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      this.viewportWidth = el.clientWidth
      if (this.fitted) this.fitToWidth()
    })
    observers.set(this, observer)
    observer.observe(el)
    el.addEventListener('wheel', this.pauseFollow, { passive: true })
    el.addEventListener('touchstart', this.pauseFollow, { passive: true })
    el.addEventListener('pointerdown', this.onScrollerPointerdown)
  },
  beforeUnmount() {
    pointerQueries.get(this)?.removeEventListener('change', this.onPointerKindChange)
    pointerQueries.delete(this)
    observers.get(this)?.disconnect()
    observers.delete(this)
    const el = this.$refs.scroller as HTMLElement | undefined
    el?.removeEventListener('wheel', this.pauseFollow)
    el?.removeEventListener('touchstart', this.pauseFollow)
    el?.removeEventListener('pointerdown', this.onScrollerPointerdown)
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
      'trimOverlayStart',
      'trimOverlayEnd',
      'moveOverlay',
      'reorderClip',
      'beginGesture',
      'endGesture',
      'duplicateSelected',
      'flipSelected',
      'rotateSelected',
      'cycleSpeedSelected',
      'toggleMuteSelected',
      'insertFreezeFrame'
    ]),
    ...mapActions(useFineCutStore, { openFineCut: 'open' }),

    onPointerKindChange(event: MediaQueryListEvent) {
      this.coarse = event.matches
    },
    laneHeightPx(lane: Lane): number {
      return (lane.rows ?? 1) * this.laneHeight
    },
    /** Short label of an overlay bar: the emoji for stickers, the kind for shapes and strokes. */
    overlayName(item: OverlayItem): string {
      if (item.kind === 'sticker') return item.emoji ?? this.$t(`overlays3.sticker.${item.shape}`)
      if (item.kind === 'shape') return this.$t(`overlays.shape.${item.shape}`)
      if (item.kind === 'region') return this.$t(`overlays2.effects.${item.effect}`)
      if (item.kind === 'media') return this.project.assets.find((a) => a.id === item.assetId)?.name ?? ''
      return this.$t('overlays.header.stroke')
    },
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
    /** While playing: turns the page when the playhead reaches the right part of the view or is left of it. */
    followPlayhead() {
      if (!this.isPlaying || this.gesture !== null || performance.now() < followPausedUntil) return
      const el = this.$refs.scroller as HTMLElement | undefined
      if (!el) return
      const width = el.clientWidth
      const x = this.playheadPx
      const offset = x - el.scrollLeft
      if (offset >= 0 && offset <= width * FOLLOW_TRIGGER) return
      const maxScroll = Math.max(0, el.scrollWidth - width)
      const target = Math.min(Math.max(0, x - width * FOLLOW_TARGET), maxScroll)
      if (Math.abs(target - el.scrollLeft) >= 1) el.scrollLeft = target
    },
    pauseFollow() {
      followPausedUntil = performance.now() + FOLLOW_PAUSE_MS
    },
    /** Pressing the scroller itself (its scrollbar or the empty part) is a manual scroll; pressing the ruler or a clip is not. */
    onScrollerPointerdown(event: PointerEvent) {
      if (event.target === event.currentTarget) this.pauseFollow()
    },

    // --- fixed height: drag or arrow keys on the grip above the panel ---
    maxTimelineHeight(): number {
      return Math.max(MIN_TIMELINE_HEIGHT_PX, Math.floor(window.innerHeight * MAX_TIMELINE_VIEWPORT_SHARE))
    },
    clampHeight(height: number): number {
      return Math.round(Math.min(Math.max(height, MIN_TIMELINE_HEIGHT_PX), this.maxTimelineHeight()))
    },
    onGripDown(event: PointerEvent) {
      if (event.button !== 0) return
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      grip = { pointerId: event.pointerId, startY: event.clientY, startHeight: this.timelineHeight }
    },
    onGripMove(event: PointerEvent) {
      if (!grip || event.pointerId !== grip.pointerId) return
      this.timelineHeight = this.clampHeight(grip.startHeight + (grip.startY - event.clientY))
    },
    onGripEnd(event: PointerEvent) {
      if (!grip || event.pointerId !== grip.pointerId) return
      grip = null
      saveTimelineHeight(this.timelineHeight)
    },
    onGripKey(event: KeyboardEvent) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const step = event.key === 'ArrowUp' ? RESIZE_STEP_PX : -RESIZE_STEP_PX
      this.timelineHeight = this.clampHeight(this.timelineHeight + step)
      saveTimelineHeight(this.timelineHeight)
    },

    // --- lane area: vertical scrolling, reveal and the "more lanes" hint ---
    laneTop(laneId: string): number {
      let top = RULER_HEIGHT_PX
      for (const lane of this.lanes) {
        if (lane.id === laneId) return top
        top += this.laneHeightPx(lane)
      }
      return top
    },
    /** Scrolls the lane area so one lane row is fully visible (nearest edge, no jump when it already is). */
    revealLaneRow(laneId: string, row: number) {
      const body = this.$refs.body as HTMLElement | undefined
      if (!body) return
      const top = this.laneTop(laneId) + row * this.laneHeight
      const bottom = top + this.laneHeight
      if (top < body.scrollTop) body.scrollTop = top
      else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = bottom - body.clientHeight
      this.updateHidden()
    },
    /** Counts the lane rows that start below the visible part of the lane area. */
    updateHidden() {
      const body = this.$refs.body as HTMLElement | undefined
      if (!body) return
      const visibleBottom = body.scrollTop + body.clientHeight
      let count = 0
      let top = RULER_HEIGHT_PX
      for (const lane of this.lanes) {
        const rows = lane.rows ?? 1
        for (let row = 0; row < rows; row++) {
          if (top + row * this.laneHeight >= visibleBottom - 1) count++
        }
        top += this.laneHeightPx(lane)
      }
      this.hiddenBelow = count
    },
    scrollToBottom() {
      const body = this.$refs.body as HTMLElement | undefined
      if (body) body.scrollTop = body.scrollHeight
    },

    // --- item menu: right click, the context-menu key, or the "more" button on touch ---
    openMenu(item: LaneItem, x: number, y: number, opener: HTMLElement | null) {
      this.menu = { x, y, item, opener }
    },
    onItemContext(item: LaneItem, event: MouseEvent) {
      if (!item.ref) return
      this.select(item.ref)
      // The bar's button is the opener: focus goes back there when the menu closes.
      const bar = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
      const rect = bar?.getBoundingClientRect()
      // The context-menu key sends no pointer position; the bar's corner is used then.
      const byPointer = event.clientX !== 0 || event.clientY !== 0
      const x = byPointer ? event.clientX : (rect?.left ?? 0)
      const y = byPointer ? event.clientY : (rect?.bottom ?? 0)
      this.openMenu(item, x, y, bar)
    },
    onItemMore(item: LaneItem, button: HTMLElement) {
      if (!item.ref) return
      this.select(item.ref)
      const rect = button.getBoundingClientRect()
      this.openMenu(item, rect.left, rect.bottom + MENU_GAP_PX, button)
    },
    closeMenu(restoreFocus: boolean) {
      const opener = this.menu?.opener ?? null
      this.menu = null
      if (restoreFocus && opener?.isConnected) void this.$nextTick(() => opener.focus({ preventScroll: true }))
    },
    runMenu(key: string) {
      const restore = key !== 'fineCut'
      switch (key) {
        case 'split':
          this.splitAtPlayhead()
          break
        case 'fineCut':
          void this.openFineCut()
          break
        case 'duplicate':
          this.duplicateSelected()
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
        case 'freeze':
          this.insertFreezeFrame()
          break
        case 'delete':
          this.deleteSelected()
          break
      }
      this.closeMenu(restore)
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
      } else if (item.ref.kind === 'text' || item.ref.kind === 'overlay') {
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
      } else if (gesture.itemKind === 'overlay') {
        if (isStart) this.trimOverlayStart(gesture.id, t)
        else this.trimOverlayEnd(gesture.id, t)
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
      if (gesture.itemKind === 'overlay') this.moveOverlay(gesture.id, Math.max(0, t))
      else this.moveText(gesture.id, Math.max(0, t))
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
          break
        }
      }
    }
  }
})
</script>

<template>
  <section
    class="jc-timeline relative flex shrink-0 flex-col border-t border-line bg-panel"
    :style="{ height: timelineHeight + 'px' }"
    @keydown="onKeydown"
    @pointermove="onPointerMove"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
  >
    <div
      role="separator"
      tabindex="0"
      aria-orientation="horizontal"
      class="jc-timeline__grip absolute inset-x-0 -top-1.5 z-40 h-3 cursor-ns-resize touch-none focus-visible:outline-none"
      :aria-label="$t('polish.timeline.resize')"
      :aria-valuenow="timelineHeight"
      :aria-valuemin="minTimelineHeight"
      :aria-valuemax="maxTimelineHeight()"
      @pointerdown="onGripDown"
      @pointermove="onGripMove"
      @pointerup="onGripEnd"
      @pointercancel="onGripEnd"
      @keydown="onGripKey"
    >
      <span class="jc-timeline__grip-bar absolute left-1/2 top-1.5 h-[3px] w-10 -translate-x-1/2 rounded-full bg-line" aria-hidden="true" />
    </div>

    <div class="jc-timeline__toolbar flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
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
        v-if="hiddenBelow > 0"
        type="button"
        class="jc-timeline__more flex min-h-8 items-center rounded-full bg-fill px-3 text-[11px] font-semibold text-fill-fg"
        data-role="more-lanes"
        @click="scrollToBottom"
      >
        {{ $t('polish.timeline.moreLanes', { count: hiddenBelow }, hiddenBelow) }}
      </button>

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

    <div class="relative flex min-h-0 flex-1 flex-col">
    <div ref="body" class="jc-timeline__body min-h-0 flex-1 overflow-y-auto" @scroll="updateHidden">
    <div class="flex">
      <div class="jc-lane-labels w-[124px] shrink-0 border-r border-line">
        <div class="border-b border-line" :style="{ height: rulerHeight + 'px' }" />
        <div
          v-for="lane in lanes"
          :key="lane.id"
          class="flex items-center gap-1.5 border-b border-line/60 px-2.5 text-[11px] text-muted"
          :style="{ height: laneHeightPx(lane) + 'px' }"
        >
          <span class="size-2.5 shrink-0 rounded-sm" :style="{ background: lane.swatch }" aria-hidden="true" />
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
          class="jc-timeline__track relative select-none touch-none"
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
            :style="{ height: laneHeightPx(lane) + 'px' }"
            :data-lane="lane.id"
          >
            <TimelineItem
              v-for="item in lane.items"
              :key="item.key"
              :label="item.label"
              :aria-label="item.ariaLabel"
              :variant="item.variant"
              :row="item.row ?? 0"
              :lane-height="laneHeight"
              :inset="barInset"
              :tone="item.tone"
              :left="item.leftPx"
              :width="item.widthPx"
              :offset="offsetFor(item)"
              :selected="isSelected(item)"
              :interactive="item.ref !== null"
              :handles="handlesFor(item)"
              :more-button="coarse"
              :start-label="$t('timeline.trimStart')"
              :end-label="$t('timeline.trimEnd')"
              @select="onSelect(item)"
              @body-down="onBodyDown($event, item)"
              @handle-down="(edge, event) => onHandleDown(edge, event, item)"
              @context-menu="(event) => onItemContext(item, event)"
              @more="(button) => onItemMore(item, button)"
            />
            <template v-if="lane.id === 'video'">
              <div
                v-for="zone in transitionZones"
                :key="`zone-${zone.key}`"
                class="jc-transition-zone pointer-events-none absolute z-[5]"
                role="img"
                :aria-label="zone.label"
                :title="zone.label"
                data-role="transition-zone"
                :style="{ left: zone.leftPx + 'px', width: zone.widthPx + 'px', top: barInset + 'px', height: (laneHeight - 2 * barInset) + 'px' }"
              />
            </template>
          </div>

          <div
            v-if="dropPx !== null"
            class="pointer-events-none absolute z-20 w-[3px] -translate-x-px rounded-full bg-signal shadow-[0_0_0_1px_var(--jc-signal-fg)]"
            :style="{ left: dropPx + 'px', top: dropTop + 'px', height: (laneHeight - 2 * barInset) + 'px' }"
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
    </div>

    </div>

    <ItemContextMenu
      v-if="menu"
      :entries="menuEntries"
      :x="menu.x"
      :y="menu.y"
      :ariaLabel="$t('polish.menu.label')"
      @run="runMenu"
      @close="closeMenu"
    />
  </section>
</template>
