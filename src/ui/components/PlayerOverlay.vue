<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { CURATED_FONTS, canvasFont } from '../../core/text/fonts'
import { buildScene, planTimeline, type PlannedTimeline } from '../../core/render/scene'
import type { Scene, TextLayer } from '../../core/render/types'
import {
  axisLock,
  clamp,
  dragToTransformDelta,
  fittedFrameRect,
  pointInRotatedRect,
  previewSize,
  scaleFromHandle,
  snapToGuides,
  textRect,
  SNAP_GUIDES,
  STRONG_GUIDE,
  type Box,
  type TextBox,
  type TextLayerInput,
  type Point
} from '../../core/render/layout'
import { updateText } from '../../core/timeline/textOps'
import { setClipProps } from '../../core/timeline/ops'
import { updateOverlay } from '../../core/timeline/overlayOps'
import { LINE_WIDTHS } from '../../core/timeline/overlayCatalog'
import { overlayBox } from '../../core/render/overlayLayout'
import { findClipAt } from '../../core/timeline/edit'
import type { Clip, OverlayItem, Project, TextItem } from '../../core/project/types'
import { clearTextMeasureCache, measureLine } from '../player/textMeasure'

/** Snap distance in screen pixels, converted to output fractions per axis. */
const SNAP_PX = 8
const TEXT_SIZE_MIN = 8
const TEXT_SIZE_MAX = 400
const SCALE_MIN = 0.25
const SCALE_MAX = 4
const NUDGE = 0.01
const NUDGE_LARGE = 0.05
const DEFAULT_SRC = { width: 1920, height: 1080 }

type Corner = { sx: -1 | 1; sy: -1 | 1; key: string }
const CORNERS: readonly Corner[] = [
  { sx: -1, sy: -1, key: 'tl' },
  { sx: 1, sy: -1, key: 'tr' },
  { sx: 1, sy: 1, key: 'br' },
  { sx: -1, sy: 1, key: 'bl' }
]

/** One pointer press on a box. Values are the ones at press time; every edit is computed from them. */
interface Drag {
  kind: 'move' | 'scale' | 'rotate'
  target: 'text' | 'clip' | 'overlay'
  id: string
  /** Rotation only: the anchor in output pixels and the pointer angle at press time (degrees). */
  pivot?: Point
  startAngle?: number
  pointerX: number
  pointerY: number
  /** Output pixels per screen pixel at press time. */
  outPerPx: number
  originX: number
  originY: number
  startBox: Box
  startValue: number
  corner: Corner | null
  moved: boolean
}

interface BoxView {
  box: Box
  id: string
  name: string
}

// Not reactive on purpose: a press is only needed between its down and up events.
let drag: Drag | null = null
/** Pointer that is drawing a stroke, while drawing mode is on. */
let drawPointer: number | null = null

/** Clockwise angle of p around pivot, in degrees (screen space, y down). */
function angleDeg(pivot: Point, p: Point): number {
  return (Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180) / Math.PI
}

function boxStyle(box: Box, outW: number, outH: number): Record<string, string> {
  return {
    left: `${((box.cx - box.w / 2) / outW) * 100}%`,
    top: `${((box.cy - box.h / 2) / outH) * 100}%`,
    width: `${(box.w / outW) * 100}%`,
    height: `${(box.h / outH) * 100}%`,
    transform: box.rotationDeg ? `rotate(${box.rotationDeg}deg)` : 'none'
  }
}

