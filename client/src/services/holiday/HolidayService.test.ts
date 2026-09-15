import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../../db/offlineDb'
import { HolidayService } from './HolidayService'
import type { HolidayProvider } from './types'

const officialDays = [{ date: '2026-02-17', name: '春节', isOffDay: true }]

function provider(days = officialDays): HolidayProvider & { fetchYear: ReturnType<typeof vi.fn> } {
  return {
    countryCode: 'CN', source: 'holiday-cn',
    fetchYear: vi.fn().mockImplementation(async (year: number) => ({ year, papers: [], days })),
  }
}

beforeEach(async () => { await clearAll() })

describe('HolidayService China cache policy', () => {
  it('does not request the next year before October', async () => {
    const source = provider()
    const service = new HolidayService(source, () => new Date('2026-09-14T00:00:00Z'), () => true)
    const value = await service.getChinaHoliday(2027)
    expect(value.status).toBe('pending')
    expect(value.days).toEqual([])
    expect(source.fetchYear).not.toHaveBeenCalled()
  })

  it('caches official current-year data and then stops requesting', async () => {
    const source = provider()
    const service = new HolidayService(source, () => new Date('2026-09-14T00:00:00Z'), () => true)
    expect((await service.getChinaHoliday(2026)).status).toBe('ready')
    expect((await service.getChinaHoliday(2026)).fromCache).toBe(true)
    expect(source.fetchYear).toHaveBeenCalledTimes(1)
    expect((await offlineDb.holidayCache.get('CN-2026'))?.fetchedAt).toBe('2026-09-14T00:00:00.000Z')
  })

  it('checks an unpublished next year at most every seven days after October', async () => {
    const source = provider([])
    let now = new Date('2026-10-01T00:00:00Z')
    const service = new HolidayService(source, () => now, () => true)
    expect((await service.getChinaHoliday(2027)).status).toBe('pending')
    now = new Date('2026-10-07T23:59:59Z')
    await service.getChinaHoliday(2027)
    expect(source.fetchYear).toHaveBeenCalledTimes(1)
    now = new Date('2026-10-08T00:00:00Z')
    await service.getChinaHoliday(2027)
    expect(source.fetchYear).toHaveBeenCalledTimes(2)
  })

  it('uses ready data offline and reports unavailable when uncached', async () => {
    const source = provider()
    const online = new HolidayService(source, () => new Date('2026-09-14T00:00:00Z'), () => true)
    await online.getChinaHoliday(2026)
    const offline = new HolidayService(source, () => new Date('2026-09-15T00:00:00Z'), () => false)
    expect((await offline.getChinaHoliday(2026)).status).toBe('ready')
    expect((await offline.getChinaHoliday(2025)).status).toBe('error')
  })

  it('keeps a next-year failure pending instead of treating it as no holidays', async () => {
    const source = provider()
    source.fetchYear.mockRejectedValue(new Error('network failed'))
    const service = new HolidayService(source, () => new Date('2026-10-01T00:00:00Z'), () => true)
    const value = await service.getChinaHoliday(2027)
    expect(value.status).toBe('pending')
    expect(value.lastCheckedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(value.lastError).toBe('network failed')
  })
})
