import { createRouter, createWebHistory } from 'vue-router'
import LandingView from './views/LandingView.vue'

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
      { path: '/', name: 'landing', component: LandingView },
      { path: '/app', name: 'editor', component: () => import('./views/EditorView.vue') },
      { path: '/help/sources', name: 'sources', component: () => import('./views/SourcesGuideView.vue') }
    ]
  })
}
