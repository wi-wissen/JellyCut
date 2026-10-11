import { createApp } from 'vue'
import SourcesGuideView from '../ui/views/SourcesGuideView.vue'
import { createAppI18n, detectLocale } from '../ui/i18n'
import '../ui/styles/main.css'

const locale = detectLocale(navigator.languages ?? [navigator.language])
document.documentElement.lang = locale
createApp(SourcesGuideView).use(createAppI18n(locale)).mount('#app')
