<script lang="ts">
import { defineComponent, type Component, type PropType } from 'vue'
import {
  ArrowUpRight,
  Blend,
  ChevronDown,
  Circle,
  CircleDot,
  Captions,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  Crosshair,
  FlipHorizontal2,
  Gauge,
  Image,
  Magnet,
  Mic,
  Monitor,
  Moon,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  RectangleHorizontal,
  Redo2,
  RotateCw,
  Scissors,
  SkipBack,
  SkipForward,
  Smile,
  SlidersHorizontal,
  Sun,
  Square,
  Trash2,
  Type,
  Undo2,
  Video,
  VolumeX,
  ZoomIn,
  ZoomOut
} from 'lucide-vue-next'

/** Our icon names mapped to Lucide components (ISC licence). */
const ICONS: Record<string, Component> = {
  play: Play,
  pause: Pause,
  back: SkipBack,
  fwd: SkipForward,
  split: Scissors,
  fineCut: Crosshair,
  copy: Copy,
  flip: FlipHorizontal2,
  rotate: RotateCw,
  speed: Gauge,
  mute: VolumeX,
  trash: Trash2,
  undo: Undo2,
  redo: Redo2,
  magnet: Magnet,
  media: Image,
  audio: Music,
  record: CircleDot,
  mic: Mic,
  camera: Video,
  screen: Monitor,
  stop: Square,
  text: Type,
  sticker: Smile,
  draw: Pencil,
  shapeRect: RectangleHorizontal,
  shapeEllipse: Circle,
  shapeArrow: ArrowUpRight,
  captions: Captions,
  filter: SlidersHorizontal,
  transition: Blend,
  zoomOut: ZoomOut,
  zoomIn: ZoomIn,
  ratio: RectangleHorizontal,
  sun: Sun,
  moon: Moon,
  plus: Plus,
  chevronDown: ChevronDown,
  filePlus: FilePlus,
  folderOpen: FolderOpen,
  save: Save,
  download: Download
}

export default defineComponent({
  name: 'Icon',
  props: {
    name: {
      type: String as PropType<string>,
      required: true,
      validator: (value: string) => value in ICONS
    }
  },
  computed: {
    icon(): Component | undefined {
      return ICONS[this.name]
    }
  }
})
</script>

<template>
  <component :is="icon" :size="'1em'" :stroke-width="2" aria-hidden="true" focusable="false" />
</template>
