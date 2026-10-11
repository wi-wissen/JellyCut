// Shared entry of all help pages. Each help/<dir>/index.html sets body[data-page] to a slug from HELP_PAGES.
import { createApp, type Component } from 'vue'
import { applyStoredTheme } from '../ui/site/theme'
import { HELP_PAGES, type HelpPageSlug } from '../ui/site/helpPages'
import { createAppI18n, detectLocale } from '../ui/i18n'
import '../ui/styles/main.css'

type ViewLoader = () => Promise<{ default: Component }>

// One lazy view per page: a page loads only its own view.
const VIEWS = {
  index: () => import('../ui/views/help/StartView.vue'),
  container: () => import('../ui/views/help/ContainerView.vue'),
  compression: () => import('../ui/views/help/CompressionView.vue'),
  encoding: () => import('../ui/views/help/EncodingView.vue'),
  glossary: () => import('../ui/views/help/GlossaryView.vue'),
  sources: () => import('../ui/views/SourcesGuideView.vue'),
  rights: () => import('../ui/views/help/RightsView.vue'),
  tech: () => import('../ui/views/help/TechView.vue'),
  editors: () => import('../ui/views/help/EditorsView.vue')
} satisfies Record<HelpPageSlug, ViewLoader>

const slug = document.body.dataset.page ?? ''
const known = HELP_PAGES.find((p) => p.slug === slug)
if (!known) throw new Error(`unknown help page: "${slug}"`)

applyStoredTheme()
const locale = detectLocale(navigator.languages ?? [navigator.language])
document.documentElement.lang = locale
const i18n = createAppI18n(locale)
document.title = `${i18n.global.t(`help.${slug}.title`)} · Jelly Cut`

const load = VIEWS[known.slug]
void load().then(({ default: view }) => {
  createApp(view).use(i18n).mount('#app')
})
