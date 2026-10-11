/** Locale-aware decimal text (German uses a comma). main.ts sets <html lang> from the detected locale. */
export function formatNumber(value: number, maxFractionDigits = 1): string {
  const locale = document.documentElement.lang || 'en'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits }).format(value)
}
