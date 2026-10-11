import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const here = import.meta.dirname

// Writes the precache list and a build id into dist/sw.js after the bundle is written (no dependency).
// Pages are listed as directories ('app/', not 'app/index.html') so the offline lookup for /app/ succeeds.
function serviceWorkerPlugin(): Plugin {
  let outDir = ''
  return {
    name: 'jellycut-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js')
      if (!existsSync(swPath)) throw new Error('dist/sw.js is missing: public/sw.js was not copied')
      const files = walk(outDir)
        .filter((f) => f !== 'sw.js')
        .sort()
      const hash = createHash('sha256')
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)))
      const buildId = hash.digest('hex').slice(0, 12)
      const precache = files.map((file) => {
        if (file === 'index.html') return ''
        if (file.endsWith('/index.html')) return file.slice(0, -'index.html'.length)
        return file
      })
      const source = readFileSync(swPath, 'utf8')
      const built = source
        .replace("'__BUILD_ID__'", JSON.stringify(buildId))
        .replace('__PRECACHE__', JSON.stringify(precache))
      if (built === source || built.includes('__PRECACHE__') || built.includes('__BUILD_ID__')) {
        throw new Error('public/sw.js placeholders were not replaced')
      }
      writeFileSync(swPath, built)
    }
  }

  function walk(dir: string, prefix = ''): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      const rel = prefix + name
      return statSync(path).isDirectory() ? walk(path, rel + '/') : [rel.split(sep).join('/')]
    })
  }
}

// Real pages, not a single-page app: /, /app/ (the editor) and /help/sources/ are files on the server, so
// static hosting (GitHub Pages) serves them directly and the start page never loads the editor code.
export default defineConfig({
  base: './',
  appType: 'mpa',
  plugins: [vue(), tailwindcss(), serviceWorkerPlugin()],
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
  // tokens.css is read as text by the contrast test; Vitest empties CSS modules unless they are included.
  test: { include: ['src/**/*.test.ts'], css: { include: [/tokens\.css/] } }
})
