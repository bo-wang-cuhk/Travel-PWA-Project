import type { VacayYearSettingsRequest } from '@trek/shared'
import { offlineDb } from '../db/offlineDb'
import { VACAY_SYNC_ID, type LocalVacayRecord } from '../domain/vacaySyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { VacayHolidayCalendar, VacayPlan, VacayStat, VacayUser } from '../types'
import { DEFAULT_YEAR_SETTINGS, inGridWindow } from '../vacay/yearWindow'
import { getHolidays as getGermanHolidays } from '../components/Vacay/holidays'
import { holidayService } from '../services/holiday/HolidayService'
import type { HolidayDataStatus } from '../services/holiday/types'
import { workspaceMembersApi, type WorkspacePerson } from '../auth/workspaceMembersApi'
import { SUPABASE_AUTH_ENABLED } from '../auth/supabaseClient'

const MEMBER_COLORS = ['#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444', '#22c55e']

// Calendar clicks can arrive before the previous IndexedDB read-modify-write
// finishes. Keep those mutations in order so each one sees the last saved value.
let calendarMutationQueue: Promise<void> = Promise.resolve()

function serializeCalendarMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = calendarMutationQueue.then(mutation, mutation)
  calendarMutationQueue = result.then(() => undefined, () => undefined)
  return result
}

function currentUser(): VacayUser {
  try {
    const raw = localStorage.getItem('trek_auth_snapshot')
    const user = raw ? JSON.parse(raw)?.state?.user : null
    return { id: Number(user?.id ?? 1), username: String(user?.username ?? 'Me'), color: '#3b82f6' }
  } catch { return { id: 1, username: 'Me', color: '#3b82f6' } }
}

function initialRecord(): LocalVacayRecord {
  const user = currentUser(); const year = new Date().getFullYear(); const now = new Date().toISOString()
  return {
    id: VACAY_SYNC_ID,
    plan: { id: -1, owner_id: user.id, name: 'My vacation', holidays_enabled: false, school_holidays_enabled: false, holidays_region: null, holiday_calendars: [], block_weekends: true, carry_over_enabled: false, company_holidays_enabled: true, weekend_days: '0,6', week_start: 1, created_at: now, updated_at: now },
    users: [user], years: [year], entries: [], companyHolidays: [], stats: [],
    yearSettings: DEFAULT_YEAR_SETTINGS, entryTombstones: {}, updated_at: now, deleted_at: null,
  }
}

async function read(): Promise<LocalVacayRecord> {
  const existing = await offlineDb.vacayData.get(VACAY_SYNC_ID)
  if (existing) return existing
  const value = initialRecord(); await offlineDb.vacayData.put(value); return value
}

async function write(value: LocalVacayRecord): Promise<LocalVacayRecord> {
  const next = { ...value, plan: { ...value.plan, updated_at: new Date().toISOString() }, updated_at: new Date().toISOString() }
  await offlineDb.transaction('rw', [offlineDb.vacayData, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
    await offlineDb.vacayData.put(next); await markLocalChange('vacay', VACAY_SYNC_ID, 'upsert')
  })
  return next
}

function computeStats(value: LocalVacayRecord, year: number): VacayStat[] {
  return value.users.map(user => {
    const previous = value.stats.find(row => row.user_id === user.id && row.year === year)
    const used = value.entries.filter(entry => entry.user_id === user.id && (entry.kind ?? 'vacation') === 'vacation' && inGridWindow(entry.date, year, value.yearSettings)).reduce((sum, entry) => sum + (entry.fraction ?? 1), 0)
    const compUsed = value.entries.filter(entry => entry.user_id === user.id && entry.kind === 'comp' && inGridWindow(entry.date, year, value.yearSettings)).reduce((sum, entry) => sum + (entry.fraction ?? 1), 0)
    const vacationDays = previous?.vacation_days ?? 30; const carriedOver = previous?.carried_over ?? 0
    return { user_id: user.id, person_name: user.username, person_color: user.color ?? '#3b82f6', year, vacation_days: vacationDays, carried_over: carriedOver, total_available: vacationDays + carriedOver, used, remaining: vacationDays + carriedOver - used, comp_used: compUsed }
  })
}

function withWorkspaceUsers(value: LocalVacayRecord, members: WorkspacePerson[]): LocalVacayRecord {
  const colors = new Map(value.users.map(user => [user.id, user.color]))
  return {
    ...value,
    users: members.map((member, index) => ({
      id: member.id,
      username: member.display_name || member.username,
      color: colors.get(member.id) || MEMBER_COLORS[index % MEMBER_COLORS.length],
    })),
  }
}

