import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const here = import.meta.dirname

// Sprite sheets of the animated stickers (src/assets/stickers-animated, file name prefix `sticker-anim-`): about 6 MB
// that most people never need. They stay out of the precache; the service worker caches them on first use.
const ANIMATED_SHEET = /(^|\/)sticker-anim-[^/]+\.webp$/

// Writes the precache list, the list of lazily cached sheets and a build id into dist/sw.js after the bundle is
// written (no dependency). Pages are listed as directories ('app/', not 'app/index.html') so the offline lookup for /app/ succeeds.
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
      const sheets = files.filter((file) => ANIMATED_SHEET.test(file))
      const precache = files.filter((file) => !ANIMATED_SHEET.test(file)).map((file) => {
        if (file === 'index.html') return ''
        if (file.endsWith('/index.html')) return file.slice(0, -'index.html'.length)
        return file
      })
      const source = readFileSync(swPath, 'utf8')
      const built = source
        .replace("'__BUILD_ID__'", JSON.stringify(buildId))
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__ANIMATED__', JSON.stringify(sheets))
      if (built === source || built.includes('__PRECACHE__') || built.includes('__BUILD_ID__') || built.includes('__ANIMATED__')) {
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

// Every page is a real html file, so static hosting (GitHub Pages) serves them directly and the start page
// never loads the editor code. Help pages are picked up by folder: help/<name>/index.html needs no config.
function htmlInputs(): Record<string, string> {
  const inputs: Record<string, string> = {
    landing: resolve(here, 'index.html'),
    app: resolve(here, 'app/index.html')
  }
  const walkHelp = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walkHelp(path, `${rel}${name}/`)
      else if (name === 'index.html') inputs[`help/${rel}index.html`] = path
    }
  }
  walkHelp(resolve(here, 'help'), '')
  return inputs
}

export default defineConfig({
  base: './',
  appType: 'mpa',
  plugins: [vue(), tailwindcss(), serviceWorkerPlugin()],
  optimizeDeps: { include: ['mediabunny'] },
  build: {
    rollupOptions: {
      input: htmlInputs()
    }
  },
  // tokens.css is read as text by the contrast test; Vitest empties CSS modules unless they are included.
  test: { include: ['src/**/*.test.ts'], css: { include: [/tokens\.css/] } }
})
