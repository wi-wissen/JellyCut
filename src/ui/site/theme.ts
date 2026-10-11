// Theme for the static pages (landing, help). The choice is remembered across pages in this browser.
const KEY = 'jellycut.theme'
export type SiteTheme = 'light' | 'dark'

function stored(): SiteTheme | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function currentTheme(): SiteTheme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  return systemPrefersDark() ? 'dark' : 'light'
}

export function applyStoredTheme(): void {
  const theme = stored()
  if (theme) document.documentElement.setAttribute('data-theme', theme)
}

export function setSiteTheme(theme: SiteTheme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode: the choice just lasts for this page.
  }
}
