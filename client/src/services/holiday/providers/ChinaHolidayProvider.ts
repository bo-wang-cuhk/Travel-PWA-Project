import type { HolidayProvider, HolidayProviderResult } from '../types'

interface HolidayCnPayload {
  year: number
  papers: string[]
  days: Array<{ name: string; date: string; isOffDay: boolean }>
}

function parsePayload(value: unknown, requestedYear: number): HolidayCnPayload {
  if (!value || typeof value !== 'object') throw new Error('holiday-cn returned an invalid document')
  const raw = value as Partial<HolidayCnPayload>
  if (raw.year !== requestedYear || !Array.isArray(raw.papers) || !Array.isArray(raw.days)) {
    throw new Error(`holiday-cn returned an invalid ${requestedYear} document`)
  }
  const papers = raw.papers.filter((paper): paper is string => typeof paper === 'string')
  const days = raw.days.map((day, index) => {
    if (!day || typeof day.name !== 'string' || typeof day.date !== 'string' || typeof day.isOffDay !== 'boolean') {
      throw new Error(`holiday-cn day ${index} is invalid`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || Number(day.date.slice(0, 4)) !== requestedYear) {
      throw new Error(`holiday-cn day ${index} has an invalid date`)
    }
    return { name: day.name, date: day.date, isOffDay: day.isOffDay }
  })
  return { year: raw.year, papers, days }
}

export class ChinaHolidayProvider implements HolidayProvider {
  readonly countryCode = 'CN'
  readonly source = 'holiday-cn'

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master',
  ) {}

  async fetchYear(year: number): Promise<HolidayProviderResult> {
    const response = await this.fetcher(`${this.baseUrl}/${year}.json`, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`holiday-cn request failed (${response.status})`)
    return parsePayload(await response.json(), year)
  }
}
