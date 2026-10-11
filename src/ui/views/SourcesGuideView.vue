<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../site/HelpLayout.vue'

interface SourceLink {
  /** Key of the description under help.sources.<section>.<key>. */
  key: string
  name: string
  href: string
}

// Links are reviewed before every release, see docs/sources-review.md.
const IMAGES: SourceLink[] = [
  { key: 'pixabay', name: 'Pixabay', href: 'https://pixabay.com' },
  { key: 'pexels', name: 'Pexels', href: 'https://www.pexels.com' },
  { key: 'unsplash', name: 'Unsplash', href: 'https://unsplash.com' },
  { key: 'commons', name: 'Wikimedia Commons', href: 'https://commons.wikimedia.org' },
  { key: 'openverse', name: 'Openverse', href: 'https://openverse.org' }
]

const VIDEOS: SourceLink[] = [
  { key: 'pexels', name: 'Pexels Videos', href: 'https://www.pexels.com/videos/' },
  { key: 'pixabay', name: 'Pixabay Videos', href: 'https://pixabay.com/videos/' },
  { key: 'commons', name: 'Wikimedia Commons', href: 'https://commons.wikimedia.org' }
]

const MUSIC: SourceLink[] = [
  { key: 'pixabay', name: 'Pixabay Music', href: 'https://pixabay.com/music/' },
  { key: 'fma', name: 'Free Music Archive', href: 'https://freemusicarchive.org/home' }
]

const LICENCE_ROWS = ['cc0', 'by', 'bySa', 'reserved'] as const
const CONTENTS = [
  { id: 'own', key: 'own.title' },
  { id: 'images', key: 'images.title' },
  { id: 'videos', key: 'videos.title' },
  { id: 'music', key: 'music.title' },
  { id: 'licences', key: 'licences.title' },
  { id: 'credit', key: 'credit.title' },
  { id: 'check', key: 'check.title' }
] as const

export default defineComponent({
  name: 'SourcesGuideView',
  components: { HelpLayout },
  data() {
    return {
      images: IMAGES,
      videos: VIDEOS,
      music: MUSIC,
      licenceRows: LICENCE_ROWS,
      contents: CONTENTS
    }
  }
})
</script>

<template>
  <HelpLayout page="sources">
    <template #lead>
      <p>{{ $t('help.sources.intro') }}</p>
    </template>

    <nav class="rounded-xl border border-line bg-panel p-4" :aria-label="$t('help.sources.contents')">
      <p class="text-sm font-bold">{{ $t('help.sources.contents') }}</p>
      <ol class="mt-2 grid gap-1 text-sm">
        <li v-for="item in contents" :key="item.id">
          <a :href="`#${item.id}`" class="inline-flex min-h-11 items-center text-txt underline underline-offset-2 hover:no-underline">
            {{ $t(`help.sources.${item.key}`) }}
          </a>
        </li>
      </ol>
    </nav>

    <section id="own" class="scroll-mt-6">
      <h2>{{ $t('help.sources.own.title') }}</h2>
      <p>{{ $t('help.sources.own.text') }}</p>
      <p class="text-muted">{{ $t('help.sources.own.more') }}</p>
    </section>

    <section id="images" class="scroll-mt-6">
      <h2>{{ $t('help.sources.images.title') }}</h2>
      <p>{{ $t('help.sources.images.text') }}</p>
      <ul>
        <li v-for="link in images" :key="link.key + link.href">
          <a :href="link.href" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
            {{ link.name }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p class="text-sm text-muted">{{ $t(`help.sources.images.${link.key}`) }}</p>
        </li>
      </ul>
    </section>

    <section id="videos" class="scroll-mt-6">
      <h2>{{ $t('help.sources.videos.title') }}</h2>
      <p>{{ $t('help.sources.videos.text') }}</p>
      <ul>
        <li v-for="link in videos" :key="link.key + link.href">
          <a :href="link.href" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
            {{ link.name }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p class="text-sm text-muted">{{ $t(`help.sources.videos.${link.key}`) }}</p>
        </li>
      </ul>
    </section>

    <section id="music" class="scroll-mt-6">
      <h2>{{ $t('help.sources.music.title') }}</h2>
      <p>{{ $t('help.sources.music.text') }}</p>
      <ul>
        <li v-for="link in music" :key="link.key + link.href">
          <a :href="link.href" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-1 font-semibold text-fg no-underline">
            {{ link.name }}<span class="sr-only"> ({{ $t('help.common.newTab') }})</span>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
          <p class="text-sm text-muted">{{ $t(`help.sources.music.${link.key}`) }}</p>
        </li>
      </ul>
    </section>

    <section id="licences" class="scroll-mt-6">
      <h2>{{ $t('help.sources.licences.title') }}</h2>
      <p>{{ $t('help.sources.licences.text') }}</p>
      <div class="overflow-hidden rounded-xl border border-line">
        <table class="w-full border-collapse text-left text-sm">
          <thead class="bg-panel2">
            <tr>
              <th scope="col" class="px-3 py-2 font-bold">{{ $t('help.sources.licences.head.licence') }}</th>
              <th scope="col" class="px-3 py-2 font-bold">{{ $t('help.sources.licences.head.meaning') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in licenceRows" :key="row" class="border-t border-line align-top">
              <th scope="row" class="px-3 py-2.5 font-semibold">{{ $t(`help.sources.licences.${row}`) }}</th>
              <td class="px-3 py-2.5">{{ $t(`help.sources.licences.${row}Meaning`) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="credit" class="scroll-mt-6">
      <h2>{{ $t('help.sources.credit.title') }}</h2>
      <p>{{ $t('help.sources.credit.text') }}</p>
      <figure class="rounded-xl bg-panel2 p-4">
        <figcaption class="text-xs font-bold uppercase tracking-wide text-muted">{{ $t('help.sources.credit.exampleLabel') }}</figcaption>
        <p class="mt-2 break-words text-sm leading-relaxed">{{ $t('help.sources.credit.example') }}</p>
      </figure>
      <p class="text-muted">{{ $t('help.sources.credit.tip') }}</p>
    </section>

    <section id="check" class="scroll-mt-6">
      <h2>{{ $t('help.sources.check.title') }}</h2>
      <p>{{ $t('help.sources.check.text') }}</p>
      <p class="text-muted">{{ $t('help.sources.check.school') }}</p>
      <p>
        {{ $t('help.sources.rightsPointer') }}
        <a href="../rights/">{{ $t('help.rights.title') }}</a>
      </p>
    </section>
  </HelpLayout>
</template>
