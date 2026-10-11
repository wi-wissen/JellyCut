import { describe, expect, it } from 'vitest'
import { allMessages } from '../i18n'
import { HELP_PAGES, helpRoots, neighbours } from './helpPages'

/** Every help page file, keyed by its path relative to this folder. */
const PAGE_FILES = import.meta.glob('../../../help/**/index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Folder prefixes of the pages on disk: '' for the start page, 'rights/' for help/rights/index.html. */
function pageFolders(): string[] {
  return Object.keys(PAGE_FILES).map((path) => path.replace(/^.*\/help\//, '').replace(/index\.html$/, ''))
}

describe('help pages', () => {
  it('lists every page folder on disk exactly once', () => {
    expect(HELP_PAGES.map((p) => p.dir).sort()).toEqual(pageFolders().sort())
  })

  it('has unique slugs', () => {
    const slugs = HELP_PAGES.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('has a title in German and English for every page', () => {
    const messages = allMessages()
    for (const page of HELP_PAGES) {
      for (const locale of ['de', 'en'] as const) {
        const title = (messages[locale] as Record<string, any>).help?.[page.slug]?.title
        expect(typeof title, `${locale} title of ${page.slug}`).toBe('string')
      }
    }
  })

  it('names its slug in the body of its html file', () => {
    for (const page of HELP_PAGES) {
      const path = Object.keys(PAGE_FILES).find((p) => p.endsWith(`help/${page.dir}index.html`))
      expect(path, `file of ${page.slug}`).toBeDefined()
      expect(PAGE_FILES[path!]).toContain(`<body data-page="${page.slug}">`)
    }
  })

  it('links the start page and sub pages to the right roots', () => {
    expect(helpRoots('')).toEqual({ site: '../', help: './' })
    expect(helpRoots('rights/')).toEqual({ site: '../../', help: '../' })
  })

  it('chains previous and next pages through the whole list', () => {
    expect(neighbours(HELP_PAGES[0]!.slug).prev).toBeUndefined()
    const visited: string[] = []
    let slug: string | undefined = HELP_PAGES[0]!.slug
    while (slug) {
      visited.push(slug)
      slug = neighbours(slug).next?.slug
    }
    expect(visited).toEqual(HELP_PAGES.map((p) => p.slug))
  })
})