export default defineComponent({
  name: 'PlayerOverlay',
  props: {
    /** Output format; the overlay uses the same (preview) size as the canvas, so the geometry matches. */
    format: { type: Object as PropType<Project['format']>, required: true }
  },
  data() {
    return {
      guideX: null as number | null,
      guideY: null as number | null,
      dragging: false,
      fontTick: 0,
      corners: CORNERS,
      snapGuides: SNAP_GUIDES,
      strongGuide: STRONG_GUIDE,
      /** Points of the stroke being drawn, in output pixels. */
      livePoints: [] as Point[]
    }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'selection', 'selectedClip', 'selectedOverlay', 'playheadMicros', 'drawing', 'overlayColor', 'penWidth']),
    /** Pen width on screen, as the stroke will be drawn in the output. */
    livePenPx(): number {
      return LINE_WIDTHS[this.penWidth] * this.outH
    },
    livePolyline(): string {
      return this.livePoints.map((p) => `${p.x},${p.y}`).join(' ')
    },
    size(): { width: number; height: number } {
      return previewSize(this.format)
    },
    outW(): number {
      return this.size.width
    },
    outH(): number {
      return this.size.height
    },
    planned(): PlannedTimeline {
      return planTimeline(this.project)
    },
    scene(): Scene {
      return buildScene(this.project, this.planned, this.playheadMicros)
    },
    selectedText(): TextItem | null {
      if (this.selection?.kind !== 'text') return null
      return this.project.texts.find((t) => t.id === this.selection?.id) ?? null
    },
    textView(): BoxView | null {
      const item = this.selectedText
      if (!item) return null
      // While the text is on screen the box follows the drawn layer, including its animation.
      const layer: TextLayer = this.scene.texts.find((t) => t.id === item.id) ?? {
        id: item.id,
        text: item.text,
        style: item.style,
        pos: item.pos,
        alpha: 1,
        scale: 1,
        offsetY: 0
      }
      const box = this.measureBox(layer, item.style.font)
      return box ? { box, id: item.id, name: item.text } : null
    },
    clipView(): BoxView | null {
      const clip = this.selectedClip
      if (!clip) return null
      const asset = this.project.assets.find((a) => a.id === clip.assetId)
      const src = { width: asset?.width ?? DEFAULT_SRC.width, height: asset?.height ?? DEFAULT_SRC.height }
      const box = fittedFrameRect(this.outW, this.outH, src.width, src.height, clip.transform)
      return { box, id: clip.id, name: asset?.name ?? '' }
    },
    /** The selected sticker, shape or stroke; its box is shown whether or not it is on screen at the playhead. */
    overlayView(): BoxView | null {
      const item = this.selectedOverlay
      if (!item) return null
      return { box: overlayBox(item, this.outW, this.outH), id: item.id, name: this.overlayLabel(item) }
    }
  },
  mounted() {
    void Promise.all(CURATED_FONTS.map((f) => document.fonts.load(canvasFont(f.family, 32))))
      .catch(() => undefined)
      .then(() => {
        clearTextMeasureCache()
        this.fontTick++
      })
  },
  beforeUnmount() {
    if (drag) this.endPress()
  },
  methods: {
    ...mapActions(useEditorStore, [
      'select',
      'deleteSelected',
      'beginGesture',
      'endGesture',
      'editProject',
      'updateSelectedText',
      'setSelectedClipProps',
      'addStrokeAtPlayhead'
    ]),
    rootEl(): HTMLElement | null {
      return this.$refs.root as HTMLElement | null
    },
    /** Output pixel under a screen point, using the overlay box (it covers the canvas exactly). */
    toOutput(clientX: number, clientY: number): Point {
      const rect = this.rootEl()?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
      return {
        x: ((clientX - rect.left) / rect.width) * this.outW,
        y: ((clientY - rect.top) / rect.height) * this.outH
      }
    },
    outPerPx(): number {
      const rect = this.rootEl()?.getBoundingClientRect()
      return rect && rect.width > 0 ? this.outW / rect.width : 1
    },
    boxStyle(view: BoxView): Record<string, string> {
      return boxStyle(view.box, this.outW, this.outH)
    },

    // --- selecting by clicking the picture ---
    onPictureDown(event: PointerEvent): void {
      if (event.button !== 0) return
      const p = this.toOutput(event.clientX, event.clientY)
      const overlayId = this.overlayAt(p)
      if (overlayId) {
        this.select({ kind: 'overlay', id: overlayId })
        return
      }
      const textId = this.textAt(p)
      if (textId) {
        this.select({ kind: 'text', id: textId })
        return
      }
      const clip: Clip | undefined = findClipAt(this.planned.clips, this.playheadMicros)
      this.select(clip ? { kind: 'clip', id: clip.id } : null)
    },
    /** The topmost sticker, shape or stroke on screen at the playhead whose box contains the point. */
    overlayAt(p: Point): string | null {
      for (const item of [...this.scene.overlays].reverse()) {
        if (pointInRotatedRect(p, overlayBox(item, this.outW, this.outH))) return item.id
      }
      return null
    },
    /** Short name for the box label and the aria text: the emoji, or the kind of shape or stroke. */
    overlayLabel(item: OverlayItem): string {
      if (item.kind === 'sticker') return item.emoji
      if (item.kind === 'shape') return this.$t(`overlays.shape.${item.shape}`)
      return this.$t('overlays.header.stroke')
    },
    /** Glyph box of a text layer; reading fontTick makes it measure again once the curated fonts have loaded. */
    measureBox(layer: TextLayerInput, family: string): TextBox | null {
      return textRect(this.outW, this.outH, layer, (line, px) => {
        void this.fontTick
        return measureLine(line, px, family)
      })
    },
    /** The topmost text whose glyph box contains the output point. */
    textAt(p: Point): string | null {
      for (const layer of [...this.scene.texts].reverse()) {
        const family = this.project.texts.find((t) => t.id === layer.id)?.style.font ?? 'Sora'
        const box = this.measureBox(layer, family)
        if (box && pointInRotatedRect(p, box)) return layer.id
      }
      return null
    },

    // --- gestures ---
    startPress(event: PointerEvent, partial: Omit<Drag, 'pointerX' | 'pointerY' | 'outPerPx' | 'moved'>): void {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      drag = { ...partial, pointerX: event.clientX, pointerY: event.clientY, outPerPx: this.outPerPx(), moved: false }
      this.dragging = true
      this.beginGesture()
    },
    onTextMoveDown(event: PointerEvent, view: BoxView): void {
      if (event.button !== 0) return
      const item = this.selectedText
      if (!item) return
      this.startPress(event, {
        kind: 'move',
        target: 'text',
        id: view.id,
        originX: item.pos.x,
        originY: item.pos.y,
        startBox: view.box,
        startValue: item.style.size,
        corner: null
      })
    },
    onTextScaleDown(event: PointerEvent, view: BoxView, corner: Corner): void {
      if (event.button !== 0) return
      const item = this.selectedText
      if (!item) return
      this.startPress(event, {
        kind: 'scale',
        target: 'text',
        id: view.id,
        originX: item.pos.x,
        originY: item.pos.y,
        startBox: view.box,
        startValue: item.style.size,
        corner
      })
    },
    onClipMoveDown(event: PointerEvent, view: BoxView): void {
      if (event.button !== 0) return
      // The picture box covers the whole picture; a sticker or text on top of it is what the user means to pick.
      const point = this.toOutput(event.clientX, event.clientY)
      const overlayId = this.overlayAt(point)
      if (overlayId) {
        this.select({ kind: 'overlay', id: overlayId })
        return
      }
      const textId = this.textAt(point)
      if (textId) {
        this.select({ kind: 'text', id: textId })
        return
      }
      const clip = this.selectedClip
      if (!clip) return
      this.startPress(event, {
        kind: 'move',
        target: 'clip',
        id: view.id,
        originX: clip.transform.x,
        originY: clip.transform.y,
        startBox: view.box,
        startValue: clip.transform.scale,
        corner: null
      })
    },
    onClipScaleDown(event: PointerEvent, view: BoxView, corner: Corner): void {
      if (event.button !== 0) return
      const clip = this.selectedClip
      if (!clip) return
      this.startPress(event, {
        kind: 'scale',
        target: 'clip',
        id: view.id,
        originX: clip.transform.x,
        originY: clip.transform.y,
        startBox: view.box,
        startValue: clip.transform.scale,
        corner
      })
    },
    onOverlayMoveDown(event: PointerEvent, view: BoxView): void {
      if (event.button !== 0) return
      const item = this.selectedOverlay
      if (!item) return
      this.startPress(event, {
        kind: 'move',
        target: 'overlay',
        id: view.id,
        originX: item.pos.x,
        originY: item.pos.y,
        startBox: view.box,
        startValue: item.scale,
        corner: null
      })
    },
    onOverlayScaleDown(event: PointerEvent, view: BoxView, corner: Corner): void {
      if (event.button !== 0) return
      const item = this.selectedOverlay
      if (!item) return
      this.startPress(event, {
        kind: 'scale',
        target: 'overlay',
        id: view.id,
        originX: item.pos.x,
        originY: item.pos.y,
        startBox: view.box,
        startValue: item.scale,
        corner
      })
    },
    /** Rotation turns around the anchor (pos), the point the item is placed by. */
    onOverlayRotateDown(event: PointerEvent, view: BoxView): void {
      if (event.button !== 0) return
      const item = this.selectedOverlay
      if (!item) return
      const pivot = { x: item.pos.x * this.outW, y: item.pos.y * this.outH }
      const p = this.toOutput(event.clientX, event.clientY)
      this.startPress(event, {
        kind: 'rotate',
        target: 'overlay',
        id: view.id,
        originX: item.pos.x,
        originY: item.pos.y,
        startBox: view.box,
        startValue: item.rotation,
        corner: null,
        pivot,
        startAngle: angleDeg(pivot, p)
      })
    },
    /** Moves the anchor; Shift locks the axis, the centre snaps to the guides unless Alt is held. */
    dragOverlay(d: Drag, dxPx: number, dyPx: number, shift: boolean, alt: boolean): void {
      const { dx, dy, lockX, lockY } = lockAxis(dxPx, dyPx, shift)
      const delta = dragToTransformDelta(dx, dy, this.outW, this.outH)
      let x = clamp(d.originX + delta.x, 0, 1)
      let y = clamp(d.originY + delta.y, 0, 1)
      if (lockX) x = d.originX
      if (lockY) y = d.originY
      const snap = this.snapAxes(x, y, d, alt, lockX, lockY)
      const id = d.id
      this.editProject((base) => updateOverlay(base, id, { pos: { x: snap.x, y: snap.y } }), `overlay-drag:${id}`)
    },
    scaleOverlay(d: Drag, event: PointerEvent): void {
      if (!d.corner) return
      const scale = scaleFromHandle(d.startBox, d.corner, this.toOutput(event.clientX, event.clientY), d.startValue, SCALE_MIN, SCALE_MAX)
      const id = d.id
      this.editProject((base) => updateOverlay(base, id, { scale }), `overlay-scale:${id}`)
    },
    rotateOverlay(d: Drag, event: PointerEvent): void {
      if (!d.pivot || d.startAngle === undefined) return
      let rotation = d.startValue + (angleDeg(d.pivot, this.toOutput(event.clientX, event.clientY)) - d.startAngle)
      // Shift snaps to 15 degree steps.
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15
      const id = d.id
      this.editProject((base) => updateOverlay(base, id, { rotation }), `overlay-rotate:${id}`)
    },
    onOverlayKey(event: KeyboardEvent, view: BoxView): void {
      if (this.handleCommonKey(event)) return
      const item = this.selectedOverlay
      if (!item) return
      const delta = arrowDelta(event.key, event.shiftKey ? NUDGE_LARGE : NUDGE)
      if (!delta) return
      event.preventDefault()
      const x = clamp(item.pos.x + delta.x, 0, 1)
      const y = clamp(item.pos.y + delta.y, 0, 1)
      this.editProject((base) => updateOverlay(base, view.id, { pos: { x, y } }), `overlay-nudge:${view.id}`)
    },

    // --- drawing mode: one pointer press makes one stroke ---
    onDrawDown(event: PointerEvent): void {
      if (event.button !== 0) return
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      drawPointer = event.pointerId
      this.livePoints = [this.toOutput(event.clientX, event.clientY)]
    },
    onDrawMove(event: PointerEvent): void {
      if (event.pointerId !== drawPointer) return
      const p = this.toOutput(event.clientX, event.clientY)
      const last = this.livePoints[this.livePoints.length - 1]
      // Points closer than half a pixel add nothing visible; skipping them keeps the stroke light.
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return
      this.livePoints.push(p)
    },
    onDrawUp(event: PointerEvent): void {
      if (event.pointerId !== drawPointer) return
      drawPointer = null
      const points = this.livePoints
      this.livePoints = []
      if (points.length < 2) return
      const w = this.outW
      const h = this.outH
      this.addStrokeAtPlayhead(points.map((p) => ({ x: p.x / w, y: p.y / h })))
    },
    onMove(event: PointerEvent): void {
      const d = drag
      if (!d) return
      if (event.buttons === 0) {
        this.endPress()
        return
      }
      const dxPx = (event.clientX - d.pointerX) * d.outPerPx
      const dyPx = (event.clientY - d.pointerY) * d.outPerPx
      if (!d.moved && dxPx === 0 && dyPx === 0) return
      d.moved = true
      if (d.kind === 'rotate') {
        this.rotateOverlay(d, event)
      } else if (d.kind === 'move') {
        if (d.target === 'text') this.dragText(d, dxPx, dyPx, event.shiftKey, event.altKey)
        else if (d.target === 'overlay') this.dragOverlay(d, dxPx, dyPx, event.shiftKey, event.altKey)
        else this.dragClip(d, dxPx, dyPx, event.shiftKey, event.altKey)
      } else if (d.target === 'overlay') {
        this.scaleOverlay(d, event)
      } else {
        this.scaleBox(d, event)
      }
    },
    /**
     * Moves the text anchor. Shift locks the dominant axis. Unless Alt is held, the centre snaps to the
     * centre, thirds and quarter lines on both axes within 8 screen pixels.
     */
    dragText(d: Drag, dxPx: number, dyPx: number, shift: boolean, alt: boolean): void {
      const { dx, dy, lockX, lockY } = lockAxis(dxPx, dyPx, shift)
      const delta = dragToTransformDelta(dx, dy, this.outW, this.outH)
      let x = clamp(d.originX + delta.x, 0, 1)
      let y = clamp(d.originY + delta.y, 0, 1)
      if (lockX) x = d.originX
      if (lockY) y = d.originY
      const snap = this.snapAxes(x, y, d, alt, lockX, lockY)
      const id = d.id
      this.editProject((base) => updateText(base, id, { pos: { x: snap.x, y: snap.y } }), `text-drag:${id}`)
    },
    dragClip(d: Drag, dxPx: number, dyPx: number, shift: boolean, alt: boolean): void {
      const { dx, dy, lockX, lockY } = lockAxis(dxPx, dyPx, shift)
      const delta = dragToTransformDelta(dx, dy, this.outW, this.outH)
      // transform.x/y are offsets from the centre, so the picture centre is 0.5 + x.
      let x = clamp(d.originX + delta.x, -1, 1)
      let y = clamp(d.originY + delta.y, -1, 1)
      if (lockX) x = d.originX
      if (lockY) y = d.originY
      const snap = this.snapAxes(clamp(x + 0.5, 0, 1), clamp(y + 0.5, 0, 1), d, alt, lockX, lockY)
      const id = d.id
      const transform = { x: snap.x - 0.5, y: snap.y - 0.5 }
      this.editProject((base) => setClipProps(base, id, { transform }), `clip-move:${id}`)
    },
    /** Snaps the centre (fractions of the output) to the guide lines; shows the guide that was hit. */
    snapAxes(x: number, y: number, d: Drag, alt: boolean, lockX: boolean, lockY: boolean): { x: number; y: number } {
      if (alt) {
        this.guideX = null
        this.guideY = null
        return { x, y }
      }
      const snapX = (SNAP_PX * d.outPerPx) / this.outW
      const snapY = (SNAP_PX * d.outPerPx) / this.outH
      const sx = lockX ? { value: x, guide: null } : snapToGuides(x, SNAP_GUIDES, snapX)
      const sy = lockY ? { value: y, guide: null } : snapToGuides(y, SNAP_GUIDES, snapY)
      this.guideX = sx.guide
      this.guideY = sy.guide
      return { x: sx.value, y: sy.value }
    },
    scaleBox(d: Drag, event: PointerEvent): void {
      if (!d.corner) return
      const p = this.toOutput(event.clientX, event.clientY)
      const id = d.id
      if (d.target === 'text') {
        const size = Math.round(scaleFromHandle(d.startBox, d.corner, p, d.startValue, TEXT_SIZE_MIN, TEXT_SIZE_MAX))
        // The glyph box sits off the anchor by an amount that grows with the size, so the anchor
        // moves to keep the box centre where the press found it.
        const item = this.selectedText
        if (!item) return
        const offset = textRect(this.outW, this.outH, { text: item.text, style: { size, outline: item.style.outline }, pos: { x: 0, y: 0 } }, (line, px) =>
          measureLine(line, px, item.style.font)
        )
        if (!offset) return
        const x = clamp((d.startBox.cx - offset.cx) / this.outW, 0, 1)
        const y = clamp((d.startBox.cy - offset.cy) / this.outH, 0, 1)
        this.editProject((base) => updateText(base, id, { style: { size }, pos: { x, y } }), `text-size:${id}`)
      } else {
        const scale = scaleFromHandle(d.startBox, d.corner, p, d.startValue, SCALE_MIN, SCALE_MAX)
        this.editProject((base) => setClipProps(base, id, { transform: { scale } }), `clip-scale:${id}`)
      }
    },
    onUp(): void {
      if (drag) this.endPress()
    },
    endPress(): void {
      drag = null
      this.dragging = false
      this.guideX = null
      this.guideY = null
      this.endGesture()
    },

    // --- double click and keyboard ---
    onTextDoubleClick(view: BoxView): void {
      if (typeof document === 'undefined') return
      document.getElementById(`text-content-${view.id}`)?.focus()
    },
    onClipDoubleClick(): void {
      this.setSelectedClipProps({ transform: { scale: 1, x: 0, y: 0 } })
    },
    onTextKey(event: KeyboardEvent, view: BoxView): void {
      if (this.handleCommonKey(event)) return
      const step = event.shiftKey ? NUDGE_LARGE : NUDGE
      const item = this.selectedText
      if (!item) return
      const delta = arrowDelta(event.key, step)
      if (!delta) return
      event.preventDefault()
      const x = clamp(item.pos.x + delta.x, 0, 1)
      const y = clamp(item.pos.y + delta.y, 0, 1)
      this.updateSelectedText({ pos: { x, y } }, `text-nudge:${view.id}`)
    },
    onClipKey(event: KeyboardEvent, view: BoxView): void {
      if (this.handleCommonKey(event)) return
      const step = event.shiftKey ? NUDGE_LARGE : NUDGE
      const clip = this.selectedClip
      if (!clip) return
      const delta = arrowDelta(event.key, step)
      if (!delta) return
      event.preventDefault()
      const x = clamp(clip.transform.x + delta.x, -1, 1)
      const y = clamp(clip.transform.y + delta.y, -1, 1)
      this.setSelectedClipProps({ transform: { x, y } }, `clip-nudge:${view.id}`)
    },
    handleCommonKey(event: KeyboardEvent): boolean {
      if (event.key !== 'Delete') return false
      event.preventDefault()
      this.deleteSelected()
      return true
    }
  }
})

