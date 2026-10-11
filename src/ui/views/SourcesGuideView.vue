<script lang="ts">
import { defineComponent } from 'vue'

interface SourceLink {
  /** Key of the description under sources.<section>.<key>. */
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
  { key: 'freesound', name: 'Freesound', href: 'https://freesound.org' },
  { key: 'pixabay', name: 'Pixabay Music', href: 'https://pixabay.com/music/' },
  { key: 'fma', name: 'Free Music Archive', href: 'https://freemusicarchive.org' },
  { key: 'incompetech', name: 'Incompetech', href: 'https://incompetech.com' }
]

const LICENCE_ROWS = ['cc0', 'by', 'bySa', 'reserved'] as const
const AVOID_ITEMS = ['streaming', 'video', 'search', 'film'] as const
const CONTENTS = [
  { id: 'own', key: 'own.title' },
  { id: 'images', key: 'images.title' },
  { id: 'videos', key: 'videos.title' },
  { id: 'music', key: 'music.title' },
  { id: 'licences', key: 'licences.title' },
  { id: 'avoid', key: 'avoid.title' },
  { id: 'credit', key: 'credit.title' },
  { id: 'check', key: 'check.title' }
] as const

export default defineComponent({
  name: 'SourcesGuideView',
  data() {
    return {
      images: IMAGES,
      videos: VIDEOS,
      music: MUSIC,
      licenceRows: LICENCE_ROWS,
      avoidItems: AVOID_ITEMS,
      contents: CONTENTS
    }
  }
})
</script>

<template>
  <div class="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:px-6">
    <nav class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold" aria-label="Jelly Cut">
      <a href="../../app/" class="inline-flex min-h-11 items-center text-txt underline underline-offset-2 hover:no-underline">
        <span aria-hidden="true" class="mr-1">←</span>{{ $t('sources.backToEditor') }}
      </a>
      <a href="../../" class="inline-flex min-h-11 items-center text-muted underline underline-offset-2 hover:text-fg hover:no-underline">
        {{ $t('sources.toStart') }}
      </a>
    </nav>

    <header class="mt-4">
      <h1 class="text-2xl font-bold tracking-tight">{{ $t('sources.title') }}</h1>
      <p class="mt-3 text-base leading-relaxed text-muted">{{ $t('sources.intro') }}</p>
    </header>

    <nav class="mt-6 rounded-xl border border-line bg-panel p-4" :aria-label="$t('sources.contents')">
      <p class="text-sm font-bold">{{ $t('sources.contents') }}</p>
      <ol class="mt-2 space-y-1 text-sm">
        <li v-for="item in contents" :key="item.id">
          <a :href="`#${item.id}`" class="inline-flex min-h-8 items-center text-txt underline underline-offset-2 hover:no-underline">
            {{ $t(`sources.${item.key}`) }}
          </a>
        </li>
      </ol>
    </nav>

    <main>
      <section id="own" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.own.title') }}</h2>
        <p class="mt-3 leading-relaxed">{{ $t('sources.own.text') }}</p>
        <p class="mt-3 leading-relaxed text-muted">{{ $t('sources.own.more') }}</p>
      </section>

      <section id="images" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.images.title') }}</h2>
        <p class="mt-3 leading-relaxed">{{ $t('sources.images.text') }}</p>
        <ul class="mt-4 space-y-4">
          <li v-for="link in images" :key="link.key + link.href">
            <a
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-11 items-center gap-1 font-semibold text-txt underline underline-offset-2 hover:no-underline"
            >
              {{ link.name }}<span class="sr-only"> ({{ $t('sources.newTab') }})</span>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </a>
            <span class="block break-all text-xs text-muted">{{ link.href }}</span>
            <p class="mt-0.5 text-sm text-muted">{{ $t(`sources.images.${link.key}`) }}</p>
          </li>
        </ul>
      </section>

      <section id="videos" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.videos.title') }}</h2>
        <p class="mt-3 leading-relaxed">{{ $t('sources.videos.text') }}</p>
        <ul class="mt-4 space-y-4">
          <li v-for="link in videos" :key="link.key + link.href">
            <a
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-11 items-center gap-1 font-semibold text-txt underline underline-offset-2 hover:no-underline"
            >
              {{ link.name }}<span class="sr-only"> ({{ $t('sources.newTab') }})</span>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </a>
            <span class="block break-all text-xs text-muted">{{ link.href }}</span>
            <p class="mt-0.5 text-sm text-muted">{{ $t(`sources.videos.${link.key}`) }}</p>
          </li>
        </ul>
      </section>

      <section id="music" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.music.title') }}</h2>
        <p class="mt-3 leading-relaxed">{{ $t('sources.music.text') }}</p>
        <ul class="mt-4 space-y-4">
          <li v-for="link in music" :key="link.key + link.href">
            <a
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-11 items-center gap-1 font-semibold text-txt underline underline-offset-2 hover:no-underline"
            >
              {{ link.name }}<span class="sr-only"> ({{ $t('sources.newTab') }})</span>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </a>
            <span class="block break-all text-xs text-muted">{{ link.href }}</span>
            <p class="mt-0.5 text-sm text-muted">{{ $t(`sources.music.${link.key}`) }}</p>
          </li>
        </ul>
      </section>

      <section id="licences" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.licences.title') }}</h2>
        <p class="mt-3 leading-relaxed">{{ $t('sources.licences.text') }}</p>
        <div class="mt-4 overflow-hidden rounded-xl border border-line">
          <table class="w-full border-collapse text-left text-sm">
            <thead class="bg-panel2">
              <tr>
                <th scope="col" class="px-3 py-2 font-bold">{{ $t('sources.licences.head.licence') }}</th>
                <th scope="col" class="px-3 py-2 font-bold">{{ $t('sources.licences.head.meaning') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in licenceRows" :key="row" class="border-t border-line align-top">
                <th scope="row" class="px-3 py-2.5 font-semibold">{{ $t(`sources.licences.${row}`) }}</th>
                <td class="px-3 py-2.5">{{ $t(`sources.licences.${row}Meaning`) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="avoid" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.avoid.title') }}</h2>
        <ul class="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
          <li v-for="item in avoidItems" :key="item">{{ $t(`sources.avoid.${item}`) }}</li>
        </ul>
      </section>

      <section id="credit" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.credit.title') }}</h2>
        <p class="mt-3 leading-relaxed">{{ $t('sources.credit.text') }}</p>
        <figure class="mt-4 rounded-xl bg-panel2 p-4">
          <figcaption class="text-xs font-bold uppercase tracking-wide text-muted">{{ $t('sources.credit.exampleLabel') }}</figcaption>
          <p class="mt-2 break-words text-sm leading-relaxed">{{ $t('sources.credit.example') }}</p>
        </figure>
        <p class="mt-3 leading-relaxed text-muted">{{ $t('sources.credit.tip') }}</p>
      </section>

      <section id="check" class="scroll-mt-6 pt-8">
        <h2 class="text-lg font-bold">{{ $t('sources.check.title') }}</h2>
        <p class="mt-3 leading-relaxed">{{ $t('sources.check.text') }}</p>
        <p class="mt-3 leading-relaxed text-muted">{{ $t('sources.check.school') }}</p>
      </section>
    </main>
  </div>
</template>
