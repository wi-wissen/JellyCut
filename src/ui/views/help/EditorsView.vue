<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import Callout from '../../site/Callout.vue'

type ToolType = 'commercial' | 'openSource' | 'os' | 'historic' | 'reference'

interface Tool {
  id: string
  name: string
  type: ToolType
  /** Official site (new tab), or an internal link, or none. */
  href?: string
  external?: boolean
}

interface Option {
  value: string
  /** Tool ids that fit this answer. */
  fits: string[]
}

interface Question {
  key: 'device' | 'files' | 'account' | 'goal'
  options: Option[]
}

// Verified against the official sites in October 2026, see the report for the sources.
const TOOLS: Tool[] = [
  { id: 'capcut', name: 'CapCut', type: 'commercial', href: 'https://www.capcut.com', external: true },
  { id: 'premiere', name: 'Adobe Premiere Pro', type: 'commercial', href: 'https://www.adobe.com/products/premiere.html', external: true },
  { id: 'shotcut', name: 'Shotcut', type: 'openSource', href: 'https://www.shotcut.org', external: true },
  { id: 'openshot', name: 'OpenShot', type: 'openSource', href: 'https://www.openshot.org', external: true },
  { id: 'filmcraft', name: 'FilmCraft', type: 'openSource', href: 'https://getartcraft.com/apps/filmcraft', external: true },
  { id: 'imovie', name: 'iMovie', type: 'os', href: 'https://www.apple.com/imovie/', external: true },
  { id: 'clipchamp', name: 'Clipchamp', type: 'os', href: 'https://www.clipchamp.com', external: true },
  { id: 'windowsMovieMaker', name: 'Windows Movie Maker', type: 'historic' },
  { id: 'jellycut', name: 'Jelly Cut', type: 'reference', href: '../../' }
]

const ALL = ['capcut', 'premiere', 'shotcut', 'openshot', 'filmcraft', 'imovie', 'clipchamp', 'jellycut']
const OFFLINE = ['premiere', 'shotcut', 'openshot', 'filmcraft', 'imovie', 'jellycut']
const NO_ACCOUNT = ['shotcut', 'openshot', 'filmcraft', 'imovie', 'jellycut']

// Each answer narrows the list to the tools that fit it. Answers combine by intersection.
const QUESTIONS: Question[] = [
  {
    key: 'device',
    options: [
      { value: 'pc', fits: ['capcut', 'premiere', 'shotcut', 'openshot', 'filmcraft', 'clipchamp', 'jellycut'] },
      { value: 'mac', fits: ['capcut', 'premiere', 'shotcut', 'openshot', 'filmcraft', 'imovie', 'jellycut'] },
      { value: 'mobile', fits: ['capcut', 'imovie'] },
      { value: 'browser', fits: ['capcut', 'clipchamp', 'jellycut'] }
    ]
  },
  {
    key: 'files',
    options: [
      { value: 'yes', fits: OFFLINE },
      { value: 'no', fits: ALL }
    ]
  },
  {
    key: 'account',
    options: [
      { value: 'yes', fits: NO_ACCOUNT },
      { value: 'no', fits: ALL }
    ]
  },
  {
    key: 'goal',
    options: [
      { value: 'simple', fits: ['capcut', 'imovie', 'clipchamp', 'openshot', 'jellycut'] },
      { value: 'pro', fits: ['premiere', 'shotcut'] }
    ]
  }
]

export default defineComponent({
  name: 'EditorsView',
  components: { HelpLayout, Callout },
  data() {
    return {
      tools: TOOLS,
      questions: QUESTIONS,
      answers: { device: '', files: '', account: '', goal: '', school: '' } as Record<string, string>
    }
  },
  computed: {
    answered(): boolean {
      return QUESTIONS.some((q) => this.answers[q.key] !== '')
    },
    matches(): Tool[] {
      if (!this.answered) return []
      let ids: string[] | null = null
      for (const q of QUESTIONS) {
        const value = this.answers[q.key]
        if (!value) continue
        const fits = q.options.find((o) => o.value === value)?.fits ?? []
        ids = ids === null ? fits : ids.filter((id) => fits.includes(id))
      }
      return TOOLS.filter((t) => ids?.includes(t.id))
    }
  },
  methods: {
    reset(): void {
      this.answers = { device: '', files: '', account: '', goal: '', school: '' }
    }
  }
})
</script>

