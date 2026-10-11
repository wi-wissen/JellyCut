<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import Callout from '../../site/Callout.vue'
import RecompressDemo from '../../help/RecompressDemo.vue'
import { helpRoots } from '../../site/helpPages'

const CODECS = ['h264', 'vp9', 'av1'] as const
const SETTINGS = [
  { id: 'aufloesung', key: 'resolution' },
  { id: 'bildrate', key: 'fps' },
  { id: 'bitrate', key: 'quality' },
  { id: 'format', key: 'format' },
  { id: 'codec', key: 'codec' }
] as const
const TIPS = ['once', 'originals', 'final', 'reexport', 'h264'] as const
const GLOSSARY_TERMS = ['kodieren', 'codec', 'keyframe', 'export'] as const
// Keyframe positions in the two cut examples (eight frames each).
const CELLS = [0, 1, 2, 3, 4, 5, 6, 7]

export default defineComponent({
  name: 'EncodingView',
  components: { HelpLayout, Callout, RecompressDemo },
  data() {
    const roots = helpRoots('encoding/')
    return {
      codecs: CODECS,
      settings: SETTINGS,
      tips: TIPS,
      cells: CELLS,
      glossaryTerms: GLOSSARY_TERMS,
      glossaryHref: `${roots.help}glossary/`,
      appHref: `${roots.site}app/`
    }
  },
  methods: {
    isKeyframe(cell: number): boolean {
      return cell === 0 || cell === 4
    }
  }
})
</script>

<template>
  <HelpLayout page="encoding">
    <template #lead>{{ $t('help.encoding.lead') }}</template>

    <section>
      <h2>{{ $t('help.encoding.basics.heading') }}</h2>
      <p>{{ $t('help.encoding.basics.text') }}</p>

      <div class="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-line bg-panel p-4 text-center text-sm font-semibold" aria-hidden="true">
        <span class="rounded-lg bg-panel2 px-3 py-2">{{ $t('help.encoding.diagram.pictures') }}</span>
        <span class="text-muted">→ {{ $t('help.encoding.diagram.encode') }} →</span>
        <span class="rounded-lg bg-fill px-3 py-2 text-fill-fg">{{ $t('help.encoding.diagram.file') }}</span>
        <span class="text-muted">→ {{ $t('help.encoding.diagram.decode') }} →</span>
        <span class="rounded-lg bg-panel2 px-3 py-2">{{ $t('help.encoding.diagram.pictures') }}</span>
      </div>

      <h3>{{ $t('help.encoding.codecs.heading') }}</h3>
      <ul class="grid gap-3 sm:grid-cols-3">
        <li v-for="codec in codecs" :key="codec" class="rounded-xl border border-line bg-panel p-4">
          <p class="font-bold text-txt">{{ $t(`help.encoding.codecs.${codec}.name`) }}</p>
          <p class="mt-1 text-sm leading-snug text-muted">{{ $t(`help.encoding.codecs.${codec}.text`) }}</p>
        </li>
      </ul>
      <p class="text-sm text-muted">{{ $t('help.encoding.codecs.app') }}</p>
    </section>

    <section>
      <h2>{{ $t('help.encoding.edit.heading') }}</h2>
      <p>{{ $t('help.encoding.edit.text') }}</p>
      <p>{{ $t('help.encoding.edit.text2') }}</p>

      <div class="space-y-4 rounded-2xl border border-line bg-panel p-4 text-sm" aria-hidden="true">
        <div>
          <p class="font-semibold">{{ $t('help.encoding.edit.rowKey') }}</p>
          <div class="mt-2 flex gap-1">
            <span v-for="cell in cells" :key="cell" class="flex h-9 min-w-0 flex-1 items-center justify-center rounded-md text-xs font-bold" :class="isKeyframe(cell) ? 'bg-fill text-fill-fg' : 'bg-panel2 text-muted'">{{ isKeyframe(cell) ? 'K' : '' }}</span>
          </div>
          <p class="mt-2 text-muted">{{ $t('help.encoding.edit.captionKey') }}</p>
        </div>
        <div>
          <p class="font-semibold">{{ $t('help.encoding.edit.rowMiddle') }}</p>
          <div class="mt-2 flex gap-1">
            <span v-for="cell in cells" :key="cell" class="flex h-9 min-w-0 flex-1 items-center justify-center rounded-md text-xs font-bold" :class="isKeyframe(cell) ? 'bg-fill text-fill-fg' : 'bg-panel2 text-muted'">{{ isKeyframe(cell) ? 'K' : '' }}</span>
          </div>
          <p class="mt-2 text-muted">{{ $t('help.encoding.edit.captionMiddle') }}</p>
        </div>
      </div>

      <Callout kind="tip">
        <p>{{ $t('help.encoding.edit.tip') }}</p>
      </Callout>
    </section>

    <section>
      <h2>{{ $t('help.encoding.loss.heading') }}</h2>
      <p>{{ $t('help.encoding.loss.text') }}</p>
      <RecompressDemo />
      <p class="text-sm text-muted">{{ $t('help.encoding.loss.note') }}</p>
    </section>

    <section>
      <h2>{{ $t('help.encoding.app.heading') }}</h2>
      <p>{{ $t('help.encoding.app.text') }}</p>
      <p>{{ $t('help.encoding.app.text2') }}</p>
      <h3>{{ $t('help.encoding.app.settingsHeading') }}</h3>
      <ul class="space-y-2">
        <li v-for="setting in settings" :key="setting.id" class="rounded-xl border border-line bg-panel p-3">
          <a :href="`${glossaryHref}#${setting.id}`" class="font-semibold text-txt">{{ $t(`help.glossary.terms.${setting.id}.term`) }}</a>
          <span class="text-muted"> · {{ $t(`help.encoding.app.settings.${setting.key}`) }}</span>
        </li>
      </ul>
      <p>
        <a :href="appHref" class="inline-flex min-h-11 items-center rounded-lg bg-signal px-4 font-bold text-signal-fg no-underline">{{ $t('help.encoding.app.open') }}</a>
      </p>
    </section>

    <section>
      <h2>{{ $t('help.encoding.tips.heading') }}</h2>
      <ul>
        <li v-for="tip in tips" :key="tip">{{ $t(`help.encoding.tips.${tip}`) }}</li>
      </ul>
    </section>

    <section>
      <h2>{{ $t('help.encoding.glossary.heading') }}</h2>
      <ul class="flex flex-wrap gap-2">
        <li v-for="term in glossaryTerms" :key="term">
          <a :href="`${glossaryHref}#${term}`" class="inline-flex min-h-11 items-center rounded-lg border border-line bg-panel px-3 text-sm font-semibold text-fg no-underline hover:border-txt">{{ $t(`help.glossary.terms.${term}.term`) }}</a>
        </li>
      </ul>
    </section>
  </HelpLayout>
</template>
