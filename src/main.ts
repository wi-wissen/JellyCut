import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './ui/App.vue'
import { useEditorStore } from './ui/stores/editor'
import { createAppRouter } from './ui/router'
import { createAppI18n, detectLocale } from './ui/i18n'
import './ui/styles/main.css'

const locale = detectLocale(navigator.languages ?? [navigator.language])
document.documentElement.lang = locale
const pinia = createPinia()
// Restore before mounting so the demo project never flashes on reload.
void useEditorStore(pinia)
  .restoreAutosave()
  .finally(() => createApp(App).use(pinia).use(createAppI18n(locale)).use(createAppRouter()).mount('#app'))
