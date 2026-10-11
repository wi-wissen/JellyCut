import { createI18n } from 'vue-i18n'
import de from '../locales/de.json'
import en from '../locales/en.json'

export type Locale = 'de' | 'en'

export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('de')) ? 'de' : 'en'
}

export function createAppI18n(locale: Locale) {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { de, en } })
}
