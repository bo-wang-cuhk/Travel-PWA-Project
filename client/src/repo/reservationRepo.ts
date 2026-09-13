import { offlineDb } from '../db/offlineDb'
import type { LocalAccommodationRecord } from '../domain/accommodationSyncModel'
import type { LocalReservationRecord } from '../domain/reservationSyncModel'
import type { LocalBudgetItemRecord } from '../domain/budgetSyncModel'
import { accommodationRepo } from './accommodationRepo'
import { budgetRepo } from './budgetRepo'
import { markLocalChange } from '../sync/localChangeRepository'
import type { Reservation } from '../types'
import { randomId } from '../utils/randomId'

async function nextId(): Promise<number> { const first = await offlineDb.reservations.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function relations(tripId: number, data: Partial<Reservation>, old?: LocalReservationRecord) {
  const dayId = data.day_id === undefined ? old?.day_id ?? null : data.day_id ?? null
  const endDayId = data.end_day_id === undefined ? old?.end_day_id ?? null : data.end_day_id ?? null
  const placeId = data.place_id === undefined ? old?.place_id ?? null : data.place_id ?? null
  const assignmentId = data.assignment_id === undefined ? old?.assignment_id ?? null : data.assignment_id ?? null
  const accommodationId = data.accommodation_id === undefined
    ? old?.accommodation_id == null ? null : Number(old.accommodation_id)
    : data.accommodation_id == null ? null : Number(data.accommodation_id)
  const [day, endDay, place, assignment, accommodation] = await Promise.all([
    dayId == null ? undefined : offlineDb.days.get(dayId), endDayId == null ? undefined : offlineDb.days.get(endDayId),
    placeId == null ? undefined : offlineDb.places.get(placeId), assignmentId == null ? undefined : offlineDb.assignments.get(assignmentId),
    accommodationId == null ? undefined : offlineDb.accommodations.get(accommodationId),
  ])
  if ((dayId != null && (!day?.sync_id || day.deleted_at || day.trip_id !== tripId))
    || (endDayId != null && (!endDay?.sync_id || endDay.deleted_at || endDay.trip_id !== tripId))
    || (placeId != null && (!place?.sync_id || place.deleted_at || place.trip_id !== tripId))
    || (assignmentId != null && (!assignment?.sync_id || assignment.deleted_at || assignment.trip_id !== tripId))
    || (accommodationId != null && (!accommodation?.sync_id || accommodation.deleted_at || accommodation.trip_id !== tripId))) {
    throw new Error('Reservation relation is unavailable')
  }
  return { dayId, endDayId, placeId, assignmentId, accommodationId, daySyncId: day?.sync_id ?? null,
    endDaySyncId: endDay?.sync_id ?? null, placeSyncId: place?.sync_id ?? null,
    assignmentSyncId: assignment?.sync_id ?? null, accommodationSyncId: accommodation?.sync_id ?? null }
}

export const reservationRepo = {
  async list(tripId: number | string): Promise<{ reservations: Reservation[] }> {
    const rows = await offlineDb.reservations.where('trip_id').equals(Number(tripId)).toArray()
    return { reservations: rows.filter(row => !row.deleted_at) as LocalReservationRecord[] }
  },
  async create(tripId: number | string, data: Partial<Reservation> & { title: string }): Promise<{ reservation: Reservation }> {
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.places, offlineDb.assignments, offlineDb.accommodations, offlineDb.reservations, offlineDb.budgetItems, offlineDb.tripMembers, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const tripLocalId = Number(tripId), trip = await offlineDb.trips.get(tripLocalId)
      if (!trip?.sync_id || trip.deleted_at) throw new Error('Trip not found in local database')
      let refs = await relations(tripLocalId, data); const now = new Date().toISOString()
      const createAccommodation = (data as Record<string, unknown>).create_accommodation as Record<string, unknown> | undefined
      if (createAccommodation?.place_id) {
        const created = await accommodationRepo.create(tripId, createAccommodation)
        refs = { ...refs, accommodationId: created.accommodation.id,
          accommodationSyncId: (await offlineDb.accommodations.get(created.accommodation.id))?.sync_id ?? null }
      }
      const rawMetadata = (data as Record<string, unknown>).metadata
      const row: LocalReservationRecord = {
        ...(data as Reservation), id: await nextId(), sync_id: randomId(), trip_id: tripLocalId, trip_sync_id: trip.sync_id,
        day_id: refs.dayId, day_sync_id: refs.daySyncId, end_day_id: refs.endDayId, end_day_sync_id: refs.endDaySyncId,
        place_id: refs.placeId, place_sync_id: refs.placeSyncId, assignment_id: refs.assignmentId, assignment_sync_id: refs.assignmentSyncId,
        accommodation_id: refs.accommodationId, accommodation_sync_id: refs.accommodationSyncId,
        metadata: rawMetadata == null ? null : typeof rawMetadata === 'string' ? rawMetadata : JSON.stringify(rawMetadata),
        status: data.status ?? 'pending', type: data.type ?? 'other', created_at: now, updated_at: now, deleted_at: null,
      }
      const createBudget = (data as Record<string, unknown>).create_budget_entry
      delete (row as unknown as Record<string, unknown>).create_accommodation; delete (row as unknown as Record<string, unknown>).create_budget_entry
      await offlineDb.reservations.add(row); await markLocalChange('reservation', row.sync_id, 'upsert')
      if (createBudget && typeof createBudget === 'object') {
        const values = createBudget as { total_price?: number; category?: string }
        await budgetRepo.create(tripId, { name: row.title, reservation_id: row.id,
          total_price: values.total_price ?? 0, category: values.category ?? 'other' })
      }
      return { reservation: row }
    })
  },
  async update(tripId: number | string, id: number, data: Partial<Reservation>): Promise<{ reservation: Reservation }> {
    const old = await offlineDb.reservations.get(id) as LocalReservationRecord | undefined
    if (!old || old.deleted_at || old.trip_id !== Number(tripId)) throw new Error('Reservation not found in local database')
    const refs = await relations(Number(tripId), data, old)
    const rawMetadata = (data as Record<string, unknown>).metadata
    const row: LocalReservationRecord = { ...old, ...data, day_id: refs.dayId, day_sync_id: refs.daySyncId,
      end_day_id: refs.endDayId, end_day_sync_id: refs.endDaySyncId, place_id: refs.placeId, place_sync_id: refs.placeSyncId,
      assignment_id: refs.assignmentId, assignment_sync_id: refs.assignmentSyncId,
      accommodation_id: refs.accommodationId, accommodation_sync_id: refs.accommodationSyncId,
      ...(rawMetadata === undefined ? {} : { metadata: rawMetadata == null ? null : typeof rawMetadata === 'string' ? rawMetadata : JSON.stringify(rawMetadata) }),
      updated_at: new Date().toISOString() }
    await offlineDb.transaction('rw', [offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => { await offlineDb.reservations.put(row); await markLocalChange('reservation', row.sync_id, 'upsert') })
    return { reservation: row }
  },
  async delete(tripId: number | string, id: number): Promise<void> {
    const row = await offlineDb.reservations.get(id) as LocalReservationRecord | undefined
    if (!row || row.deleted_at || row.trip_id !== Number(tripId)) throw new Error('Reservation not found in local database')
    const now = new Date().toISOString()
    await offlineDb.transaction('rw', [offlineDb.accommodations, offlineDb.reservations, offlineDb.budgetItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      await offlineDb.reservations.put({ ...row, deleted_at: now, updated_at: now })
      await markLocalChange('reservation', row.sync_id, 'delete')
      const budgetRows = await offlineDb.budgetItems.where('trip_id').equals(row.trip_id).toArray() as LocalBudgetItemRecord[]
      for (const budget of budgetRows.filter(item => !item.deleted_at && item.reservation_id === row.id)) {
        await offlineDb.budgetItems.put({ ...budget, deleted_at: now, updated_at: now })
        await markLocalChange('budgetItem', budget.sync_id, 'delete')
      }
      if (row.accommodation_id != null) {
        const accommodation = await offlineDb.accommodations.get(Number(row.accommodation_id)) as LocalAccommodationRecord | undefined
        if (accommodation && !accommodation.deleted_at && accommodation.trip_id === row.trip_id) {
          await offlineDb.accommodations.put({ ...accommodation, deleted_at: now, updated_at: now })
          await markLocalChange('accommodation', accommodation.sync_id, 'delete')
        }
      }
    })
  },
  async updatePositions(tripId: number | string, positions: { id: number; day_plan_position: number }[], dayId?: number): Promise<void> {
    for (const position of positions) {
      const row = await offlineDb.reservations.get(position.id) as LocalReservationRecord | undefined
      if (!row || row.deleted_at || row.trip_id !== Number(tripId)) continue
      const dayPositions = dayId == null ? row.day_positions : { ...(row.day_positions ?? {}), [dayId]: position.day_plan_position }
      await this.update(tripId, row.id, { day_plan_position: position.day_plan_position, day_positions: dayPositions })
    }
  },
}
