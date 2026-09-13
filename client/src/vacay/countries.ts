/** Public-holiday calendar countries available without the TREK Server. */
export const VACAY_COUNTRY_CODES = [
  'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CN', 'CZ', 'DE', 'DK', 'ES', 'FI', 'FR',
  'GB', 'GR', 'HK', 'HR', 'HU', 'IE', 'IN', 'IS', 'IT', 'JP', 'KR', 'LU', 'MX',
  'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'SE', 'SG', 'SI', 'SK', 'TR', 'TW', 'US', 'ZA',
] as const

export function localizedVacayCountries(language: string): Array<{ value: string; label: string }> {
  let names: Intl.DisplayNames | undefined
  try { names = new Intl.DisplayNames([language], { type: 'region' }) } catch { /* old WebViews */ }
  return VACAY_COUNTRY_CODES.map(value => ({ value, label: names?.of(value) || value })).sort((a, b) => a.label.localeCompare(b.label))
}
