// The help pages in reading order. Every entry has a real page at help/<dir>index.html (see vite.config.ts).
export interface HelpPage {
  /** Value of body[data-page] and the segment of the help.<slug>.* message keys. */
  slug: string
  /** Folder under help/ with trailing slash; empty for the start page. */
  dir: string
  /** SVG path data (24x24 grid, stroke icon). */
  icon: string
}

export const HELP_PAGES = [
  {
    slug: 'index',
    dir: '',
    icon: 'M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z'
  },
  {
    slug: 'container',
    dir: 'container/',
    icon: 'M4 6h16v12H4zM10 9.5v5l4-2.5z'
  },
  {
    slug: 'compression',
    dir: 'compression/',
    icon: 'M9 4v5H4M15 20v-5h5M4 9l5-5M20 15l-5 5'
  },
  {
    slug: 'encoding',
    dir: 'encoding/',
    icon: 'M4 8h13l-3-3M20 16H7l3 3'
  },
  {
    slug: 'glossary',
    dir: 'glossary/',
    icon: 'M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM8 7h6'
  },
  {
    slug: 'sources',
    dir: 'sources/',
    icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6'
  },
  {
    slug: 'rights',
    dir: 'rights/',
    icon: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z'
  },
  {
    slug: 'tech',
    dir: 'tech/',
    icon: 'M9 9h6v6H9zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3'
  },
  {
    slug: 'editors',
    dir: 'editors/',
    icon: 'M4 5h16v4H4zM4 13h10v6H4zM16 13h4v6h-4z'
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
