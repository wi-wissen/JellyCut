<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import Callout from '../../site/Callout.vue'
import { REPO_URL } from '../../site/SiteFooter.vue'

interface TechLink {
  /** Key of the description under help.tech.items.<key>. */
  key: string
  name: string
  href: string
}

// Targets: official sites, the package homepage or MDN. Checked when the page is written.
const LIBRARIES: TechLink[] = [
  { key: 'vue', name: 'Vue.js', href: 'https://vuejs.org/' },
  { key: 'pinia', name: 'Pinia', href: 'https://pinia.vuejs.org/' },
  { key: 'i18n', name: 'vue-i18n', href: 'https://vue-i18n.intlify.dev/' },
  { key: 'tailwind', name: 'Tailwind CSS', href: 'https://tailwindcss.com' },
  { key: 'lucide', name: 'Lucide', href: 'https://lucide.dev' },
  { key: 'mediabunny', name: 'Mediabunny', href: 'https://mediabunny.dev/' },
  { key: 'fontsource', name: 'Fontsource', href: 'https://fontsource.org/' },
  { key: 'ofl', name: 'SIL Open Font License', href: 'https://openfontlicense.org/' }
]

const BUILD: TechLink[] = [
  { key: 'vite', name: 'Vite', href: 'https://vite.dev' },
  { key: 'typescript', name: 'TypeScript', href: 'https://www.typescriptlang.org/' },
  { key: 'vitest', name: 'Vitest', href: 'https://vitest.dev' },
  { key: 'playwright', name: 'Playwright', href: 'https://playwright.dev' },
  { key: 'pages', name: 'GitHub Pages', href: 'https://pages.github.com' }
]

const ARTWORK: TechLink[] = [
  { key: 'fluent', name: 'Fluent Emoji', href: 'https://github.com/microsoft/fluentui-emoji' },
  { key: 'mit', name: 'MIT License', href: 'https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE' }
]

const BROWSER: TechLink[] = [
  { key: 'webcodecs', name: 'WebCodecs API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API' },
  { key: 'webgl', name: 'WebGL2', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext' },
  { key: 'webaudio', name: 'Web Audio API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
  { key: 'workers', name: 'Web Workers', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API' },
  { key: 'fsa', name: 'File System Access API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/File_System_API' },
  { key: 'indexeddb', name: 'IndexedDB', href: 'https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API' },
  { key: 'sw', name: 'Service Worker API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API' }
]

export default defineComponent({
  name: 'TechView',
  components: { HelpLayout, Callout },
  data() {
    return { libraries: LIBRARIES, artwork: ARTWORK, build: BUILD, browser: BROWSER, repoUrl: REPO_URL }
  }
})
</script>

<template>
  <HelpLayout page="tech">
    <template #lead>
      <p>{{ $t('help.tech.lead') }}</p>
    </template>

    <section id="where" class="scroll-mt-6">
      <h2>{{ $t('help.tech.whereTitle') }}</h2>
      <p>{{ $t('help.tech.whereText') }}</p>
      <Callout kind="tip">
        <p>{{ $t('help.tech.whereNote') }}</p>
      </Callout>
    </section>

    <section id="libraries" class="scroll-mt-6">
      <h2>{{ $t('help.tech.librariesTitle') }}</h2>
      <p>{{ $t('help.tech.librariesText') }}</p>
      <ul>
        <li v-for="item in libraries" :key="item.key">
          <a :href="item.href" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
            {{ item.name }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p class="text-base text-muted">{{ $t(`help.tech.items.${item.key}`) }}</p>
        </li>
      </ul>
    </section>

    <section id="browser" class="scroll-mt-6">
      <h2>{{ $t('help.tech.browserTitle') }}</h2>
      <p>{{ $t('help.tech.browserText') }}</p>
      <ul>
        <li v-for="item in browser" :key="item.key">
          <a :href="item.href" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
            {{ item.name }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p class="text-base text-muted">{{ $t(`help.tech.items.${item.key}`) }}</p>
        </li>
      </ul>
    </section>

    <section id="build" class="scroll-mt-6">
      <h2>{{ $t('help.tech.buildTitle') }}</h2>
      <p>{{ $t('help.tech.buildText') }}</p>
      <ul>
        <li v-for="item in build" :key="item.key">
          <a :href="item.href" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
            {{ item.name }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p class="text-base text-muted">{{ $t(`help.tech.items.${item.key}`) }}</p>
        </li>
      </ul>
    </section>

    <section id="artwork" class="scroll-mt-6">
      <h2>{{ $t('help.tech.artworkTitle') }}</h2>
      <p>{{ $t('help.tech.artworkText') }}</p>
      <ul>
        <li v-for="item in artwork" :key="item.key">
          <a :href="item.href" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
            {{ item.name }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p class="text-base text-muted">{{ $t(`help.tech.items.${item.key}`) }}</p>
        </li>
      </ul>
    </section>

    <section id="source" class="scroll-mt-6">
      <h2>{{ $t('help.tech.sourceTitle') }}</h2>
      <p>{{ $t('help.tech.sourceText') }}</p>
      <p>
        <a :href="repoUrl" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
          {{ $t('help.tech.sourceLink') }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
        </a>
      </p>
    </section>
  </HelpLayout>
</template>