<template>
  <HelpLayout page="editors">
    <template #lead>
      <p>{{ $t('help.editors.lead') }}</p>
    </template>

    <p class="text-sm font-semibold text-muted">{{ $t('help.editors.stand') }}</p>
    <p>{{ $t('help.editors.hint') }}</p>
    <p class="text-sm text-muted">{{ $t('help.editors.linkNote') }}</p>

    <h2 id="compare">{{ $t('help.editors.sectionTable') }}</h2>

    <div class="hidden overflow-x-auto xl:block">
      <table class="w-full border-collapse text-left text-sm">
        <caption class="sr-only">{{ $t('help.editors.tableCaption') }}</caption>
        <thead>
          <tr class="border-b border-line">
            <th scope="col" class="py-2 pr-3 font-bold">{{ $t('help.editors.columns.tool') }}</th>
            <th scope="col" class="py-2 pr-3 font-bold">{{ $t('help.editors.columns.type') }}</th>
            <th scope="col" class="py-2 pr-3 font-bold">{{ $t('help.editors.columns.cost') }}</th>
            <th scope="col" class="py-2 pr-3 font-bold">{{ $t('help.editors.columns.platforms') }}</th>
            <th scope="col" class="py-2 pr-3 font-bold">{{ $t('help.editors.columns.account') }}</th>
            <th scope="col" class="py-2 pr-3 font-bold">{{ $t('help.editors.columns.strong') }}</th>
            <th scope="col" class="py-2 font-bold">{{ $t('help.editors.columns.watch') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tool in tools" :key="tool.id" class="border-b border-line align-top">
            <th scope="row" class="py-3 pr-3 font-bold">
              <a
                v-if="tool.href && tool.external"
                :href="tool.href"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex min-h-11 items-center gap-1 text-txt underline underline-offset-2 hover:no-underline"
              >{{ tool.name }}<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" class="size-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg></a>
              <a v-else-if="tool.href" :href="tool.href" class="inline-flex min-h-11 items-center text-txt underline underline-offset-2 hover:no-underline">{{ tool.name }}</a>
              <span v-else>{{ tool.name }}</span>
            </th>
            <td class="py-3 pr-3">{{ $t(`help.editors.types.${tool.type}`) }}</td>
            <td class="py-3 pr-3">{{ $t(`help.editors.tools.${tool.id}.cost`) }}</td>
            <td class="py-3 pr-3">{{ $t(`help.editors.tools.${tool.id}.platforms`) }}</td>
            <td class="py-3 pr-3">{{ $t(`help.editors.tools.${tool.id}.account`) }}</td>
            <td class="py-3 pr-3">{{ $t(`help.editors.tools.${tool.id}.strong`) }}</td>
            <td class="py-3">{{ $t(`help.editors.tools.${tool.id}.watch`) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="grid gap-3 xl:hidden">
      <li v-for="tool in tools" :key="tool.id" class="rounded-xl border border-line bg-panel p-4">
        <h3 class="text-base font-bold">
          <a
            v-if="tool.href && tool.external"
            :href="tool.href"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex min-h-11 items-center text-txt underline underline-offset-2 hover:no-underline"
          >{{ tool.name }}</a>
          <a v-else-if="tool.href" :href="tool.href" class="inline-flex min-h-11 items-center text-txt underline underline-offset-2 hover:no-underline">{{ tool.name }}</a>
          <span v-else>{{ tool.name }}</span>
        </h3>
        <p class="text-sm text-muted">{{ $t(`help.editors.types.${tool.type}`) }}</p>
        <dl class="mt-3 grid gap-2 text-sm">
          <div>
            <dt class="font-bold">{{ $t('help.editors.columns.cost') }}</dt>
            <dd>{{ $t(`help.editors.tools.${tool.id}.cost`) }}</dd>
          </div>
          <div>
            <dt class="font-bold">{{ $t('help.editors.columns.platforms') }}</dt>
            <dd>{{ $t(`help.editors.tools.${tool.id}.platforms`) }}</dd>
          </div>
          <div>
            <dt class="font-bold">{{ $t('help.editors.columns.account') }}</dt>
            <dd>{{ $t(`help.editors.tools.${tool.id}.account`) }}</dd>
          </div>
          <div>
            <dt class="font-bold">{{ $t('help.editors.columns.strong') }}</dt>
            <dd>{{ $t(`help.editors.tools.${tool.id}.strong`) }}</dd>
          </div>
          <div>
            <dt class="font-bold">{{ $t('help.editors.columns.watch') }}</dt>
            <dd>{{ $t(`help.editors.tools.${tool.id}.watch`) }}</dd>
          </div>
        </dl>
      </li>
    </ul>

    <h2 id="choose">{{ $t('help.editors.sectionChoose') }}</h2>
    <p>{{ $t('help.editors.chooser.intro') }}</p>

    <div class="mt-4 grid gap-6">
      <fieldset v-for="question in questions" :key="question.key" class="grid gap-2">
        <legend class="font-bold">{{ $t(`help.editors.questions.${question.key}.label`) }}</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="option in question.options"
            :key="option.value"
            class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-panel px-3 text-base"
          >
            <input v-model="answers[question.key]" type="radio" :name="`editors-${question.key}`" :value="option.value" class="size-5 shrink-0" />
            <span>{{ $t(`help.editors.questions.${question.key}.options.${option.value}`) }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="grid gap-2">
        <legend class="font-bold">{{ $t('help.editors.questions.school.label') }}</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-panel px-3 text-base">
            <input v-model="answers.school" type="radio" name="editors-school" value="yes" class="size-5 shrink-0" />
            <span>{{ $t('help.editors.questions.school.options.yes') }}</span>
          </label>
          <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-panel px-3 text-base">
            <input v-model="answers.school" type="radio" name="editors-school" value="no" class="size-5 shrink-0" />
            <span>{{ $t('help.editors.questions.school.options.no') }}</span>
          </label>
        </div>
        <p v-if="answers.school === 'yes'" class="text-sm">{{ $t('help.editors.questions.school.note') }}</p>
      </fieldset>
    </div>

    <section class="mt-6 rounded-xl border border-line bg-panel p-4" aria-live="polite">
      <h3 class="text-base font-bold">{{ $t('help.editors.chooser.resultTitle') }}</h3>
      <p v-if="!answered" class="mt-2 text-sm text-muted">{{ $t('help.editors.chooser.empty') }}</p>
      <p v-else-if="matches.length === 0" class="mt-2 text-sm">{{ $t('help.editors.chooser.none') }}</p>
      <template v-else>
        <p class="mt-2 text-sm text-muted">{{ $t('help.editors.chooser.resultCount', { count: matches.length }) }}</p>
        <ul class="mt-2 flex flex-wrap gap-2">
          <li v-for="tool in matches" :key="tool.id">
            <a
              v-if="tool.external"
              :href="tool.href"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-11 items-center rounded-lg border border-line px-3 font-semibold text-txt no-underline hover:border-txt"
            >{{ tool.name }}</a>
            <span v-else class="inline-flex min-h-11 items-center rounded-lg border border-line px-3 font-semibold">{{ tool.name }}</span>
          </li>
        </ul>
      </template>
      <button
        v-if="answered"
        type="button"
        class="mt-4 inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-txt hover:border-txt"
        @click="reset"
      >
        {{ $t('help.editors.chooser.reset') }}
      </button>
    </section>

    <div class="mt-8">
      <Callout kind="note">
        <p>{{ $t('help.editors.merke') }}</p>
      </Callout>
    </div>

    <p class="mt-8">{{ $t('help.editors.rightsText') }}</p>
    <p class="mt-3 flex flex-wrap gap-x-5 gap-y-2">
      <a href="../rights/" class="inline-flex min-h-11 items-center font-semibold text-txt underline underline-offset-2 hover:no-underline">{{ $t('help.editors.links.rights') }}</a>
      <a href="../sources/" class="inline-flex min-h-11 items-center font-semibold text-txt underline underline-offset-2 hover:no-underline">{{ $t('help.editors.links.sources') }}</a>
    </p>
  </HelpLayout>
</template>
