import type { HolidayDay } from './types'

export interface ChinaDayStatus {
  isWorkday: boolean
  specialDay: HolidayDay | null
}

/** Official holiday-cn exceptions override the ordinary Monday-Friday rule. */
export function getChinaDayStatus(date: string, days: HolidayDay[]): ChinaDayStatus {
  const specialDay = days.find(day => day.date === date) ?? null
  if (specialDay) return { isWorkday: !specialDay.isOffDay, specialDay }
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay()
  return { isWorkday: dayOfWeek !== 0 && dayOfWeek !== 6, specialDay: null }
}
