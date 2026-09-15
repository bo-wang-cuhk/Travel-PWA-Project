export interface ExchangeRateRow {
  date: string
  quote: string
  rate: number
}

export interface ExchangeRateSnapshot {
  rates: Record<string, number>
  dates: Record<string, string>
}

/** Convert a Frankfurter response into the values and provider dates used by the UI. */
export function buildExchangeRateSnapshot(rows: ExchangeRateRow[], base: string): ExchangeRateSnapshot {
  const rates: Record<string, number> = { [base]: 1 }
  const dates: Record<string, string> = {}
  let latestDate: string | null = null

  for (const row of rows) {
    if (!row.quote || !Number.isFinite(row.rate) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
    rates[row.quote] = row.rate
    dates[row.quote] = row.date
    if (!latestDate || row.date > latestDate) latestDate = row.date
  }

  // The API omits the base currency's self-rate, so use the snapshot's latest
  // provider date when the user converts a currency to itself.
  if (latestDate) dates[base] = latestDate
  return { rates, dates }
}

/** Format an API date as a calendar date without allowing timezone drift. */
export function formatExchangeRateDate(date: string | null | undefined, locale: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const value = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(value.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(value)
}

/** Return the localized currency name while keeping the ISO code as a safe fallback. */
export function formatCurrencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: 'currency' }).of(code) || code
  } catch {
    return code
  }
}
