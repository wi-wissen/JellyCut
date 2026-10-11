<script lang="ts">
import { defineComponent } from 'vue'
import HelpLayout from '../../site/HelpLayout.vue'
import Callout from '../../site/Callout.vue'

const AVOID = ['streaming', 'video', 'search', 'film', 'memes', 'logos'] as const
const IMAGE = ['ask', 'askAgain', 'background', 'cut'] as const
const CHECKLIST = ['material', 'consent', 'background', 'music', 'age', 'school', 'lastly'] as const

export default defineComponent({
  name: 'RightsView',
  components: { HelpLayout, Callout },
  data() {
    return { avoid: AVOID, image: IMAGE, checklist: CHECKLIST }
  }
})
</script>

<template>
  <HelpLayout page="rights">
    <template #lead>
      <p>{{ $t('help.rights.lead') }}</p>
    </template>

    <Callout class="mt-6">
      <p>{{ $t('help.rights.generalNote') }}</p>
    </Callout>

    <section id="avoid" class="scroll-mt-6">
      <h2>{{ $t('help.rights.avoidTitle') }}</h2>
      <p>{{ $t('help.rights.avoidIntro') }}</p>
      <ul>
        <li v-for="item in avoid" :key="item">{{ $t(`help.rights.avoid.${item}`) }}</li>
      </ul>
      <p>
        {{ $t('help.rights.avoidSources') }}
        <a href="../sources/">{{ $t('help.sources.title') }}</a>
      </p>
    </section>

    <section id="image-rights" class="scroll-mt-6">
      <h2>{{ $t('help.rights.imageTitle') }}</h2>
      <div class="flex items-start gap-5">
        <div class="min-w-0">
          <p>{{ $t('help.rights.imageText') }}</p>
        </div>
        <svg aria-hidden="true" focusable="false" viewBox="0 0 120 110" class="hidden size-24 shrink-0 sm:block">
          <path d="M18 14h62a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H50l-12 10v-10h-8a10 10 0 0 1-10-10V24a10 10 0 0 1 10-10z" fill="#c6f432" />
          <text x="40" y="45" font-size="26" font-weight="700" fill="#14121f" font-family="sans-serif">?</text>
          <rect x="34" y="66" width="72" height="38" rx="9" fill="#6d4cf5" />
          <rect x="52" y="58" width="18" height="10" rx="3" fill="#6d4cf5" />
          <circle cx="70" cy="85" r="11" fill="#fff" />
          <circle cx="70" cy="85" r="5.5" fill="#14121f" />
        </svg>
      </div>
      <ul>
        <li v-for="item in image" :key="item">{{ $t(`help.rights.image.${item}`) }}</li>
      </ul>
      <Callout kind="tip">
        <p>{{ $t('help.rights.blurNote') }}</p>
      </Callout>
      <Callout>
        <p>{{ $t('help.rights.schoolNote') }}</p>
      </Callout>
    </section>

    <section id="age" class="scroll-mt-6">
      <h2>{{ $t('help.rights.ageTitle') }}</h2>
      <p>{{ $t('help.rights.ageText') }}</p>
      <ul>
        <li>{{ $t('help.rights.ageYoutube') }}</li>
        <li>{{ $t('help.rights.ageNoAccount') }}</li>
        <li>{{ $t('help.rights.ageAsk') }}</li>
      </ul>
      <p>{{ $t('help.rights.ageAlternative') }}</p>
    </section>

    <section id="checklist" class="scroll-mt-6">
      <h2>{{ $t('help.rights.doubtTitle') }}</h2>
      <p>{{ $t('help.rights.doubtIntro') }}</p>
      <ul class="list-none pl-0">
        <li v-for="item in checklist" :key="item" class="flex gap-3">
          <span aria-hidden="true" class="mt-1 size-5 shrink-0 rounded border-2 border-txt"></span>
          <span>{{ $t(`help.rights.checklist.${item}`) }}</span>
        </li>
      </ul>
    </section>
  </HelpLayout>
</template>
