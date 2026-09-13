import type { VacayEntry, VacayPlan, VacayStat, VacayUser, VacayYearSettings } from '../types'

export const VACAY_SYNC_ID = 'personal-vacay'

export interface LocalVacayRecord {
  id: string
  plan: VacayPlan
  users: VacayUser[]
  years: number[]
  entries: VacayEntry[]
  companyHolidays: Array<{ date: string; note?: string }>
  stats: VacayStat[]
  yearSettings: VacayYearSettings
  entryTombstones: Record<string, string>
  updated_at: string
  deleted_at: string | null
}

export interface SyncedVacay extends Omit<LocalVacayRecord, 'updated_at' | 'deleted_at'> {
  schemaVersion: 1
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedVacay(value: LocalVacayRecord): SyncedVacay {
  return { ...value, schemaVersion: 1, updatedAt: value.updated_at, deletedAt: value.deleted_at }
}

export function applySyncedVacay(remote: SyncedVacay): LocalVacayRecord {
  const { schemaVersion: _schemaVersion, updatedAt, deletedAt, ...value } = remote
  return { ...value, updated_at: updatedAt, deleted_at: deletedAt }
}
