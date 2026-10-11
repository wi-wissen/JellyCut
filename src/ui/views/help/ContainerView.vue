<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import Callout from '../../site/Callout.vue'
import ContainerBox from '../../help/ContainerBox.vue'
import FrameStrip from '../../help/FrameStrip.vue'
import { helpRoots } from '../../site/helpPages'

const ENDINGS = ['mp4', 'webm', 'mov', 'mkv'] as const
const GLOSSARY_TERMS = ['container', 'codec', 'bild', 'abtastrate', 'wellenform'] as const

export default defineComponent({
  name: 'ContainerView',
  components: { HelpLayout, Callout, ContainerBox, FrameStrip },
  data() {
    const roots = helpRoots('container/')
    return {
      endings: ENDINGS,
      glossaryTerms: GLOSSARY_TERMS,
      appHref: `${roots.site}app/`,
      glossaryHref: `${roots.help}glossary/`
    }
  }
})
</script>

<template>
  <HelpLayout page="container">
    <template #lead>{{ $t('help.container.lead') }}</template>

    <section>
      <h2>{{ $t('help.container.box.heading') }}</h2>
      <p>{{ $t('help.container.box.text') }}</p>
      <ContainerBox />
    </section>

    <section>
      <h2>{{ $t('help.container.frames.heading') }}</h2>
      <p>{{ $t('help.container.frames.text') }}</p>
      <FrameStrip />
    </section>

    <section>
      <h2>{{ $t('help.container.endings.heading') }}</h2>
      <p>{{ $t('help.container.endings.text') }}</p>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li v-for="ending in endings" :key="ending" class="rounded-xl border border-line bg-panel p-4">
          <p class="font-mono text-base font-bold text-txt">.{{ ending }}</p>
          <p class="mt-1 text-sm leading-snug text-muted">{{ $t(`help.container.endings.${ending}.text`) }}</p>
        </li>
      </ul>
      <Callout>
        <p>{{ $t('help.container.endings.memo') }}</p>
      </Callout>
    </section>

    <section>
      <h2>{{ $t('help.container.app.heading') }}</h2>
      <p>{{ $t('help.container.app.text') }}</p>
      <p>{{ $t('help.container.app.text2') }}</p>
      <p>
        <a :href="appHref" class="inline-flex min-h-11 items-center rounded-lg bg-signal px-4 font-bold text-signal-fg no-underline">{{ $t('help.container.app.open') }}</a>
      </p>
      <Callout kind="tip">
        <p>{{ $t('help.container.app.tip') }}</p>
      </Callout>
    </section>

    <section>
      <h2>{{ $t('help.container.glossary.heading') }}</h2>
      <ul class="flex flex-wrap gap-2">
        <li v-for="term in glossaryTerms" :key="term">
          <a :href="`${glossaryHref}#${term}`" class="inline-flex min-h-11 items-center rounded-lg border border-line bg-panel px-3 text-sm font-semibold text-fg no-underline hover:border-txt">{{ $t(`help.glossary.terms.${term}.term`) }}</a>
        </li>
      </ul>
    </section>
  </HelpLayout>
</template>
