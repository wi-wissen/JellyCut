import { createApp } from 'vue'
import LandingView from '../ui/views/LandingView.vue'
import { createAppI18n, detectLocale } from '../ui/i18n'
import '../ui/styles/main.css'

const locale = detectLocale(navigator.languages ?? [navigator.language])
document.documentElement.lang = locale
createApp(LandingView).use(createAppI18n(locale)).mount('#app')
