import { createApp } from 'vue'
import { createPinia } from 'pinia'
import EditorView from '../ui/views/EditorView.vue'
import { useEditorStore } from '../ui/stores/editor'
import { createAppI18n, detectLocale } from '../ui/i18n'
import '../ui/styles/main.css'

const locale = detectLocale(navigator.languages ?? [navigator.language])
document.documentElement.lang = locale
const pinia = createPinia()
// Restore the autosave before mounting, so the start project never flashes on reload.
void useEditorStore(pinia)
  .restoreAutosave()
  .catch(() => undefined)
  .finally(() => createApp(EditorView).use(pinia).use(createAppI18n(locale)).mount('#app'))
