import { describe, expect, it } from 'vitest'
import { getChinaDayStatus } from './chinaWorkday'

describe('getChinaDayStatus', () => {
  it('lets an official makeup day override Saturday', () => {
    expect(getChinaDayStatus('2026-02-14', [{ date: '2026-02-14', name: '春节', isOffDay: false }]).isWorkday).toBe(true)
  })

  it('lets an official day off override an ordinary weekday', () => {
    expect(getChinaDayStatus('2026-02-17', [{ date: '2026-02-17', name: '春节', isOffDay: true }]).isWorkday).toBe(false)
  })

  it('uses the weekday rule without a special date', () => {
    expect(getChinaDayStatus('2026-02-16', []).isWorkday).toBe(true)
    expect(getChinaDayStatus('2026-02-15', []).isWorkday).toBe(false)
  })
})
