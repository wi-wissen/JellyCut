<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import Callout from '../../site/Callout.vue'
import RawSizeCalculator from '../../help/RawSizeCalculator.vue'
import Flipbook from '../../help/Flipbook.vue'
import SeekDemo from '../../help/SeekDemo.vue'
import JpegQualityDemo from '../../help/JpegQualityDemo.vue'
import { helpRoots } from '../../site/helpPages'

const GLOSSARY_TERMS = ['bild', 'bildrate', 'aufloesung', 'bitrate', 'keyframe', 'kodieren'] as const

export default defineComponent({
  name: 'CompressionView',
  components: { HelpLayout, Callout, RawSizeCalculator, Flipbook, SeekDemo, JpegQualityDemo },
  data() {
    const roots = helpRoots('compression/')
    return {
      glossaryTerms: GLOSSARY_TERMS,
      glossaryHref: `${roots.help}glossary/`
    }
  }
})
</script>

<template>
  <HelpLayout page="compression">
    <template #lead>{{ $t('help.compression.lead') }}</template>

    <section>
      <h2>{{ $t('help.compression.basics.heading') }}</h2>
      <p>{{ $t('help.compression.basics.text') }}</p>
      <ul>
        <li><strong>{{ $t('help.compression.basics.fps.term') }}</strong> {{ $t('help.compression.basics.fps.text') }}</li>
        <li><strong>{{ $t('help.compression.basics.resolution.term') }}</strong> {{ $t('help.compression.basics.resolution.text') }}</li>
        <li><strong>{{ $t('help.compression.basics.bitrate.term') }}</strong> {{ $t('help.compression.basics.bitrate.text') }}</li>
      </ul>
    </section>

    <section>
      <h2>{{ $t('help.compression.raw.heading') }}</h2>
      <p>{{ $t('help.compression.raw.text') }}</p>
      <RawSizeCalculator />
      <p>{{ $t('help.compression.raw.afterText') }}</p>
    </section>

    <section>
      <h2>{{ $t('help.compression.flip.heading') }}</h2>
      <p>{{ $t('help.compression.flip.text') }}</p>
      <p>{{ $t('help.compression.flip.text2') }}</p>
      <Flipbook />
      <p class="text-sm text-muted">{{ $t('help.compression.flip.note') }}</p>
    </section>

    <section>
      <h2>{{ $t('help.compression.seek.heading') }}</h2>
      <p>{{ $t('help.compression.seek.text') }}</p>
      <SeekDemo />
    </section>

    <section>
      <h2>{{ $t('help.compression.lossy.heading') }}</h2>
      <p>{{ $t('help.compression.lossy.text') }}</p>
      <JpegQualityDemo />
      <p class="text-sm text-muted">{{ $t('help.compression.lossy.note') }}</p>
      <Callout>
        <p><strong>{{ $t('help.compression.merkeLabel') }}</strong> {{ $t('help.compression.merke') }}</p>
      </Callout>
    </section>

    <section>
      <h2>{{ $t('help.compression.glossary.heading') }}</h2>
      <ul class="flex flex-wrap gap-2">
        <li v-for="term in glossaryTerms" :key="term">
          <a :href="`${glossaryHref}#${term}`" class="inline-flex min-h-11 items-center rounded-lg border border-line bg-panel px-3 text-sm font-semibold text-fg no-underline hover:border-txt">{{ $t(`help.glossary.terms.${term}.term`) }}</a>
        </li>
      </ul>
    </section>
  </HelpLayout>
</template>
