<script lang="ts">
import { defineComponent, type Component, type PropType } from 'vue'
import { ArrowLeftRight, BookText, Compass, Cpu, GitCompare, Images, Minimize2, Package, ShieldCheck } from 'lucide-vue-next'

/** Lucide icons (ISC licence) for the help navigation; only the used ones are bundled. */
const ICONS: Record<string, Component> = {
  index: Compass,
  container: Package,
  compression: Minimize2,
  encoding: ArrowLeftRight,
  glossary: BookText,
  sources: Images,
  rights: ShieldCheck,
  tech: Cpu,
  editors: GitCompare
}

export default defineComponent({
  name: 'HelpIcon',
  props: { name: { type: String as PropType<string>, required: true } },
  computed: {
    icon(): Component | undefined {
      return ICONS[this.name]
    }
  }
})
</script>

<template>
  <component :is="icon" v-if="icon" :size="18" :stroke-width="2" aria-hidden="true" focusable="false" class="shrink-0" />
</template>
