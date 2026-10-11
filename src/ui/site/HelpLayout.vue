<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { HELP_PAGES, helpRoots, neighbours, type HelpPage } from './helpPages'
import ThemeToggle from './ThemeToggle.vue'
import SiteFooter from './SiteFooter.vue'
import HelpIcon from './HelpIcon.vue'
import './help.css'

// Frame of every help page: header, page navigation, title, content slot, previous/next and footer.
export default defineComponent({
  name: 'HelpLayout',
  components: { ThemeToggle, SiteFooter, HelpIcon },
  props: {
    page: { type: String as PropType<string>, required: true }
  },
  computed: {
    current(): HelpPage {
      const found = HELP_PAGES.find((p) => p.slug === this.page)
      if (!found) throw new Error(`unknown help page: ${this.page}`)
      return found
    },
    roots(): { site: string; help: string } {
      return helpRoots(this.current.dir)
    },
    title(): string {
      return this.$t(`help.${this.current.slug}.title`)
    },
    navItems(): { slug: string; href: string; label: string }[] {
      return HELP_PAGES.map((p) => ({
        slug: p.slug,
        href: this.roots.help + p.dir,
        label: this.$t(`help.${p.slug}.title`)
      }))
    },
    neighbourLinks(): { prev?: { href: string; label: string }; next?: { href: string; label: string } } {
      const { prev, next } = neighbours(this.current.slug)
      const link = (p: HelpPage) => ({ href: this.roots.help + p.dir, label: this.$t(`help.${p.slug}.title`) })
      return { prev: prev && link(prev), next: next && link(next) }
    }
  }
})
</script>

<template>
  <div class="min-h-full bg-bg text-fg text-[1.0625rem] leading-relaxed">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-4 focus:py-3 focus:font-bold focus:text-txt focus:shadow-lg"
    >
      {{ $t('help.common.skip') }}
    </a>

    <header class="border-b border-line bg-panel">
      <div class="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1 sm:gap-3 sm:px-6">
        <a :href="roots.site" class="inline-flex min-h-11 items-center gap-2 rounded-lg font-bold text-fg no-underline">
          <img :src="`${roots.site}favicon.svg`" alt="" width="28" height="28" class="size-7" />
          <span>{{ $t('app.name') }}</span>
        </a>
        <div class="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            :href="`${roots.site}app/`"
            class="inline-flex min-h-11 items-center rounded-lg bg-signal px-4 text-sm font-bold text-signal-fg no-underline"
          >
            {{ $t('help.common.openApp') }}
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>

    <div class="mx-auto max-w-6xl px-4 sm:px-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
      <nav :aria-label="$t('help.common.navLabel')" class="py-3 lg:sticky lg:top-0 lg:self-start lg:py-12">
        <ol class="flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
          <li v-for="item in navItems" :key="item.slug">
            <a
              :href="item.href"
              :aria-current="item.slug === current.slug ? 'page' : undefined"
              class="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold no-underline"
              :class="item.slug === current.slug ? 'bg-panel2 text-fg' : 'text-muted hover:bg-panel2 hover:text-fg'"
            >
              <HelpIcon :name="item.slug" />
              {{ item.label }}
            </a>
          </li>
        </ol>
      </nav>

      <main id="main" tabindex="-1" class="min-w-0 max-w-[72ch] pb-12 pt-4 lg:pt-12">
        <nav v-if="current.slug !== 'index'" :aria-label="$t('help.common.breadcrumb')" class="text-sm">
          <ol class="flex flex-wrap items-center gap-x-2 text-muted">
            <li>
              <a :href="roots.help" class="inline-flex min-h-11 items-center text-txt underline underline-offset-2">{{ $t('help.index.title') }}</a>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{{ title }}</li>
          </ol>
        </nav>

        <h1 class="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{{ title }}</h1>
        <div class="mt-4 text-lg text-muted">
          <slot name="lead" />
        </div>

        <div class="help-prose mt-8">
          <slot />
        </div>

        <nav :aria-label="$t('help.common.pageNav')" class="mt-16 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
          <a
            v-if="neighbourLinks.prev"
            :href="neighbourLinks.prev.href"
            rel="prev"
            class="flex min-h-11 flex-col rounded-xl border border-line bg-panel p-4 no-underline hover:border-txt"
          >
            <span class="text-xs font-bold uppercase tracking-wide text-muted">
              <span aria-hidden="true">←</span> {{ $t('help.common.previous') }}
            </span>
            <span class="mt-1 font-semibold text-fg">{{ neighbourLinks.prev.label }}</span>
          </a>
          <a
            v-if="neighbourLinks.next"
            :href="neighbourLinks.next.href"
            rel="next"
            class="flex min-h-11 flex-col rounded-xl border border-line bg-panel p-4 text-right no-underline hover:border-txt sm:col-start-2"
          >
            <span class="text-xs font-bold uppercase tracking-wide text-muted">
              {{ $t('help.common.next') }} <span aria-hidden="true">→</span>
            </span>
            <span class="mt-1 font-semibold text-fg">{{ neighbourLinks.next.label }}</span>
          </a>
        </nav>
      </main>
    </div>

    <SiteFooter />
  </div>
</template>
