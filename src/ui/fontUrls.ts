// Font file URLs for the export worker (a worker cannot use the page's @font-face rules).
import sora from '@fontsource/sora/files/sora-latin-700-normal.woff2?url'
import inter from '@fontsource/inter/files/inter-latin-700-normal.woff2?url'
import lora from '@fontsource/lora/files/lora-latin-700-normal.woff2?url'
import bebas from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url'
import pacifico from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url'
import caveat from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url'
import fredoka from '@fontsource/fredoka/files/fredoka-latin-600-normal.woff2?url'
import dmMono from '@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2?url'
import type { FontSource } from '../engine/export/fontLoader'

export const FONT_SOURCES: FontSource[] = [
  { family: 'Sora', weight: 700, url: sora },
  { family: 'Inter', weight: 700, url: inter },
  { family: 'Lora', weight: 700, url: lora },
  { family: 'Bebas Neue', weight: 400, url: bebas },
  { family: 'Pacifico', weight: 400, url: pacifico },
  { family: 'Caveat', weight: 700, url: caveat },
  { family: 'Fredoka', weight: 600, url: fredoka },
  { family: 'DM Mono', weight: 500, url: dmMono }
]
