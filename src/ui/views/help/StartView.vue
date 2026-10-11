<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import Callout from '../../site/Callout.vue'
import { HELP_PAGES } from '../../site/helpPages'

export default defineComponent({
  name: 'StartView',
  components: { HelpLayout, Callout },
  data() {
    return { pages: HELP_PAGES.filter((p) => p.slug !== 'index') }
  }
})
</script>

<template>
  <HelpLayout page="index">
    <template #lead>
      <div class="flex items-center gap-5">
        <svg aria-hidden="true" focusable="false" viewBox="0 0 120 120" class="hidden size-24 shrink-0 sm:block">
          <path d="M60 16C86 16 102 36 102 60V92Q96 100 90 92Q84 84 78 92Q72 100 66 92Q60 84 54 92Q48 100 42 92Q36 84 30 92Q24 100 18 92V60C18 36 34 16 60 16Z" fill="#6D4CF5" />
          <circle cx="46" cy="56" r="5" fill="#14121f" />
          <circle cx="74" cy="56" r="5" fill="#14121f" />
          <circle cx="47.5" cy="54.5" r="1.6" fill="#fff" />
          <circle cx="75.5" cy="54.5" r="1.6" fill="#fff" />
          <path d="M50 70Q60 80 70 70" fill="none" stroke="#14121f" stroke-width="3" stroke-linecap="round" />
          <circle cx="36" cy="68" r="4" fill="#f28cb1" opacity="0.7" />
          <circle cx="84" cy="68" r="4" fill="#f28cb1" opacity="0.7" />
          <circle cx="100" cy="20" r="7" fill="#c6f432" />
          <path d="M100 8v-4M100 36v4M88 20h-4M112 20h4" stroke="#c6f432" stroke-width="2.5" stroke-linecap="round" />
        </svg>
        <p>{{ $t('help.index.lead') }}</p>
      </div>
    </template>

    <h2>{{ $t('help.index.readingTitle') }}</h2>
    <p>{{ $t('help.index.readingText') }}</p>

    <ol class="mt-6 grid list-none gap-4 pl-0 sm:grid-cols-2">
      <li v-for="(page, index) in pages" :key="page.slug" class="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-panel p-5">
        <div class="flex items-center gap-3">
          <span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal text-sm font-bold text-signal-fg">{{ index + 1 }}</span>
          <a :href="`./${page.dir}`" class="inline-flex min-h-11 items-center text-lg font-bold text-fg no-underline">{{ $t(`help.${page.slug}.title`) }}</a>
        </div>
        <p class="text-base text-muted">{{ $t(`help.index.cards.${page.slug}`) }}</p>
      </li>
    </ol>

    <Callout class="mt-8" kind="tip">
      <p>{{ $t('help.index.tipText') }}</p>
    </Callout>

    <section class="mt-12 rounded-2xl bg-panel2 p-6">
      <h2 class="mt-0">{{ $t('help.index.appTitle') }}</h2>
      <p>{{ $t('help.index.appText') }}</p>
      <p class="mt-4">
        <a href="../app/" class="inline-flex min-h-11 items-center rounded-lg bg-signal px-5 font-bold text-signal-fg no-underline">{{ $t('help.index.appLink') }}</a>
      </p>
    </section>
  </HelpLayout>
</template>
