import type { HolidayInfo, HolidaysMap } from '../types'

export function holidayMarkersForDate(holidays: HolidaysMap, date: string): HolidayInfo[] {
  const value = holidays[date]
  return Array.isArray(value) ? value : value ? [value] : []
}

/** An official provider override wins over the configured ordinary weekend rule. */
export function isNonWorkingDay(date: string, holidays: HolidaysMap, weekendDays: number[]): boolean {
  const official = holidayMarkersForDate(holidays, date).find(marker => marker.isOffDay !== undefined)
  if (official) return official.isOffDay === true
  return weekendDays.includes(new Date(`${date}T00:00:00`).getDay())
}
