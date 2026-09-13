import { SCHOOL_HOLIDAY_COUNTRY_CONFIG } from '../../vacay/schoolHolidayCountries'

// Loads the subdivision (state/region) options for a holiday-calendar country.
//
// The subdivision list is sourced from ISO 3166-2 (proper names, complete per country)
// rather than inferred from which subdivisions happen to have a holiday this year — the
// latter silently dropped states with no state-specific holiday (e.g. US-WA, issue #1456).
// We only surface a list for countries that are actually region-partitioned, so countries
// with only nationwide holidays keep showing no region picker (and allow a country-level
// calendar, matching the server's applyHolidayCalendars behaviour).
export async function fetchRegionOptions(country: string): Promise<{ value: string; label: string }[]> {
  try {
    // Loaded here, after the hasRegions check: the package is a single 238 kB data
    // blob (64 kB gzip, no tree-shaking to be had) and is only needed for countries
    // that get a region picker at all. Deliberately inside the try — if the chunk
    // fails, the result is the same empty array as a failed request, rather than an
    // unhandled rejection in the two callers that only do .then(setRegions).
    const iso31662 = (await import('iso-3166-2')).default

    const opts = new Map<string, string>() // ISO code -> display name
    const sub = iso31662.country(country)?.sub || {}
    for (const [code, info] of Object.entries(sub)) opts.set(code, info.name)

    return [...opts]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    return []
  }
}

export async function fetchSchoolHolidayRegionOptions(country: string, _lang?: string): Promise<{ value: string; label: string }[]> {
  const config = SCHOOL_HOLIDAY_COUNTRY_CONFIG[country]
  if (!config || config.strategy === 'country') return []

  if (config.strategy === 'groups') return []
  return fetchRegionOptions(country)
}
