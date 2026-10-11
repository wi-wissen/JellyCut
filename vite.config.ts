import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const here = import.meta.dirname

// Real pages, not a single-page app: /, /app/ (the editor) and /help/sources/ are files on the server, so
// static hosting (GitHub Pages) serves them directly and the start page never loads the editor code.
export default defineConfig({
  base: './',
  appType: 'mpa',
  plugins: [vue(), tailwindcss()],
  optimizeDeps: { include: ['mediabunny'] },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(here, 'index.html'),
        app: resolve(here, 'app/index.html'),
        sources: resolve(here, 'help/sources/index.html')
      }
    }
  },
  test: { include: ['src/**/*.test.ts'] }
})
