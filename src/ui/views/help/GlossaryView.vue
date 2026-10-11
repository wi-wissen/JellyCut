<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import { HELP_PAGES, helpRoots } from '../../site/helpPages'

interface TermDef {
  id: string
  /** Help pages that explain the term in depth. */
  pages: readonly string[]
  /** Other glossary terms that belong with it. */
  related: readonly string[]
}

// Ids are the anchors (#id) that other pages link to. Texts live in help.glossary.terms.<id>.
const TERMS: readonly TermDef[] = [
  { id: 'abspielkopf', pages: ['container'], related: ['zeitleiste'] },
  { id: 'abtastrate', pages: ['container'], related: ['mono-stereo'] },
  { id: 'aufkleber', pages: [], related: ['ueberlagerung'] },
  { id: 'aufloesung', pages: ['compression'], related: ['bildrate', 'bitrate'] },
  { id: 'autosave', pages: [], related: ['export'] },
  { id: 'bild', pages: ['container', 'compression'], related: ['standbild', 'keyframe'] },
  { id: 'bildrate', pages: ['compression'], related: ['aufloesung'] },
  { id: 'bitrate', pages: ['compression', 'encoding'], related: ['aufloesung', 'export'] },
  { id: 'clip', pages: [], related: ['spur', 'feinschnitt'] },
  { id: 'codec', pages: ['container', 'encoding'], related: ['container', 'kodieren'] },
  { id: 'container', pages: ['container'], related: ['codec'] },
  { id: 'credits', pages: ['sources'], related: ['lizenz'] },
  { id: 'einpassen-fuellen', pages: [], related: ['seitenverhaeltnis'] },
  { id: 'export', pages: ['encoding'], related: ['kodieren', 'codec', 'bitrate'] },
  { id: 'feinschnitt', pages: ['encoding'], related: ['keyframe', 'clip'] },
  { id: 'filter', pages: [], related: ['transparenz'] },
  { id: 'format', pages: ['encoding'], related: ['export', 'codec'] },
  { id: 'keyframe', pages: ['compression', 'encoding'], related: ['bild', 'feinschnitt'] },
  { id: 'kodieren', pages: ['encoding'], related: ['codec', 'export'] },
  { id: 'lautstaerke', pages: [], related: ['wellenform'] },
  { id: 'lizenz', pages: ['sources'], related: ['credits'] },
  { id: 'mono-stereo', pages: [], related: ['abtastrate'] },
  { id: 'seitenverhaeltnis', pages: [], related: ['einpassen-fuellen', 'aufloesung'] },
  { id: 'spur', pages: ['container'], related: ['clip', 'untertitel'] },
  { id: 'standbild', pages: [], related: ['bild'] },
  { id: 'tempo', pages: [], related: ['clip'] },
  { id: 'transparenz', pages: [], related: ['ueberlagerung'] },
  { id: 'uebergang', pages: [], related: ['ueberblenden', 'clip'] },
  { id: 'ueberblenden', pages: [], related: ['uebergang'] },
  { id: 'ueberlagerung', pages: [], related: ['aufkleber', 'transparenz'] },
  { id: 'untertitel', pages: ['container'], related: ['spur'] },
  { id: 'verpixeln', pages: [], related: ['weichzeichnen'] },
  { id: 'weichzeichnen', pages: [], related: ['verpixeln'] },
  { id: 'wellenform', pages: ['container'], related: ['lautstaerke', 'abtastrate'] },
  { id: 'zeitleiste', pages: [], related: ['abspielkopf', 'spur', 'clip'] }
]

interface Link {
  href: string
  label: string
}

interface Entry {
  id: string
  term: string
  text: string
  keys: string
  letter: string
  pages: Link[]
  related: Link[]
}

