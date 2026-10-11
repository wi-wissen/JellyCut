import { createRouter, createWebHistory } from 'vue-router'
import LandingView from './views/LandingView.vue'
import EditorView from './views/EditorView.vue'
import SourcesGuideView from './views/SourcesGuideView.vue'

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
      { path: '/', name: 'landing', component: LandingView },
      { path: '/app', name: 'editor', component: EditorView },
      { path: '/help/sources', name: 'sources', component: SourcesGuideView }
    ]
  })
}
