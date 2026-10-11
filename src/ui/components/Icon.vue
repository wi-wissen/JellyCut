<script lang="ts">
import { defineComponent, type PropType } from 'vue'

/** 24x24 stroke icons. Each entry is a list of path data strings. */
const PATHS: Record<string, string[]> = {
  play: ['M7 4.5v15l12.5-7.5z'],
  pause: ['M8 5v14', 'M16 5v14'],
  back: ['M6 5v14', 'M18 6.5 9 12l9 5.5z'],
  fwd: ['M18 5v14', 'M6 6.5 15 12l-9 5.5z'],
  split: ['M12 3v18', 'M8 7 4 12l4 5', 'M16 7l4 5-4 5'],
  crop: ['M6 2v16h16', 'M18 22V6H2'],
  copy: [
    'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z',
    'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'
  ],
  flip: ['M12 2v3', 'M12 9v2', 'M12 13v2', 'M12 19v3', 'M9.5 8.5 4 12l5.5 3.5z', 'M14.5 8.5 20 12l-5.5 3.5z'],
  rotate: ['M20 12a8 8 0 1 1-2.3-5.6', 'M20 4v4.5h-4.5'],
  speed: ['M4 15a8 8 0 1 1 16 0', 'M12 15l4-4'],
  mute: ['M11 5 6 9H3v6h3l5 4z', 'M16 9l5 6', 'M21 9l-5 6'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  magnet: ['M4 4h5v8a3 3 0 0 0 6 0V4h5v8a8 8 0 0 1-16 0z'],
  media: ['M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M3 16l5-5 4 4 3-3 6 6'],
  audio: ['M6 18V5l11-2v13', 'M6 9l11-2', 'M3.5 18.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0', 'M14.5 16a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0'],
  record: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z', 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8z'],
  text: ['M4 6V4h16v2', 'M12 4v16', 'M9 20h6'],
  sticker: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z', 'M8.5 10h.01', 'M15.5 10h.01', 'M8.5 14.5a4.5 4.5 0 0 0 7 0'],
  draw: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  captions: ['M3 5h18v14H3z', 'M7 10h3', 'M7 14h6', 'M14 10h3'],
  filter: ['M4 5h16l-6 8v6l-4-2v-4z'],
  transition: ['M3 4h10v10H3z', 'M11 10h10v10H11z'],
  zoom: ['M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14z', 'M21 21l-4.5-4.5', 'M8 11h6'],
  fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  ratio: ['M3 7h18v10H3z', 'M7 7v10'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8z',
    'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4',
    'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'
  ],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  plus: ['M12 5v14', 'M5 12h14']
}

export default defineComponent({
  name: 'Icon',
  props: {
    name: {
      type: String as PropType<string>,
      required: true,
      validator: (value: string) => value in PATHS
    }
  },
  computed: {
    paths(): string[] {
      return PATHS[this.name] ?? []
    }
  }
})
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>
