import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { vacayRepo } from './vacayRepo'

beforeEach(async () => { await clearAll(); localStorage.clear() })

describe('vacayRepo local-first', () => {
  it('marks and unmarks vacation days without a server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch'); await vacayRepo.toggleEntry('2026-06-20', 1, 1, 'vacation')
    expect((await vacayRepo.getEntries(2026)).entries).toHaveLength(1)
    await vacayRepo.toggleEntry('2026-06-20', 1, 1, 'vacation')
    expect((await vacayRepo.getEntries(2026)).entries).toEqual([])
    expect((await offlineDb.vacayData.get('personal-vacay'))?.entryTombstones['1:2026-06-20']).toBeTruthy(); expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps every entry when several days are toggled concurrently', async () => {
    const dates = Array.from({ length: 7 }, (_, index) => `2026-06-${String(index + 20).padStart(2, '0')}`)

    await Promise.all(dates.map(date => vacayRepo.toggleEntry(date, 1, 1, 'vacation')))

    expect((await vacayRepo.getEntries(2026)).entries.map(entry => entry.date).sort()).toEqual(dates)
  })

  it('persists settings, years, company holidays and entitlement', async () => {
    await vacayRepo.addYear(2027); await vacayRepo.toggleCompanyHoliday('2027-06-02'); await vacayRepo.updateStats(2027, 25)
    await vacayRepo.updateYearSettings({ year_type: 'fiscal', year_start_month: 4, year_start_day: 1, hire_date: null })
    expect((await vacayRepo.getYears()).years).toContain(2027); expect((await vacayRepo.getEntries(2027)).companyHolidays).toEqual([{ date: '2027-06-02' }])
    expect((await vacayRepo.getStats(2027)).stats[0].vacation_days).toBe(25); expect((await vacayRepo.getYearSettings()).settings.year_type).toBe('fiscal')
  })

  it('queues one provider-neutral aggregate for cloud synchronization', async () => {
    await vacayRepo.updatePlan({ block_weekends: false })
    expect((await offlineDb.syncOutbox.get('vacay:personal-vacay'))?.operation).toBe('upsert')
  })
})
