import { describe, expect, it, vi } from 'vitest'
import { ChinaHolidayProvider } from './ChinaHolidayProvider'

describe('ChinaHolidayProvider', () => {
  it('converts holiday-cn without leaking its raw payload', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        year: 2026,
        papers: ['https://www.gov.cn/example'],
        days: [
          { name: '春节', date: '2026-02-17', isOffDay: true },
          { name: '春节', date: '2026-02-14', isOffDay: false },
        ],
      }),
    })
    const provider = new ChinaHolidayProvider(fetcher as unknown as typeof fetch)
    const value = await provider.fetchYear(2026)
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/2026.json'), expect.any(Object))
    expect(value.days).toEqual([
      { name: '春节', date: '2026-02-17', isOffDay: true },
      { name: '春节', date: '2026-02-14', isOffDay: false },
    ])
  })

  it('rejects malformed or wrong-year data', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ year: 2025, papers: [], days: [] }) })
    await expect(new ChinaHolidayProvider(fetcher as unknown as typeof fetch).fetchYear(2026)).rejects.toThrow('invalid 2026')
  })
})
