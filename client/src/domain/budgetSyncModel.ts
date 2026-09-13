import type { BudgetItem, BudgetItemMember } from '../types'
import type { BudgetItemPayer } from '@trek/shared'

export interface LocalBudgetItemRecord extends BudgetItem {
  sync_id: string
  trip_sync_id: string
  reservation_sync_id: string | null
  place_sync_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type StoredBudgetItemRecord = BudgetItem & Partial<Omit<LocalBudgetItemRecord, keyof BudgetItem>>

export interface SyncedBudgetMember {
  userId: number
  username: string
  paid: number
  amount: number | null
}

export interface SyncedBudgetPayer {
  userId: number
  username: string | null
  amount: number
}

export interface SyncedBudgetItem {
  schemaVersion: 1
  id: string
  tripId: string
  reservationId: string | null
  placeId: string | null
  category: string
  name: string
  totalPrice: number
  currency: string | null
  exchangeRate: number
  persons: number | null
  days: number | null
  note: string | null
  ticketJson: string | null
  expenseDate: string | null
  sortOrder: number
  paidByUserId: number | null
  members: SyncedBudgetMember[]
  payers: SyncedBudgetPayer[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function member(value: BudgetItemMember): SyncedBudgetMember {
  return { userId: value.user_id, username: value.username, paid: Number(value.paid) ? 1 : 0, amount: value.amount ?? null }
}

function payer(value: BudgetItemPayer): SyncedBudgetPayer {
  return { userId: value.user_id, username: value.username ?? null, amount: value.amount }
}

export function toSyncedBudgetItem(value: LocalBudgetItemRecord): SyncedBudgetItem {
  return {
    schemaVersion: 1, id: value.sync_id, tripId: value.trip_sync_id,
    reservationId: value.reservation_sync_id, placeId: value.place_sync_id,
    category: value.category || 'other', name: value.name, totalPrice: value.total_price,
    currency: value.currency ?? null, exchangeRate: value.exchange_rate ?? 1,
    persons: value.persons ?? null, days: value.days ?? null, note: value.note ?? null,
    ticketJson: value.ticket_json ?? null, expenseDate: value.expense_date ?? null,
    sortOrder: value.sort_order ?? 0, paidByUserId: value.paid_by_user_id ?? null,
    members: (value.members ?? []).map(member),
    payers: (value.payers ?? []).map(payer), createdAt: value.created_at,
    updatedAt: value.updated_at, deletedAt: value.deleted_at,
  }
}

export function applySyncedBudgetItem(
  remote: SyncedBudgetItem, localId: number, tripId: number,
  reservationId: number | null, placeId: number | null,
): LocalBudgetItemRecord {
  return {
    id: localId, sync_id: remote.id, trip_id: tripId, trip_sync_id: remote.tripId,
    reservation_id: reservationId, reservation_sync_id: remote.reservationId,
    place_id: placeId, place_sync_id: remote.placeId,
    category: remote.category, name: remote.name, total_price: remote.totalPrice,
    currency: remote.currency, exchange_rate: remote.exchangeRate, persons: remote.persons,
    days: remote.days, note: remote.note, ticket_json: remote.ticketJson,
    expense_date: remote.expenseDate, sort_order: remote.sortOrder,
    paid_by_user_id: remote.paidByUserId,
    members: remote.members.map(value => ({ user_id: value.userId, username: value.username, paid: value.paid, amount: value.amount })),
    payers: remote.payers.map(value => ({ user_id: value.userId, username: value.username ?? undefined, amount: value.amount })),
    created_at: remote.createdAt, updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}
