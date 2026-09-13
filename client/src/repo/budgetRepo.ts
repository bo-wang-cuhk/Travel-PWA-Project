import type { BudgetCreateItemRequest, BudgetItemPayer, BudgetUpdateItemRequest } from '@trek/shared'
import { offlineDb } from '../db/offlineDb'
import type { LocalBudgetItemRecord } from '../domain/budgetSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { BudgetItem, BudgetItemMember } from '../types'
import { randomId } from '../utils/randomId'

async function nextId(): Promise<number> {
  const first = await offlineDb.budgetItems.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

function payerTotal(data: { payers?: { amount: number }[]; total_price?: number }): number {
  if (data.payers?.length) return Math.round(data.payers.reduce((sum, payer) => sum + payer.amount, 0) * 100) / 100
  return data.total_price ?? 0
}

async function resolveMembers(tripId: number, userIds: number[], existing: BudgetItemMember[] = []): Promise<BudgetItemMember[]> {
  const roster = await offlineDb.tripMembers.where('tripId').equals(tripId).toArray()
  const byId = new Map(roster.map(member => [member.id, member]))
  const old = new Map(existing.map(member => [member.user_id, member]))
  return userIds.flatMap(userId => {
    const rosterMember = byId.get(userId)
    const prior = old.get(userId)
    if (!rosterMember && !prior) return []
    return [{ user_id: userId, username: rosterMember?.username ?? prior!.username,
      avatar_url: rosterMember?.avatar_url ?? prior?.avatar_url ?? null,
      paid: prior?.paid ? 1 : 0, amount: prior?.amount ?? null }]
  })
}

async function resolvePayers(tripId: number, values: Array<{ user_id: number; amount: number }>, existing: BudgetItemPayer[] = []): Promise<BudgetItemPayer[]> {
  const roster = await offlineDb.tripMembers.where('tripId').equals(tripId).toArray()
  const names = new Map(roster.map(member => [member.id, member.username]))
  const old = new Map(existing.map(payer => [payer.user_id, payer]))
  return values.map(value => ({ ...value, username: names.get(value.user_id) ?? old.get(value.user_id)?.username }))
}

async function relations(tripId: number, data: { reservation_id?: number | null; place_id?: number | null }, old?: LocalBudgetItemRecord) {
  const reservationId = data.reservation_id === undefined ? old?.reservation_id ?? null : data.reservation_id ?? null
  const placeId = data.place_id === undefined ? old?.place_id ?? null : data.place_id ?? null
  const [reservation, place] = await Promise.all([
    reservationId == null ? undefined : offlineDb.reservations.get(reservationId),
    placeId == null ? undefined : offlineDb.places.get(placeId),
  ])
  if ((reservationId != null && (!reservation?.sync_id || reservation.deleted_at || reservation.trip_id !== tripId))
    || (placeId != null && (!place?.sync_id || place.deleted_at || place.trip_id !== tripId))) throw new Error('Budget item relation is unavailable')
  return { reservationId, reservationSyncId: reservation?.sync_id ?? null, placeId, placeSyncId: place?.sync_id ?? null }
}

async function mirrorReservationPrice(row: LocalBudgetItemRecord, remove = false): Promise<void> {
  if (row.reservation_id == null) return
  const reservation = await offlineDb.reservations.get(row.reservation_id)
  if (!reservation?.sync_id || reservation.deleted_at || reservation.trip_id !== row.trip_id) return
  const metadata: Record<string, unknown> = (() => {
    try { return reservation.metadata ? JSON.parse(String(reservation.metadata)) : {} } catch { return {} }
  })()
  if (remove) {
    delete metadata.price
    delete metadata.priceCurrency
  } else {
    metadata.price = String(Math.round(row.total_price * 100) / 100)
    if (row.currency) metadata.priceCurrency = row.currency
  }
  await offlineDb.reservations.put({ ...reservation, metadata: JSON.stringify(metadata), updated_at: new Date().toISOString() })
  await markLocalChange('reservation', reservation.sync_id, 'upsert')
}

export const budgetRepo = {
  async list(tripId: number | string): Promise<{ items: BudgetItem[] }> {
    const rows = await offlineDb.budgetItems.where('trip_id').equals(Number(tripId)).toArray()
    return { items: rows.filter(row => !row.deleted_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) as LocalBudgetItemRecord[] }
  },

  async create(tripId: number | string, data: BudgetCreateItemRequest): Promise<{ item: BudgetItem }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.places, offlineDb.reservations, offlineDb.budgetItems, offlineDb.tripMembers, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const trip = await offlineDb.trips.get(localTripId)
      if (!trip?.sync_id || trip.deleted_at) throw new Error('Trip not found in local database')
      const refs = await relations(localTripId, data)
      const active = (await offlineDb.budgetItems.where('trip_id').equals(localTripId).toArray()).filter(row => !row.deleted_at)
      const requestedMembers: Array<{ user_id: number; amount?: number }> = data.members ?? (data.member_ids ?? []).map(user_id => ({ user_id }))
      const members = await resolveMembers(localTripId, requestedMembers.map(member => member.user_id))
      const payers = await resolvePayers(localTripId, data.payers ?? [])
      const amounts = new Map(requestedMembers.map(member => [member.user_id, member.amount ?? null]))
      for (const member of members) member.amount = amounts.get(member.user_id) ?? null
      const now = new Date().toISOString()
      const row: LocalBudgetItemRecord = {
        id: await nextId(), sync_id: randomId(), trip_id: localTripId, trip_sync_id: trip.sync_id,
        reservation_id: refs.reservationId, reservation_sync_id: refs.reservationSyncId,
        place_id: refs.placeId, place_sync_id: refs.placeSyncId,
        category: data.category || 'other', name: data.name, total_price: payerTotal(data),
        currency: data.currency ?? null, exchange_rate: data.exchange_rate ?? 1,
        persons: members.length || data.persons || null, days: data.days ?? null,
        note: data.note ?? null, ticket_json: data.ticket_json ?? null,
        expense_date: data.expense_date ?? null, sort_order: active.length,
        paid_by_user_id: null, members,
        payers,
        created_at: now, updated_at: now, deleted_at: null,
      }
      await offlineDb.budgetItems.add(row)
      await markLocalChange('budgetItem', row.sync_id, 'upsert')
      return { item: row }
    })
  },

  async update(tripId: number | string, id: number, data: BudgetUpdateItemRequest): Promise<{ item: BudgetItem }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.places, offlineDb.reservations, offlineDb.budgetItems, offlineDb.tripMembers, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const old = await offlineDb.budgetItems.get(id) as LocalBudgetItemRecord | undefined
      if (!old || old.deleted_at || old.trip_id !== localTripId) throw new Error('Budget item not found in local database')
      const refs = await relations(localTripId, {}, old)
      let members = old.members ?? []
      const requestedMembers: Array<{ user_id: number; amount?: number }> | undefined = data.members ?? (data.member_ids ? data.member_ids.map(user_id => ({ user_id })) : undefined)
      if (requestedMembers) {
        members = await resolveMembers(localTripId, requestedMembers.map(member => member.user_id), members)
        const amounts = new Map(requestedMembers.map(member => [member.user_id, member.amount ?? null]))
        for (const member of members) member.amount = amounts.get(member.user_id) ?? null
      }
      const payers = data.payers === undefined ? old.payers ?? [] : await resolvePayers(localTripId, data.payers, old.payers ?? [])
      const totalPrice = data.payers !== undefined ? payerTotal(data) : data.total_price ?? old.total_price
      const row: LocalBudgetItemRecord = {
        ...old, ...data, reservation_id: refs.reservationId, reservation_sync_id: refs.reservationSyncId,
        place_id: refs.placeId, place_sync_id: refs.placeSyncId,
        members, payers, persons: requestedMembers ? members.length || null : data.persons ?? old.persons,
        total_price: totalPrice, updated_at: new Date().toISOString(),
      }
      delete (row as unknown as Record<string, unknown>).member_ids
      await offlineDb.budgetItems.put(row)
      await markLocalChange('budgetItem', row.sync_id, 'upsert')
      if ((data.total_price !== undefined || data.payers !== undefined) && row.reservation_id != null) await mirrorReservationPrice(row)
      return { item: row }
    })
  },

  async delete(tripId: number | string, id: number): Promise<void> {
    const localTripId = Number(tripId)
    await offlineDb.transaction('rw', [offlineDb.reservations, offlineDb.budgetItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const row = await offlineDb.budgetItems.get(id) as LocalBudgetItemRecord | undefined
      if (!row || row.deleted_at || row.trip_id !== localTripId) throw new Error('Budget item not found in local database')
      const now = new Date().toISOString()
      await offlineDb.budgetItems.put({ ...row, deleted_at: now, updated_at: now })
      await markLocalChange('budgetItem', row.sync_id, 'delete')
      await mirrorReservationPrice(row, true)
    })
  },

  async setMembers(tripId: number | string, id: number, userIds: number[]): Promise<{ members: BudgetItemMember[]; item: BudgetItem }> {
    const old = await offlineDb.budgetItems.get(id) as LocalBudgetItemRecord | undefined
    if (!old || old.deleted_at || old.trip_id !== Number(tripId)) throw new Error('Budget item not found in local database')
    const members = await resolveMembers(Number(tripId), userIds, old.members ?? [])
    const result = await this.update(tripId, id, { members: members.map(member => ({ user_id: member.user_id, amount: member.amount })) })
    return { members: result.item.members ?? [], item: result.item }
  },

  async togglePaid(tripId: number | string, id: number, userId: number, paid: boolean): Promise<{ item: BudgetItem }> {
    const old = await offlineDb.budgetItems.get(id) as LocalBudgetItemRecord | undefined
    if (!old || old.deleted_at || old.trip_id !== Number(tripId)) throw new Error('Budget item not found in local database')
    const row = { ...old, members: (old.members ?? []).map(member => member.user_id === userId ? { ...member, paid: paid ? 1 : 0 } : member), updated_at: new Date().toISOString() }
    await offlineDb.transaction('rw', [offlineDb.budgetItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      await offlineDb.budgetItems.put(row)
      await markLocalChange('budgetItem', row.sync_id, 'upsert')
    })
    return { item: row }
  },

  async reorderItems(tripId: number | string, orderedIds: number[]): Promise<{ items: BudgetItem[] }> {
    const localTripId = Number(tripId)
    const active = (await this.list(localTripId)).items as LocalBudgetItemRecord[]
    if (orderedIds.length !== active.length || new Set(orderedIds).size !== active.length || orderedIds.some(id => !active.some(row => row.id === id))) throw new Error('Budget reorder must contain every active item exactly once')
    const byId = new Map(active.map(row => [row.id, row]))
    await offlineDb.transaction('rw', [offlineDb.budgetItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const now = new Date().toISOString()
      for (let index = 0; index < orderedIds.length; index++) {
        const row = { ...byId.get(orderedIds[index])!, sort_order: index, updated_at: now }
        await offlineDb.budgetItems.put(row)
        await markLocalChange('budgetItem', row.sync_id, 'upsert')
      }
    })
    return this.list(localTripId)
  },

  async reorderCategories(tripId: number | string, orderedCategories: string[]): Promise<{ items: BudgetItem[] }> {
    const active = (await this.list(tripId)).items
    const rank = new Map(orderedCategories.map((category, index) => [category, index]))
    const ordered = [...active].sort((a, b) => (rank.get(a.category) ?? orderedCategories.length) - (rank.get(b.category) ?? orderedCategories.length) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return this.reorderItems(tripId, ordered.map(item => item.id))
  },
}
