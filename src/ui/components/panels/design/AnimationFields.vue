<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { IN_ANIMATIONS, OUT_ANIMATIONS, type InAnimation, type OutAnimation } from '../../../../core/render/animations'
import { OVERLAY_LOOPS } from '../../../../core/timeline/overlayCatalog'
import type { OverlayLoop } from '../../../../core/project/types'

interface AnimationPatch {
  animIn?: InAnimation | null
  animOut?: OutAnimation | null
  loop?: OverlayLoop | null
}

/**
 * Entrance, exit and loop of one item. Option names say the direction ("Slide in from top", "Slide out to top"),
 * so the same list serves text and overlays.
 */
export default defineComponent({
  name: 'AnimationFields',
  props: {
    animIn: { type: String as PropType<string | null>, default: null },
    animOut: { type: String as PropType<string | null>, default: null },
    loop: { type: String as PropType<OverlayLoop | null>, default: null },
    withLoop: { type: Boolean, default: false }
  },
  emits: {
    patch: (patch: AnimationPatch) => Object.keys(patch).length === 1
  },
  data() {
    return { inList: IN_ANIMATIONS, outList: OUT_ANIMATIONS, loops: OVERLAY_LOOPS }
  },
  methods: {
    /** 'none' in the select means no animation; the store keeps null for that. */
    change(field: 'animIn' | 'animOut' | 'loop', event: Event): void {
      const value = (event.target as HTMLSelectElement).value
      this.$emit('patch', { [field]: value === 'none' ? null : value } as AnimationPatch)
    }
  }
})
</script>

<template>
  <div class="grid grid-cols-2 gap-2">
    <div class="flex min-w-0 flex-col gap-1">
      <label for="anim-in" class="text-xs font-semibold text-muted">{{ $t('design.animIn') }}</label>
      <select id="anim-in" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="animIn ?? 'none'" @change="change('animIn', $event)">
        <option value="none">{{ $t('design.animNone') }}</option>
        <option v-for="anim in inList" :key="anim" :value="anim">{{ $t(`overlays3.anim.${anim}`) }}</option>
      </select>
    </div>
    <div class="flex min-w-0 flex-col gap-1">
      <label for="anim-out" class="text-xs font-semibold text-muted">{{ $t('design.animOut') }}</label>
      <select id="anim-out" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="animOut ?? 'none'" @change="change('animOut', $event)">
        <option value="none">{{ $t('design.animNone') }}</option>
        <option v-for="anim in outList" :key="anim" :value="anim">{{ $t(`overlays3.anim.${anim}`) }}</option>
      </select>
    </div>
    <div v-if="withLoop" class="col-span-2 flex flex-col gap-1">
      <label for="anim-loop" class="text-xs font-semibold text-muted">{{ $t('design.loop') }}</label>
      <select id="anim-loop" class="min-h-11 w-full rounded-lg border border-line bg-panel px-2 text-sm text-fg" :value="loop ?? 'none'" @change="change('loop', $event)">
        <option value="none">{{ $t('design.animNone') }}</option>
        <option v-for="item in loops" :key="item" :value="item">{{ $t(`design.loops.${item}`) }}</option>
      </select>
    </div>
  </div>
</template>
