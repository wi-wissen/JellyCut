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
  fittedFrameRect,
  pointInRotatedRect,
  previewSize,
  scaleFromHandle,
  snapToGuides,
  textRect,
  THIRDS_GUIDES,
  type Box,
  type Point
} from '../../core/render/layout'
import { updateText } from '../../core/timeline/textOps'
import { setClipProps } from '../../core/timeline/ops'
import { findClipAt } from '../../core/timeline/edit'
import type { Clip, Project, TextItem } from '../../core/project/types'
import { clearTextMeasureCache, measureTextBox } from '../player/textMeasure'

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
  kind: 'move' | 'scale'
  target: 'text' | 'clip'
  id: string
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
    return { guideX: null as number | null, guideY: null as number | null, fontTick: 0, corners: CORNERS }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'selection', 'selectedClip', 'playheadMicros']),
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
      const family = item.style.font
      const box = textRect(this.outW, this.outH, layer, (text, px) => {
        // Reading fontTick re-measures once the curated fonts have loaded.
        void this.fontTick
        return measureTextBox(text, px, family)
      })
      return box ? { box, id: item.id, name: item.text } : null
    },
    clipView(): BoxView | null {
      const clip = this.selectedClip
      if (!clip) return null
      const asset = this.project.assets.find((a) => a.id === clip.assetId)
      const src = { width: asset?.width ?? DEFAULT_SRC.width, height: asset?.height ?? DEFAULT_SRC.height }
      const box = fittedFrameRect(this.outW, this.outH, src.width, src.height, clip.transform)
      return { box, id: clip.id, name: asset?.name ?? '' }
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
      'setSelectedClipProps'
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
      // Topmost text first: texts are drawn in project order, so the last one is on top.
      const texts = [...this.scene.texts].reverse()
      for (const layer of texts) {
        const box = textRect(this.outW, this.outH, layer, (text, px) => measureTextBox(text, px, this.fontFamily(layer.id)))
        if (box && pointInRotatedRect(p, box)) {
          this.select({ kind: 'text', id: layer.id })
          return
        }
      }
      const clip: Clip | undefined = findClipAt(this.planned.clips, this.playheadMicros)
      this.select(clip ? { kind: 'clip', id: clip.id } : null)
    },
    fontFamily(id: string): string {
      return this.project.texts.find((t) => t.id === id)?.style.font ?? 'Sora'
    },

    // --- gestures ---
    startPress(event: PointerEvent, partial: Omit<Drag, 'pointerX' | 'pointerY' | 'outPerPx' | 'moved'>): void {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      drag = { ...partial, pointerX: event.clientX, pointerY: event.clientY, outPerPx: this.outPerPx(), moved: false }
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
      if (d.kind === 'move') {
        if (d.target === 'text') this.dragText(d, dxPx, dyPx, event.shiftKey)
        else this.dragClip(d, dxPx, dyPx, event.shiftKey)
      } else {
        this.scaleBox(d, event)
      }
    },
    /** Moves the text centre; Shift locks the axis, both axes snap to the centre and thirds lines. */
    dragText(d: Drag, dxPx: number, dyPx: number, shift: boolean): void {
      const { dx, dy, lockX, lockY } = lockAxis(dxPx, dyPx, shift)
      let x = clamp(d.originX + dx / this.outW, 0, 1)
      let y = clamp(d.originY + dy / this.outH, 0, 1)
      let guideX: number | null = null
      let guideY: number | null = null
      if (!lockX) {
        const s = snapToGuides(x, THIRDS_GUIDES, SNAP_PX / this.outW)
        x = s.value
        guideX = s.guide
      } else {
        x = d.originX
      }
      if (!lockY) {
        const s = snapToGuides(y, THIRDS_GUIDES, SNAP_PX / this.outH)
        y = s.value
        guideY = s.guide
      } else {
        y = d.originY
      }
      this.guideX = guideX
      this.guideY = guideY
      const id = d.id
      this.editProject((base) => updateText(base, id, { pos: { x, y } }), `text-drag:${id}`)
    },
    dragClip(d: Drag, dxPx: number, dyPx: number, shift: boolean): void {
      const { dx, dy } = lockAxis(dxPx, dyPx, shift)
      const x = clamp(d.originX + dx / this.outW, -1, 1)
      const y = clamp(d.originY + dy / this.outH, -1, 1)
      const id = d.id
      this.editProject((base) => setClipProps(base, id, { transform: { x, y } }), `clip-move:${id}`)
    },
    scaleBox(d: Drag, event: PointerEvent): void {
      if (!d.corner) return
      const p = this.toOutput(event.clientX, event.clientY)
      const id = d.id
      if (d.target === 'text') {
        const size = Math.round(scaleFromHandle(d.startBox, d.corner, p, d.startValue, TEXT_SIZE_MIN, TEXT_SIZE_MAX))
        this.editProject((base) => updateText(base, id, { style: { size } }), `text-size:${id}`)
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

    <div
      v-if="guideX !== null"
      class="pointer-events-none absolute inset-y-0 z-[9] w-px -translate-x-px bg-signal shadow-[0_0_0_1px_rgba(20,18,31,0.5)]"
      :style="{ left: `${(guideX ?? 0) * 100}%` }"
      data-role="guide-x"
      aria-hidden="true"
    />
    <div
      v-if="guideY !== null"
      class="pointer-events-none absolute inset-x-0 z-[9] h-px -translate-y-px bg-signal shadow-[0_0_0_1px_rgba(20,18,31,0.5)]"
      :style="{ top: `${(guideY ?? 0) * 100}%` }"
      data-role="guide-y"
      aria-hidden="true"
    />

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
          left: corner.sx < 0 ? '0' : '100%',
          top: corner.sy < 0 ? '0' : '100%',
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
          left: corner.sx < 0 ? '0' : '100%',
          top: corner.sy < 0 ? '0' : '100%',
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
