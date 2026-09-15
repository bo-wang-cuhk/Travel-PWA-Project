import { offlineDb } from '../../db/offlineDb'
import { ChinaHolidayProvider } from './providers/ChinaHolidayProvider'
import type { HolidayCacheRecord, HolidayProvider, HolidayYearResult } from './types'

const NEXT_YEAR_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

function key(year: number) { return `CN-${year}` }

function result(record: HolidayCacheRecord, fromCache: boolean): HolidayYearResult {
  return { ...record, fromCache }
}

function pending(year: number, previous?: HolidayCacheRecord): HolidayCacheRecord {
  return previous ?? {
    key: key(year), countryCode: 'CN', year, status: 'pending', source: 'holiday-cn',
    fetchedAt: null, lastCheckedAt: null, days: [], papers: [], lastError: null,
  }
}

export class HolidayService {
  constructor(
    private readonly chinaProvider: HolidayProvider = new ChinaHolidayProvider(),
    private readonly now: () => Date = () => new Date(),
    private readonly isOnline: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  ) {}

  async getChinaHoliday(year: number): Promise<HolidayYearResult> {
    const cached = await offlineDb.holidayCache.get(key(year))
    if (cached?.status === 'ready') return result(cached, true)

    const now = this.now()
    const currentYear = now.getFullYear()
    const month = now.getMonth() + 1

    // Later years are never guessed. The next year is not even checked before October.
    if (year > currentYear + 1 || (year === currentYear + 1 && month < 10)) {
      const value = pending(year, cached)
      if (!cached) await offlineDb.holidayCache.put(value)
      return result(value, Boolean(cached))
    }

    if (year === currentYear + 1 && cached?.lastCheckedAt) {
      const elapsed = now.getTime() - Date.parse(cached.lastCheckedAt)
      if (Number.isFinite(elapsed) && elapsed < NEXT_YEAR_CHECK_INTERVAL_MS) return result(cached, true)
    }

    if (!this.isOnline()) {
      if (cached) return result(cached, true)
      return result({ ...pending(year), status: year === currentYear + 1 ? 'pending' : 'error', lastError: 'offline' }, false)
    }

    const checkedAt = now.toISOString()
    try {
      const remote = await this.chinaProvider.fetchYear(year)
      const hasOfficialData = remote.days.length > 0
      const value: HolidayCacheRecord = {
        key: key(year), countryCode: 'CN', year,
        status: hasOfficialData ? 'ready' : 'pending', source: 'holiday-cn',
        fetchedAt: hasOfficialData ? checkedAt : (cached?.fetchedAt ?? null),
        lastCheckedAt: checkedAt, days: hasOfficialData ? remote.days : [], papers: remote.papers,
        lastError: null,
      }
      await offlineDb.holidayCache.put(value)
      return result(value, false)
    } catch (error) {
      // Ready caches return before any request, so failures can only update an
      // unpublished/error row and can never overwrite valid holiday data.
      const isNextYear = year === currentYear + 1
      const value: HolidayCacheRecord = {
        ...(cached ?? pending(year)), status: isNextYear ? 'pending' : 'error',
        lastCheckedAt: checkedAt, lastError: error instanceof Error ? error.message : String(error),
      }
      await offlineDb.holidayCache.put(value)
      return result(value, Boolean(cached))
    }
  }
}

export const holidayService = new HolidayService()
