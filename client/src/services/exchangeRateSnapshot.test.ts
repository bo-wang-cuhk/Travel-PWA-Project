import { describe, expect, it } from 'vitest'
import { buildExchangeRateSnapshot, formatCurrencyName, formatExchangeRateDate } from './exchangeRateSnapshot'

describe('exchangeRateSnapshot', () => {
  it('keeps each provider date and seeds the omitted base currency', () => {
    const snapshot = buildExchangeRateSnapshot(
      [
        { date: '2026-07-01', quote: 'USD', rate: 1.17 },
        { date: '2026-06-30', quote: 'CNY', rate: 8.39 },
      ],
      'EUR'
    )

    expect(snapshot.rates).toEqual({ EUR: 1, USD: 1.17, CNY: 8.39 })
    expect(snapshot.dates).toEqual({ USD: '2026-07-01', CNY: '2026-06-30', EUR: '2026-07-01' })
  })

  it('formats the provider date without timezone drift', () => {
    expect(formatExchangeRateDate('2026-07-01', 'zh-CN')).toBe('2026年7月1日')
    expect(formatExchangeRateDate('not-a-date', 'en')).toBeNull()
  })

  it('uses localized currency names without changing the ISO value', () => {
    expect(formatCurrencyName('EUR', 'zh-CN')).toBe('欧元')
    expect(formatCurrencyName('USD', 'zh-CN')).toBe('美元')
    expect(formatCurrencyName('CNY', 'zh-CN')).toBe('人民币')
  })
})