export const vacayRepo = {
  async getPlan(refreshWorkspaceMembers = true) {
    let value = await read()
    let isOwner = true
    if (refreshWorkspaceMembers && SUPABASE_AUTH_ENABLED && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const context = await workspaceMembersApi.context()
        value = withWorkspaceUsers(value, context.members)
        await offlineDb.vacayData.put(value)
        isOwner = context.can_manage
      } catch { /* Keep the cached workspace roster when offline/unavailable. */ }
    }
    return { plan: value.plan, users: value.users, pendingInvites: [], incomingInvites: [], isOwner, isFused: value.users.length > 1 }
  },
  async updatePlan(data: Partial<VacayPlan>) { const value = await read(); value.plan = { ...value.plan, ...data }; const next = await write(value); return { plan: next.plan } },
  async updateColor(color: string, targetUserId?: number) { const value = await read(); const id = targetUserId ?? currentUser().id; value.users = value.users.map(user => user.id === id ? { ...user, color } : user); await write(value); return { success: true } },
  async invite(userId: number) {
    const context = await workspaceMembersApi.add(userId)
    const value = withWorkspaceUsers(await read(), context.members)
    await write(value)
    return { success: true }
  },
  async acceptInvite() { return { success: false } },
  async declineInvite() { return { success: false } },
  async cancelInvite(userId: number) {
    const context = await workspaceMembersApi.remove(userId)
    const value = withWorkspaceUsers(await read(), context.members)
    await write(value)
    return { success: true }
  },
  async dissolve() { return { success: false } },
  async getYears() { return { years: (await read()).years } },
  async addYear(year: number) { const value = await read(); value.years = [...new Set([...value.years, year])].sort(); await write(value); return { years: value.years } },
  async removeYear(year: number) { const value = await read(); value.years = value.years.filter(v => v !== year); await write(value); return { years: value.years } },
  async getEntries(year: number) { const value = await read(); return { entries: value.entries.filter(v => inGridWindow(v.date, year, value.yearSettings)), companyHolidays: value.companyHolidays.filter(v => inGridWindow(v.date, year, value.yearSettings)) } },
  async toggleEntry(date: string, targetUserId?: number, fraction: 0.5 | 1 = 1, kind: 'vacation' | 'comp' = 'vacation') {
    return serializeCalendarMutation(async () => {
      const value = await read(); const userId = targetUserId ?? currentUser().id; const key = `${userId}:${date}`; const existing = value.entries.find(v => v.user_id === userId && v.date === date)
      if (existing && (existing.fraction ?? 1) === fraction && (existing.kind ?? 'vacation') === kind) { value.entries = value.entries.filter(v => !(v.user_id === userId && v.date === date)); value.entryTombstones[key] = new Date().toISOString() }
      else if (existing) { value.entries = value.entries.map(v => v === existing ? { ...v, fraction, kind } : v); delete value.entryTombstones[key] }
      else { const user = value.users.find(v => v.id === userId) ?? currentUser(); value.entries.push({ date, user_id: userId, fraction, kind, person_name: user.username, person_color: user.color ?? undefined }); delete value.entryTombstones[key] }
      await write(value); return { success: true }
    })
  },
  async toggleCompanyHoliday(date: string) {
    return serializeCalendarMutation(async () => {
      const value = await read(); value.companyHolidays = value.companyHolidays.some(v => v.date === date) ? value.companyHolidays.filter(v => v.date !== date) : [...value.companyHolidays, { date }]; await write(value); return { success: true }
    })
  },
  async getStats(year: number) { const value = await read(); const stats = computeStats(value, year); value.stats = [...value.stats.filter(v => v.year !== year), ...stats]; await offlineDb.vacayData.put(value); return { stats } },
  async updateStats(year: number, days: number, targetUserId?: number) { const value = await read(); const id = targetUserId ?? currentUser().id; const stats = computeStats(value, year); value.stats = [...value.stats.filter(v => v.year !== year), ...stats.map(v => v.user_id === id ? { ...v, vacation_days: days, total_available: days + v.carried_over, remaining: days + v.carried_over - v.used } : v)]; await write(value); return { success: true } },
  async getHolidays(year: number, country: string) {
    if (country === 'CN') {
      const value = await holidayService.getChinaHoliday(year)
      return {
        status: value.status, source: value.source, fetchedAt: value.fetchedAt,
        lastCheckedAt: value.lastCheckedAt, error: value.lastError,
        holidays: value.days.map(day => ({
          date: day.date, name: day.name, localName: day.name, global: true,
          counties: null, isOffDay: day.isOffDay,
        })),
      }
    }
    if (country === 'DE') {
      return {
        status: 'ready' as HolidayDataStatus, source: 'local-rule', fetchedAt: null,
        lastCheckedAt: null, error: null,
        holidays: Object.entries(getGermanHolidays(year, '')).map(([date, name]) => ({
          date, name, localName: name, global: true, counties: null, isOffDay: true,
        })),
      }
    }
    return { status: 'pending' as HolidayDataStatus, source: 'unavailable', fetchedAt: null, lastCheckedAt: null, error: null, holidays: [] }
  },
  async getSchoolHolidays() { return [] },
  async addHolidayCalendar(data: { region: string; color?: string; label?: string | null; type?: 'public_holiday' | 'school_holiday' }) { const value = await read(); const calendar: VacayHolidayCalendar = { id: Math.min(0, ...value.plan.holiday_calendars.map(v => v.id)) - 1, plan_id: value.plan.id, region: data.region, color: data.color ?? '#fecaca', label: data.label ?? null, type: data.type ?? 'public_holiday', sort_order: value.plan.holiday_calendars.length }; value.plan.holiday_calendars.push(calendar); await write(value); return { calendar } },
  async updateHolidayCalendar(id: number, data: Partial<VacayHolidayCalendar>) { const value = await read(); value.plan.holiday_calendars = value.plan.holiday_calendars.map(v => v.id === id ? { ...v, ...data } : v); await write(value); const calendar = value.plan.holiday_calendars.find(v => v.id === id); if (!calendar) throw new Error('Holiday calendar not found'); return { calendar } },
  async deleteHolidayCalendar(id: number) { const value = await read(); value.plan.holiday_calendars = value.plan.holiday_calendars.filter(v => v.id !== id); await write(value); return { success: true } },
  async getShares() { return { outgoing: [], incoming: [] } }, async share() { return { success: false } }, async removeShare() { return { success: false } }, async updateShare() { return { success: false } }, async getSharedCalendars() { return { calendars: [] } },
  async getYearSettings() { return { settings: (await read()).yearSettings } },
  async updateYearSettings(data: VacayYearSettingsRequest) { const value = await read(); value.yearSettings = { ...value.yearSettings, ...data }; await write(value); return { settings: value.yearSettings } },
}
