<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions } from 'pinia'
import Icon from '../Icon.vue'
import { useEditorStore } from '../../stores/editor'
import { TEXT_PRESETS, type TextPresetId } from '../../../core/timeline/textOps'

export default defineComponent({
  name: 'TextPanel',
  components: { Icon },
  data() {
    return { presets: TEXT_PRESETS }
  },
  methods: {
    ...mapActions(useEditorStore, ['addTextAtPlayhead']),
    add(preset: TextPresetId): void {
      this.addTextAtPlayhead(preset, this.$t('text.defaultText'))
    },
    sampleStyle(preset: (typeof TEXT_PRESETS)[number]): Record<string, string> {
      const outline = preset.style.outline
      return {
        fontFamily: `'${preset.style.font}', system-ui, sans-serif`,
        color: preset.style.color,
        textShadow: outline ? `1px 0 ${outline}, -1px 0 ${outline}, 0 1px ${outline}, 0 -1px ${outline}` : 'none'
      }
    },
    presetName(id: TextPresetId): string {
      return this.$t(`text.presetNames.${id}`)
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-sm font-bold">{{ $t('tabs.text') }}</h2>
    <p class="text-xs leading-relaxed text-muted">{{ $t('text.whySeparate') }}</p>
    <button
      type="button"
      class="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-fill text-sm font-bold text-fill-fg hover:opacity-90"
      @click="add('title')"
    >
      <Icon name="plus" class="size-4" />
      {{ $t('text.add') }}
    </button>

    <h3 class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ $t('text.presets') }}</h3>
    <div class="grid grid-cols-2 gap-2.5">
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        class="flex flex-col gap-1.5 rounded-lg text-left"
        :aria-label="$t('text.presetAria', { name: presetName(preset.id) })"
        @click="add(preset.id)"
      >
        <span class="flex aspect-[16/10] w-full items-center justify-center rounded-lg bg-[#14121f]" aria-hidden="true">
          <span class="text-[34px] leading-none" :style="sampleStyle(preset)">{{ $t('text.sample') }}</span>
        </span>
        <span class="text-xs font-semibold text-fg">{{ presetName(preset.id) }}</span>
      </button>
    </div>
  </div>
</template>
