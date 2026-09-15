export type HolidayDataStatus = 'ready' | 'pending' | 'error'

export interface HolidayDay {
  date: string
  name: string
  isOffDay: boolean
}

export interface HolidayProviderResult {
  year: number
  days: HolidayDay[]
  papers: string[]
}

export interface HolidayProvider {
  readonly countryCode: string
  readonly source: string
  fetchYear(year: number): Promise<HolidayProviderResult>
}

export interface HolidayCacheRecord {
  key: string
  countryCode: 'CN'
  year: number
  status: HolidayDataStatus
  source: 'holiday-cn'
  fetchedAt: string | null
  lastCheckedAt: string | null
  days: HolidayDay[]
  papers: string[]
  lastError: string | null
}

export interface HolidayYearResult extends HolidayCacheRecord {
  fromCache: boolean
}
