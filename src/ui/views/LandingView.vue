<script lang="ts">
import { defineComponent } from 'vue'
import LandingHeader from '../landing/LandingHeader.vue'
import HeroMock from '../landing/HeroMock.vue'
import CtaButton from '../landing/CtaButton.vue'
import FilmStrip from '../landing/FilmStrip.vue'
import FeatureCards from '../landing/FeatureCards.vue'
import PrivacySection from '../landing/PrivacySection.vue'
import SchoolStrip from '../landing/SchoolStrip.vue'
import SiteFooter from '../site/SiteFooter.vue'
import { fineHover, motionAllowed } from '../landing/motion'

let observer: IntersectionObserver | null = null
let moveGlow: ((event: PointerEvent) => void) | null = null

export default defineComponent({
  name: 'LandingView',
  components: { LandingHeader, HeroMock, CtaButton, FilmStrip, FeatureCards, PrivacySection, SchoolStrip, SiteFooter },
  mounted() {
    if (!motionAllowed()) return
    document.documentElement.classList.add('jc-motion')
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer?.unobserve(entry.target)
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -6% 0px' }
    )
    this.$el.querySelectorAll('.jc-reveal').forEach((el: Element) => observer?.observe(el))
    if (fineHover()) {
      const glow = this.$refs.glow as HTMLElement
      moveGlow = (event: PointerEvent) => {
        glow.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`
        glow.classList.add('is-on')
      }
      window.addEventListener('pointermove', moveGlow, { passive: true })
    }
  },
  unmounted() {
    observer?.disconnect()
    observer = null
    if (moveGlow) window.removeEventListener('pointermove', moveGlow)
    moveGlow = null
    document.documentElement.classList.remove('jc-motion')
  }
})
</script>

<template>
  <div class="jc-landing">
    <span class="jc-blob jc-blob--violet" aria-hidden="true"></span>
    <span class="jc-blob jc-blob--lime" aria-hidden="true"></span>
    <span class="jc-blob jc-blob--soft" aria-hidden="true"></span>
    <span ref="glow" class="jc-glow" aria-hidden="true"></span>

    <LandingHeader />

    <main>
      <section class="jc-hero" aria-labelledby="hero-title">
        <div>
          <p class="jc-eyebrow">{{ $t('landing.eyebrow') }}</p>
          <h1 id="hero-title" class="jc-display jc-hero__title">
            {{ $t('landing.headline') }} <span class="jc-mark">{{ $t('landing.headlineMark') }}</span>
          </h1>
          <p class="jc-hero__tagline">{{ $t('landing.tagline') }}</p>
          <div class="jc-hero__actions">
            <CtaButton href="./app/" :label="$t('landing.open')" />
          </div>
          <p class="jc-hint">{{ $t('landing.ctaHint') }}</p>
          <ul class="jc-trust">
            <li><svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{{ $t('landing.trust.account') }}</li>
            <li><svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{{ $t('landing.trust.ads') }}</li>
            <li><svg viewBox="0 0 24 24" class="jc-icon" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{{ $t('landing.trust.paywall') }}</li>
          </ul>
        </div>
        <HeroMock />
      </section>

      <FilmStrip />

      <section class="jc-section" aria-labelledby="features-title">
        <div class="jc-reveal">
          <h2 id="features-title" class="jc-display jc-h2">{{ $t('landing.features.title') }}</h2>
          <p class="jc-lead">{{ $t('landing.features.intro') }}</p>
        </div>
        <FeatureCards />
      </section>

      <section class="jc-section">
        <PrivacySection />
      </section>

      <section class="jc-section">
        <SchoolStrip />
      </section>

      <section class="jc-section">
        <div class="jc-final jc-reveal">
          <h2 class="jc-display">{{ $t('landing.final.title') }}</h2>
          <p>{{ $t('landing.final.text') }}</p>
          <CtaButton href="./app/" :label="$t('landing.open')" />
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
