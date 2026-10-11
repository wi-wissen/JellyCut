// The help pages in reading order. Every entry has a real page at help/<dir>index.html (see vite.config.ts).
export interface HelpPage {
  /** Value of body[data-page] and the segment of the help.<slug>.* message keys. */
  slug: string
  /** Folder under help/ with trailing slash; empty for the start page. */
  dir: string
}

export const HELP_PAGES = [
  {
    slug: 'index',
    dir: ''
  },
  {
    slug: 'container',
    dir: 'container/'
  },
  {
    slug: 'compression',
    dir: 'compression/'
  },
  {
    slug: 'encoding',
    dir: 'encoding/'
  },
  {
    slug: 'glossary',
    dir: 'glossary/'
  },
  {
    slug: 'sources',
    dir: 'sources/'
  },
  {
    slug: 'rights',
    dir: 'rights/'
  },
  {
    slug: 'tech',
    dir: 'tech/'
  },
  {
    slug: 'editors',
    dir: 'editors/'
  }
] as const satisfies readonly HelpPage[]

export type HelpPageSlug = (typeof HELP_PAGES)[number]['slug']

/** Relative prefixes from a help page to the site root and to the help root, for the given page. */
export function helpRoots(dir: string): { site: string; help: string } {
  const depth = dir.split('/').filter(Boolean).length
  return { site: '../'.repeat(depth + 1), help: depth === 0 ? './' : '../'.repeat(depth) }
}

export function neighbours(slug: string): { prev: HelpPage | undefined; next: HelpPage | undefined } {
  const index = HELP_PAGES.findIndex((p) => p.slug === slug)
  return { prev: HELP_PAGES[index - 1], next: HELP_PAGES[index + 1] }
}
