import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './ui/App.vue'
import { createAppI18n, detectLocale } from './ui/i18n'
import './ui/styles/main.css'

const locale = detectLocale(navigator.languages ?? [navigator.language])
document.documentElement.lang = locale
createApp(App).use(createPinia()).use(createAppI18n(locale)).mount('#app')