/** Alphabetical glossary with client-side search. Every term has an anchor, so pages can link to it. */
export default defineComponent({
  name: 'GlossaryView',
  components: { HelpLayout },
  data() {
    return {
      query: '',
      helpRoot: helpRoots('glossary/').help
    }
  },
  computed: {
    entries(): Entry[] {
      const locale = this.$i18n.locale
      const built = TERMS.map((def) => {
        const term = this.$t(`help.glossary.terms.${def.id}.term`)
        return {
          id: def.id,
          term,
          text: this.$t(`help.glossary.terms.${def.id}.text`),
          keys: this.$t(`help.glossary.terms.${def.id}.keys`),
          letter: term.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase(),
          pages: def.pages.map((slug) => {
            const page = HELP_PAGES.find((p) => p.slug === slug)!
            return { href: `${this.helpRoot}${page.dir}`, label: this.$t(`help.${slug}.title`) }
          }),
          related: def.related.map((id) => ({ href: `#${id}`, label: this.$t(`help.glossary.terms.${id}.term`) }))
        }
      })
      return built.sort((a, b) => a.term.localeCompare(b.term, locale))
    },
    matches(): Entry[] {
      const q = this.query.trim().toLowerCase()
      if (!q) return this.entries
      return this.entries.filter((e) => `${e.term} ${e.text} ${e.keys}`.toLowerCase().includes(q))
    },
    groups(): { letter: string; entries: Entry[] }[] {
      const map = new Map<string, Entry[]>()
      for (const entry of this.matches) {
        const list = map.get(entry.letter) ?? []
        list.push(entry)
        map.set(entry.letter, list)
      }
      return [...map].map(([letter, entries]) => ({ letter, entries }))
    },
    countText(): string {
      return this.matches.length === 0
        ? this.$t('help.glossary.empty')
        : this.$t('help.glossary.count', { count: this.matches.length })
    }
  },
  mounted() {
    window.addEventListener('hashchange', this.onHash)
    if (window.location.hash) {
      void this.$nextTick(() => document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView())
    }
  },
  beforeUnmount() {
    window.removeEventListener('hashchange', this.onHash)
  },
  methods: {
    onHash(): void {
      // A link to a term that the search hides would lead nowhere: show the full list first.
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (this.query && id && !this.matches.some((e) => e.id === id)) this.query = ''
    },
    clear(): void {
      this.query = ''
    }
  }
})
</script>

<template>
  <HelpLayout page="glossary">
    <template #lead>{{ $t('help.glossary.lead') }}</template>

    <form class="mt-2" role="search" @submit.prevent>
      <label class="block">
        <span class="text-sm font-semibold">{{ $t('help.glossary.search.label') }}</span>
        <div class="mt-2 flex gap-2">
          <input
            v-model="query"
            type="search"
            autocomplete="off"
            :placeholder="$t('help.glossary.search.placeholder')"
            class="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-fg placeholder:text-muted"
          />
          <button
            v-if="query"
            type="button"
            class="min-h-11 shrink-0 rounded-lg border border-line bg-panel2 px-3 text-sm font-semibold text-fg hover:border-txt"
            @click="clear"
          >
            {{ $t('help.glossary.search.clear') }}
          </button>
        </div>
      </label>
      <p class="mt-2 text-sm text-muted" aria-live="polite" data-stat="count">{{ countText }}</p>
    </form>

    <nav class="mt-4" :aria-label="$t('help.glossary.lettersLabel')">
      <ul class="flex flex-wrap gap-1.5">
        <li v-for="group in groups" :key="group.letter">
          <a :href="`#letter-${group.letter.toLowerCase()}`" class="inline-flex size-11 items-center justify-center rounded-lg border border-line bg-panel text-sm font-bold text-fg no-underline hover:border-txt">{{ group.letter }}</a>
        </li>
      </ul>
    </nav>

    <div v-for="group in groups" :key="group.letter">
      <h2 :id="`letter-${group.letter.toLowerCase()}`">{{ group.letter }}</h2>
      <div class="space-y-3">
        <section
          v-for="entry in group.entries"
          :id="entry.id"
          :key="entry.id"
          class="scroll-mt-6 rounded-xl border border-line bg-panel p-4 target:ring-2 target:ring-fill"
        >
          <h3 class="text-lg font-bold">{{ entry.term }}</h3>
          <p class="mt-1 leading-relaxed">{{ entry.text }}</p>
          <p v-if="entry.pages.length || entry.related.length" class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span class="font-semibold">{{ $t('help.glossary.seeAlso') }}:</span>
            <a v-for="link in entry.pages" :key="link.href" :href="link.href" class="inline-flex min-h-11 items-center text-txt underline underline-offset-2">{{ link.label }}</a>
            <a v-for="link in entry.related" :key="link.href" :href="link.href" class="inline-flex min-h-11 items-center text-txt underline underline-offset-2">{{ link.label }}</a>
          </p>
        </section>
      </div>
    </div>
  </HelpLayout>
</template>
