<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { getAssetFile, getFrameProvider, useMediaStore } from '../stores/media'
import { PreviewEngine } from '../../engine/preview/previewEngine'
import PlayerToolbar from './PlayerToolbar.vue'
import PlayerOverlay from './PlayerOverlay.vue'

// Not reactive on purpose: the engine owns DOM elements, textures and decoders. There is one player.
let engine: PreviewEngine | null = null
const registered = new Map<string, File>()

const TEXT_TARGETS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'])

export default defineComponent({
  name: 'PlayerStage',
  components: { PlayerToolbar, PlayerOverlay },
  data() {
    return { engineError: false }
  },
  computed: {
    ...mapState(useEditorStore, ['project', 'playheadMicros', 'isPlaying']),
    ...mapState(useMediaStore, ['status']),
    aspect(): number {
      const { width, height } = this.project.format
      return width / height
    },
    isEmpty(): boolean {
      return this.project.clips.length === 0 && this.project.texts.length === 0
    }
  },
  watch: {
    project: {
      handler(): void {
        this.syncProject()
      }
    },
    status: {
      deep: true,
      handler(): void {
        this.syncAssets()
        engine?.refresh()
      }
    },
    playheadMicros(t: number): void {
      // While playing the engine is the source of this value; only react to outside changes.
      if (!engine || engine.playing) return
      if (Math.abs(t - engine.currentTime) > 0) void engine.seek(t)
    },
    isPlaying(playing: boolean): void {
      if (!engine) return
      if (playing) {
        this.syncAssets()
        engine.play()
      } else {
        engine.pause()
      }
    }
  },
  mounted() {
    const canvas = this.$refs.canvas as HTMLCanvasElement
    try {
      engine = new PreviewEngine(canvas, getFrameProvider, {
        onTime: (t) => this.setPlayhead(t),
        onEnded: () => {
          if (this.isPlaying) this.togglePlaying()
        }
      })
    } catch {
      this.engineError = true
      return
    }
    this.syncProject()
    void engine.seek(this.playheadMicros)
    document.addEventListener('keydown', this.onKeydown)
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKeydown)
    engine?.dispose()
    engine = null
    registered.clear()
  },
  methods: {
    ...mapActions(useEditorStore, ['setPlayhead', 'togglePlaying']),
    syncProject(): void {
      if (!engine) return
      this.syncAssets()
      engine.setProject(this.project)
    },
    /** Hands every imported file to the engine (for <video>/<audio> playback) and drops stale ones. */
    syncAssets(): void {
      if (!engine) return
      const ids = new Set(this.project.assets.map((a) => a.id))
      for (const [id] of registered) {
        if (!ids.has(id)) {
          engine.removeAsset(id)
          registered.delete(id)
        }
      }
      for (const asset of this.project.assets) {
        const file = getAssetFile(asset.id)
        if (!file || this.status[asset.id] !== 'ready') continue
        if (registered.get(asset.id) === file) continue
        engine.setAssetFile(asset.id, file, asset.kind)
        registered.set(asset.id, file)
      }
    },
    onKeydown(event: KeyboardEvent): void {
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (TEXT_TARGETS.has(target.tagName) || target.isContentEditable || target.getAttribute('role') === 'slider')) return
      event.preventDefault()
      this.togglePlaying()
    }
  }
})
</script>

<template>
  <section class="relative flex min-h-0 flex-1 items-center justify-center bg-stage p-3.5 [container-type:size]">
    <div
      class="relative overflow-hidden rounded-xl bg-black"
      :style="{ aspectRatio: String(aspect), width: `min(100cqw, calc(100cqh * ${aspect}))` }"
    >
      <canvas ref="canvas" class="block size-full" role="img" :aria-label="$t('player.canvasLabel')" />
      <PlayerOverlay v-if="!engineError" :format="project.format" />
      <div class="absolute right-2.5 top-2.5 z-10">
        <PlayerToolbar />
      </div>
      <p
        v-if="isEmpty && !engineError"
        class="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm font-semibold text-white/80"
      >
        {{ $t('player.empty') }}
      </p>
      <p v-if="engineError" role="alert" class="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm font-semibold text-white">
        {{ $t('player.noWebgl') }}
      </p>
    </div>
  </section>
</template>