/** With Shift the movement keeps only the dominant axis; the other axis stays where it was. */
function lockAxis(dxPx: number, dyPx: number, shift: boolean): { dx: number; dy: number; lockX: boolean; lockY: boolean } {
  if (!shift) return { dx: dxPx, dy: dyPx, lockX: false, lockY: false }
  const lock = axisLock(dxPx, dyPx)
  const horizontal = lock.y === 0
  return { dx: lock.x, dy: lock.y, lockX: !horizontal, lockY: horizontal }
}

function arrowDelta(key: string, step: number): Point | null {
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 }
    case 'ArrowRight':
      return { x: step, y: 0 }
    case 'ArrowUp':
      return { x: 0, y: -step }
    case 'ArrowDown':
      return { x: 0, y: step }
    default:
      return null
  }
}
</script>

<template>
  <div ref="root" class="pointer-events-none absolute inset-0 z-[5]" data-player-overlay>
    <!-- Clicking the picture selects; boxes sit above this layer and take their own pointer events. -->
    <div class="pointer-events-auto absolute inset-0" data-role="pick" @pointerdown="onPictureDown" />

    <!-- While dragging, every snap line is faint; the one being snapped to is bright. The centre line is the strong one. -->
    <template v-if="dragging">
      <div
        v-for="g in snapGuides"
        :key="`fx-${g}`"
        class="pointer-events-none absolute inset-y-0 z-[8] w-px -translate-x-px bg-signal/30"
        :style="{ left: `${g * 100}%` }"
        data-role="guide-candidate-x"
        aria-hidden="true"
      />
      <div
        v-for="g in snapGuides"
        :key="`fy-${g}`"
        class="pointer-events-none absolute inset-x-0 z-[8] h-px -translate-y-px bg-signal/30"
        :style="{ top: `${g * 100}%` }"
        data-role="guide-candidate-y"
        aria-hidden="true"
      />
    </template>
    <div
      v-if="guideX !== null"
      class="pointer-events-none absolute inset-y-0 z-[9] -translate-x-px bg-signal shadow-[0_0_0_1px_rgba(20,18,31,0.5)]"
      :class="guideX === strongGuide ? 'w-[2px]' : 'w-px'"
      :style="{ left: `${(guideX ?? 0) * 100}%` }"
      data-role="guide-x"
      aria-hidden="true"
    />
    <div
      v-if="guideY !== null"
      class="pointer-events-none absolute inset-x-0 z-[9] -translate-y-px bg-signal shadow-[0_0_0_1px_rgba(20,18,31,0.5)]"
      :class="guideY === strongGuide ? 'h-[2px]' : 'h-px'"
      :style="{ top: `${(guideY ?? 0) * 100}%` }"
      data-role="guide-y"
      aria-hidden="true"
    />

    <!-- Drawing mode: the surface takes every pointer; the live stroke is a preview, the committed one is drawn by the engine. -->
    <div
      v-if="drawing"
      class="pointer-events-auto absolute inset-0 z-[12] touch-none cursor-crosshair"
      :aria-label="$t('overlays.player.surface')"
      role="img"
      data-role="draw-surface"
      @pointerdown="onDrawDown"
      @pointermove="onDrawMove"
      @pointerup="onDrawUp"
      @pointercancel="onDrawUp"
    >
      <span class="pointer-events-none absolute left-2 top-2 rounded-full bg-signal px-2 py-0.5 text-[11px] font-semibold text-signal-fg">
        {{ $t('overlays.player.drawing') }}
      </span>
    </div>
    <svg
      v-if="drawing && livePoints.length > 1"
      class="pointer-events-none absolute inset-0 z-[13] h-full w-full"
      :viewBox="`0 0 ${outW} ${outH}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        :points="livePolyline"
        fill="none"
        :stroke="overlayColor"
        :stroke-width="livePenPx"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>

    <div
      v-if="overlayView && !drawing"
      class="pointer-events-auto absolute z-10 touch-none rounded-[2px] border-2 border-signal shadow-[0_0_0_1px_rgba(20,18,31,0.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
      role="group"
      tabindex="0"
      :aria-label="$t('overlays.player.box', { name: overlayView.name })"
      :style="boxStyle(overlayView)"
      data-role="overlay-box"
      @pointerdown="onOverlayMoveDown($event, overlayView)"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @keydown="onOverlayKey($event, overlayView)"
    >
      <button
        v-for="corner in corners"
        :key="corner.key"
        type="button"
        class="absolute z-10 size-3.5 touch-none rounded-[3px] border border-signal-fg bg-signal before:absolute before:-inset-3.5 before:content-['']"
        :style="{
          left: corner.sx < 0 ? '8px' : 'calc(100% - 8px)',
          top: corner.sy < 0 ? '8px' : 'calc(100% - 8px)',
          transform: 'translate(-50%, -50%)',
          cursor: corner.sx * corner.sy > 0 ? 'nwse-resize' : 'nesw-resize'
        }"
        :aria-label="$t('overlays.player.scale')"
        @pointerdown.stop="onOverlayScaleDown($event, overlayView, corner)"
      />
      <button
        type="button"
        class="absolute left-1/2 -top-8 z-10 size-4 -translate-x-1/2 touch-none rounded-full border-2 border-signal-fg bg-signal before:absolute before:-inset-3 before:content-['']"
        :aria-label="$t('overlays.player.rotate')"
        :title="$t('overlays.player.rotate')"
        data-role="overlay-rotate"
        @pointerdown.stop="onOverlayRotateDown($event, overlayView)"
      />
      <button
        type="button"
        class="absolute left-1/2 top-1/2 z-10 size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-signal-fg bg-signal before:absolute before:-inset-3 before:content-['']"
        :aria-label="$t('overlays.player.move')"
        :title="$t('overlays.player.move')"
        @pointerdown.stop="onOverlayMoveDown($event, overlayView)"
      />
    </div>

    <div
      v-if="clipView"
      class="pointer-events-auto absolute z-10 touch-none rounded-[2px] border-2 border-signal shadow-[0_0_0_1px_rgba(20,18,31,0.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
      role="group"
      tabindex="0"
      :aria-label="$t('player.overlay.clipBox', { name: clipView.name })"
      :style="boxStyle(clipView)"
      data-role="clip-box"
      @pointerdown="onClipMoveDown($event, clipView)"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dblclick="onClipDoubleClick()"
      @keydown="onClipKey($event, clipView)"
    >
      <button
        v-for="corner in corners"
        :key="corner.key"
        type="button"
        class="absolute z-10 size-3.5 touch-none rounded-[3px] border border-signal-fg bg-signal before:absolute before:-inset-3.5 before:content-['']"
        :style="{
          left: corner.sx < 0 ? '8px' : 'calc(100% - 8px)',
          top: corner.sy < 0 ? '8px' : 'calc(100% - 8px)',
          transform: 'translate(-50%, -50%)',
          cursor: corner.sx * corner.sy > 0 ? 'nwse-resize' : 'nesw-resize'
        }"
        :aria-label="$t('player.overlay.scale')"
        @pointerdown.stop="onClipScaleDown($event, clipView, corner)"
      />
      <button
        type="button"
        class="absolute left-1/2 top-1/2 z-10 size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-signal-fg bg-signal before:absolute before:-inset-3 before:content-['']"
        :aria-label="$t('player.overlay.move')"
        :title="$t('player.overlay.move')"
        @pointerdown.stop="onClipMoveDown($event, clipView)"
      />
    </div>

    <div
      v-if="textView"
      class="pointer-events-auto absolute z-10 touch-none rounded-[2px] border-2 border-signal shadow-[0_0_0_1px_rgba(20,18,31,0.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
      role="group"
      tabindex="0"
      :aria-label="$t('player.overlay.textBox', { text: textView.name })"
      :style="boxStyle(textView)"
      data-role="text-box"
      @pointerdown="onTextMoveDown($event, textView)"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dblclick="onTextDoubleClick(textView)"
      @keydown="onTextKey($event, textView)"
    >
      <button
        v-for="corner in corners"
        :key="corner.key"
        type="button"
        class="absolute z-10 size-3.5 touch-none rounded-[3px] border border-signal-fg bg-signal before:absolute before:-inset-3.5 before:content-['']"
        :style="{
          left: corner.sx < 0 ? '8px' : 'calc(100% - 8px)',
          top: corner.sy < 0 ? '8px' : 'calc(100% - 8px)',
          transform: 'translate(-50%, -50%)',
          cursor: corner.sx * corner.sy > 0 ? 'nwse-resize' : 'nesw-resize'
        }"
        :aria-label="$t('player.overlay.scale')"
        @pointerdown.stop="onTextScaleDown($event, textView, corner)"
      />
      <button
        type="button"
        class="absolute left-1/2 top-1/2 z-10 size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-signal-fg bg-signal before:absolute before:-inset-3 before:content-['']"
        :aria-label="$t('player.overlay.move')"
        :title="$t('player.overlay.move')"
        @pointerdown.stop="onTextMoveDown($event, textView)"
      />
    </div>
  </div>
</template>
