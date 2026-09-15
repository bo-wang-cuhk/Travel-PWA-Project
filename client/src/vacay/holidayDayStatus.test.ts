import { describe, expect, it } from 'vitest'
import { isNonWorkingDay } from './holidayDayStatus'

describe('isNonWorkingDay', () => {
  it('applies official rest and makeup-workday overrides before weekends', () => {
    expect(isNonWorkingDay('2026-02-14', {
      '2026-02-14': { name: '春节', localName: '春节', color: '#f00', label: null, type: 'makeup_workday', isOffDay: false },
    }, [0, 6])).toBe(false)
    expect(isNonWorkingDay('2026-02-17', {
      '2026-02-17': { name: '春节', localName: '春节', color: '#f00', label: null, type: 'public_holiday', isOffDay: true },
    }, [0, 6])).toBe(true)
  })
})
