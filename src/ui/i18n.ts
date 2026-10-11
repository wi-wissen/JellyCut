import { createI18n } from 'vue-i18n'
import de from '../locales/de.json'
import en from '../locales/en.json'

export type Locale = 'de' | 'en'
type Messages = { [key: string]: Messages | string }

export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('de')) ? 'de' : 'en'
}

/** Page texts live in src/locales/pages/<name>.<locale>.json so that pages can be written independently. */
const pageFiles = import.meta.glob<Messages>('../locales/pages/*.json', { eager: true, import: 'default' })

function merge(target: Messages, source: Messages): Messages {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (typeof value === 'object' && typeof existing === 'object') merge(existing, value)
    else target[key] = value
  }
  return target
}

function pagesFor(locale: Locale): Messages {
  const merged: Messages = {}
  for (const [path, messages] of Object.entries(pageFiles).sort(([a], [b]) => a.localeCompare(b))) {
    if (path.endsWith(`.${locale}.json`)) merge(merged, structuredClone(messages))
  }
  return merged
}

export function allMessages(): Record<Locale, Messages> {
  return {
    de: merge(structuredClone(de as Messages), pagesFor('de')),
    en: merge(structuredClone(en as Messages), pagesFor('en'))
  }
}

export function createAppI18n(locale: Locale) {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: allMessages() })
}
