<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { mapActions } from 'pinia'
import BackLink from './BackLink.vue'
import RangeField from './RangeField.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import ColorPicker from './ColorPicker.vue'
import FontSelect from './FontSelect.vue'
import DesignSection from './design/DesignSection.vue'
import TimeFields from './design/TimeFields.vue'
import AnimationFields from './design/AnimationFields.vue'
import OrderFields from './design/OrderFields.vue'
import ItemActions from './design/ItemActions.vue'
import { useEditorStore } from '../../stores/editor'
import type { TextItem } from '../../../core/project/types'
import type { TextPatch } from '../../../core/timeline/textOps'

const DEFAULT_OUTLINE = '#14121f'

/**
 * Text settings in the same sections as the overlays: Content, Look, Time, Animation, Order, Actions.
 * Text has no size or position fields; the handles in the preview do that.
 */
export default defineComponent({
  name: 'TextProperties',
  components: { BackLink, RangeField, ToggleSwitch, ColorPicker, FontSelect, DesignSection, TimeFields, AnimationFields, OrderFields, ItemActions },
  props: {
    item: { type: Object as PropType<TextItem>, required: true }
  },
  data() {
    return { defaultOutline: DEFAULT_OUTLINE }
  },
  computed: {
    header(): string {
      const text = this.item.text.length > 24 ? `${this.item.text.slice(0, 24)}…` : this.item.text
      return this.$t('text.header', { text })
    },
    outlineOn(): boolean {
      return this.item.style.outline !== null
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['updateSelectedText', 'endGesture']),
    keyFor(field: string): string {
      return `text-${field}:${this.item.id}`
    },
    patch(change: TextPatch, field?: string): void {
      this.updateSelectedText(change, field ? this.keyFor(field) : undefined)
    },
    onContent(event: Event): void {
      this.patch({ text: (event.target as HTMLTextAreaElement).value }, 'content')
    },
    commit(): void {
      this.endGesture()
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
    <div class="flex min-w-0 items-center justify-between gap-2">
      <BackLink :label="$t('design.back')" />
      <h2 class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{{ header }}</h2>
    </div>

    <DesignSection :title="$t('design.content')" first>
      <label :for="`text-content-${item.id}`" class="sr-only">{{ $t('text.content') }}</label>
      <textarea
        :id="`text-content-${item.id}`"
        rows="2"
        class="w-full resize-y rounded-lg border border-line bg-panel p-2 text-sm text-fg"
        :value="item.text"
        @input="onContent"
        @change="commit"
      />
      <FontSelect :id="`text-font-${item.id}`" :model-value="item.style.font" @update="(font: string) => patch({ style: { font } })" />
      <RangeField
        :label="$t('text.size')"
        :model-value="item.style.size"
        :min="8"
        :max="400"
        :display="String(Math.round(item.style.size))"
        @update="(size: number) => patch({ style: { size: Math.round(size) } }, 'size')"
        @commit="commit"
      />
      <ToggleSwitch
        :label="$t('text.outline')"
        :state-text="outlineOn ? $t('timeline.on') : $t('timeline.off')"
        :checked="outlineOn"
        @toggle="patch({ style: { outline: outlineOn ? null : defaultOutline } })"
      />
      <ColorPicker
        v-if="outlineOn"
        :model-value="item.style.outline ?? defaultOutline"
        :group-label="$t('text.outlineColor')"
        @update="(hex: string) => patch({ style: { outline: hex } }, 'outline')"
        @commit="commit"
      />
    </DesignSection>

    <DesignSection :title="$t('design.look')">
      <ColorPicker
        :model-value="item.style.color"
        :group-label="$t('design.colour')"
        @update="(hex: string) => patch({ style: { color: hex } }, 'color')"
        @commit="commit"
      />
    </DesignSection>

    <DesignSection :title="$t('design.time')">
      <TimeFields :start="item.start" :duration="item.duration" @patch="patch" />
    </DesignSection>

    <DesignSection :title="$t('design.animation')">
      <AnimationFields :anim-in="item.animIn" :anim-out="item.animOut" @patch="patch" />
    </DesignSection>

    <DesignSection :title="$t('design.order')">
      <OrderFields hint-only />
    </DesignSection>

    <DesignSection :title="$t('design.actions')">
      <ItemActions />
    </DesignSection>
  </div>
</template>
