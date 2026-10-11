// Dev-time pipeline for the animated stickers (not shipped, not part of the build).
// Reads scripts/animated-stickers.selection.json, downloads the chosen APNGs of microsoft/fluentui-emoji-animated
// (pinned commit, real files via media.githubusercontent.com because the repo stores them in Git LFS), samples at
// most 48 frames, packs them into one WebP sprite sheet per sticker and writes src/assets/stickers-animated/
// (sheets, catalogue.json, SOURCES.txt, LICENSE-FluentEmojiAnimated.txt). The originals are never committed.
// New stickers also get their static twin (Fluent Emoji 3D, 256 px WebP q88) when --static-repo points at a clone
// of microsoft/fluentui-emoji.
//
// Needs: node, curl, python3 with Pillow and numpy. Nothing is added to package.json.
// Usage: node scripts/build-animated-stickers.mjs [--cache DIR] [--static-repo DIR] [--only id,id] [--quality 66]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM = 'microsoft/fluentui-emoji-animated'
const UPSTREAM_COMMIT = 'daa0365c09795789ed2bc6e8b228c97736cb6669'
const STATIC_UPSTREAM = 'microsoft/fluentui-emoji'
const STATIC_COMMIT = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc'

const CELL = 128
const MAX_FRAMES = 48
const TOTAL_BUDGET = 6_000_000
/** A loop must move (mean frame difference, 0..255) and its wrap must be an ordinary step (wrap difference / mean step). */
const MIN_MOTION = 0.6
const MAX_LOOP_RATIO = 3

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src/assets/stickers-animated')
const staticDir = join(root, 'src/assets/stickers')
const helper = join(root, 'scripts/animated-stickers-sheet.py')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const cacheDir = option('--cache', join(tmpdir(), 'jellycut-animated-originals'))
const staticRepo = option('--static-repo', '')
const only = option('--only', '')
const quality = Number(option('--quality', '62'))

const selection = JSON.parse(readFileSync(join(root, 'scripts/animated-stickers.selection.json'), 'utf8')).entries
const wanted = only ? selection.filter((e) => only.split(',').includes(e.id)) : selection
mkdirSync(outDir, { recursive: true })
mkdirSync(cacheDir, { recursive: true })

const run = (cmd, argv) => execFileSync(cmd, argv, { encoding: 'utf8', maxBuffer: 1 << 26 })

function download(url, file) {
  run('curl', ['-fsSL', '--retry', '3', '-m', '120', '-o', file, url])
  const head = readFileSync(file).subarray(0, 8)
  if (!head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || statSync(file).size < 2000) {
    throw new Error(`${url} is not a real PNG (a Git LFS pointer?)`)
  }
}

const catalogue = existsSync(join(outDir, 'catalogue.json')) ? JSON.parse(readFileSync(join(outDir, 'catalogue.json'), 'utf8')) : null
const built = new Map((catalogue?.entries ?? []).map((e) => [e.id, e]))

for (const entry of wanted) {
  const original = join(cacheDir, `${entry.unicode.replaceAll(' ', '_')}.png`)
  if (!existsSync(original)) {
    const url = `https://media.githubusercontent.com/media/${UPSTREAM}/${UPSTREAM_COMMIT}/${entry.upstream.split('/').map(encodeURIComponent).join('/')}`
    download(url, original)
  }
  const sheet = `sticker-anim-${entry.id}.webp`
  const numbers = JSON.parse(
    run('python3', ['-I', helper, 'sheet', original, join(outDir, sheet), '--cell', String(CELL), '--quality', String(quality), '--max-frames', String(MAX_FRAMES)])
  )
  if (numbers.motion < MIN_MOTION) throw new Error(`${entry.id}: motion ${numbers.motion} is too small to see`)
  if (numbers.loopRatio >= MAX_LOOP_RATIO) throw new Error(`${entry.id}: the loop jumps at its end (wrap ratio ${numbers.loopRatio})`)
  built.set(entry.id, {
    id: entry.id,
    glyph: entry.glyph,
    rank: entry.rank,
    group: entry.group,
    sheet,
    frames: numbers.frames,
    cols: numbers.cols,
    rows: numbers.rows,
    cell: numbers.cell,
    frameMicros: numbers.frameMicros,
    loopMicros: numbers.loopMicros,
    sourceFrames: numbers.sourceFrames,
    stride: numbers.stride,
    bytes: numbers.bytes
  })
  console.log(`${entry.id.padEnd(16)} ${String(numbers.frames).padStart(2)} frames ${String(numbers.loopMicros / 1000).padStart(7)} ms ${String(Math.round(numbers.bytes / 1024)).padStart(4)} kB  motion ${numbers.motion} wrap ${numbers.loopRatio}`)

  // The static twin of a sticker that the gallery did not have before.
  const twin = join(staticDir, `${entry.id}.webp`)
  if (entry.staticFrom && !existsSync(twin)) {
    if (!staticRepo) throw new Error(`${entry.id} needs a static twin: pass --static-repo <clone of ${STATIC_UPSTREAM}>`)
    const folder = join(staticRepo, entry.staticFrom)
    const png = run('ls', [folder]).split('\n').find((f) => f.endsWith('.png'))
    if (!png) throw new Error(`no 3D PNG in ${folder}`)
    run('python3', ['-I', helper, 'static', join(folder, png), twin])
    appendFileSync(join(staticDir, 'SOURCES.txt'), `${entry.id}\t${entry.staticFrom.replace(/^assets\//, '').replace(/\/3D$/, '')}\n`)
  }
}

const entries = selection.map((e) => built.get(e.id)).filter(Boolean)
const total = entries.reduce((sum, e) => sum + e.bytes, 0)
if (total > TOTAL_BUDGET) throw new Error(`sheets are ${total} bytes, over the budget of ${TOTAL_BUDGET}`)

writeFileSync(
  join(outDir, 'catalogue.json'),
  JSON.stringify({ upstream: { repo: `https://github.com/${UPSTREAM}`, commit: UPSTREAM_COMMIT }, cell: CELL, quality, entries }, null, 1) + '\n'
)
writeFileSync(
  join(outDir, 'SOURCES.txt'),
  [
    `# Sticker id -> file in https://github.com/${UPSTREAM}, commit ${UPSTREAM_COMMIT}`,
    `# Animated PNG (256 x 256) -> at most ${MAX_FRAMES} frames, ${CELL} px cells, one lossy WebP sheet (quality ${quality}). Built by scripts/build-animated-stickers.mjs.`,
    ...selection.map((e) => `${e.id}\t${e.upstream}`)
  ].join('\n') + '\n'
)

const licence = join(outDir, 'LICENSE-FluentEmojiAnimated.txt')
if (!existsSync(licence)) {
  run('curl', ['-fsSL', '-m', '60', '-o', licence, `https://raw.githubusercontent.com/${UPSTREAM}/${UPSTREAM_COMMIT}/LICENSE`])
}
console.log(`${entries.length} sheets, ${(total / 1024 / 1024).toFixed(2)} MB`)
