<script lang="ts">
import { defineComponent } from 'vue'

// A closed box: the lid lifts to show the tracks that a video file holds.
export default defineComponent({
  name: 'ContainerBox',
  data() {
    return {
      open: false,
      tracks: [
        { key: 'video', color: 'var(--jc-track-video-1)' },
        { key: 'audio', color: 'var(--jc-wave)' },
        { key: 'subtitles', color: 'var(--jc-track-text)' },
        { key: 'info', color: 'var(--jc-muted)' }
      ]
    }
  }
})
</script>

<template>
  <div class="rounded-2xl border border-line bg-panel p-4 sm:p-5">
    <button
      type="button"
      class="inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-line bg-panel2 px-4 font-semibold text-fg hover:border-txt"
      aria-controls="container-box-tracks"
      :aria-expanded="open ? 'true' : 'false'"
      @click="open = !open"
    >
      <svg viewBox="0 0 240 150" class="h-24 w-auto" aria-hidden="true" focusable="false">
        <rect x="30" y="66" width="180" height="72" rx="14" style="fill: var(--jc-track-video-1)" />
        <rect x="104" y="84" width="32" height="14" rx="4" style="fill: var(--jc-track-text)" />
        <g
          class="transition-transform duration-500 ease-out motion-reduce:transition-none"
          :style="{ transform: open ? 'translate(0px, -40px) rotate(-16deg)' : 'none', transformOrigin: '30px 66px' }"
        >
          <rect x="22" y="48" width="196" height="30" rx="12" style="fill: var(--jc-fill)" />
          <rect x="106" y="54" width="28" height="12" rx="4" style="fill: var(--jc-track-text)" />
        </g>
      </svg>
      <span>{{ open ? $t('container.box.close') : $t('container.box.open') }}</span>
    </button>

    <ul
      id="container-box-tracks"
      v-show="open"
      :aria-label="$t('container.box.regionLabel')"
      class="mt-4 grid gap-2 sm:grid-cols-2"
    >
      <li v-for="track in tracks" :key="track.key" class="flex gap-3 rounded-xl border border-line bg-panel2 p-3">
        <span class="mt-1 size-3 shrink-0 rounded-full" :style="{ background: track.color }" aria-hidden="true"></span>
        <div class="min-w-0">
          <p class="font-semibold text-fg">{{ $t(`container.box.tracks.${track.key}.name`) }}</p>
          <p class="text-sm leading-snug text-muted">{{ $t(`container.box.tracks.${track.key}.text`) }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>
