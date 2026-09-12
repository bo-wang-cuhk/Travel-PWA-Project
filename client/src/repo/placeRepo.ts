import { offlineDb } from '../db/offlineDb'
import type { LocalAssignmentRecord } from '../domain/assignmentSyncModel'
import type { LocalPlaceRecord, StoredPlaceRecord } from '../domain/placeSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { Place } from '../types'
import { randomId } from '../utils/randomId'

async function nextLocalPlaceId(): Promise<number> {
  const first = await offlineDb.places.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

function asLocalPlace(place: StoredPlaceRecord, tripSyncId: string): LocalPlaceRecord {
  const now = new Date().toISOString()
  return {
    ...place,
    sync_id: place.sync_id || randomId(),
    trip_sync_id: place.trip_sync_id || tripSyncId,
    created_at: place.created_at || now,
    updated_at: place.updated_at || place.created_at || now,
    deleted_at: place.deleted_at ?? null,
  }
}

async function activePlaces(tripId: number): Promise<LocalPlaceRecord[]> {
  const rows = await offlineDb.places.where('trip_id').equals(tripId).toArray()
  return rows.filter(place => !place.deleted_at) as LocalPlaceRecord[]
}

export const placeRepo = {
  async list(tripId: number | string, _params?: Record<string, unknown>): Promise<{ places: Place[] }> {
    return { places: await activePlaces(Number(tripId)) }
  },

  async get(placeId: number | string): Promise<{ place: LocalPlaceRecord }> {
    const place = await offlineDb.places.get(Number(placeId))
    if (!place || place.deleted_at) throw new Error('Place not found in local database')
    return { place: place as LocalPlaceRecord }
  },

  async create(tripId: number | string, data: Record<string, unknown> & { name: string }): Promise<{ place: LocalPlaceRecord }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.places, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const trip = await offlineDb.trips.get(localTripId)
      if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
      const now = new Date().toISOString()
      const place: LocalPlaceRecord = {
        ...(data as Partial<Place>),
        id: await nextLocalPlaceId(),
        sync_id: randomId(),
        trip_id: localTripId,
        trip_sync_id: trip.sync_id,
        name: data.name,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }
      await offlineDb.places.add(place)
      await markLocalChange('place', place.sync_id, 'upsert')
      return { place }
    })
  },

  async update(tripId: number | string, id: number | string, data: Record<string, unknown>): Promise<{ place: LocalPlaceRecord }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.places, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const [trip, stored] = await Promise.all([offlineDb.trips.get(localTripId), offlineDb.places.get(Number(id))])
      if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
      if (!stored || stored.deleted_at || stored.trip_id !== localTripId) throw new Error('Place not found in local database')
      const place = { ...asLocalPlace(stored, trip.sync_id), ...(data as Partial<Place>), updated_at: new Date().toISOString() }
      await offlineDb.places.put(place)
      await markLocalChange('place', place.sync_id, 'upsert')
      return { place }
    })
  },

  async delete(tripId: number | string, id: number | string): Promise<{ success: true }> {
    const localTripId = Number(tripId)
    await offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.places, offlineDb.assignments, offlineDb.accommodations, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta],
      async () => {
        const [trip, stored] = await Promise.all([offlineDb.trips.get(localTripId), offlineDb.places.get(Number(id))])
        if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
        if (!stored || stored.deleted_at || stored.trip_id !== localTripId) throw new Error('Place not found in local database')
        const now = new Date().toISOString()
        const place = { ...asLocalPlace(stored, trip.sync_id), deleted_at: now, updated_at: now }
        await offlineDb.places.put(place)
        await markLocalChange('place', place.sync_id, 'delete')

        const linked = await offlineDb.assignments.where('place_id').equals(place.id).toArray() as LocalAssignmentRecord[]
        const affectedDays = new Set<number>()
        for (const assignment of linked.filter(item => !item.deleted_at)) {
          affectedDays.add(assignment.day_id)
          const deleted = { ...assignment, deleted_at: now, updated_at: now }
          await offlineDb.assignments.put(deleted)
          await markLocalChange('assignment', deleted.sync_id, 'delete')
        }
        for (const dayId of affectedDays) {
          const remaining = (await offlineDb.assignments.where('day_id').equals(dayId).toArray())
            .filter(item => !item.deleted_at)
            .sort((a, b) => a.order_index - b.order_index) as LocalAssignmentRecord[]
          for (let index = 0; index < remaining.length; index++) {
            if (remaining[index].order_index === index) continue
            const changed = { ...remaining[index], order_index: index, updated_at: now }
            await offlineDb.assignments.put(changed)
            await markLocalChange('assignment', changed.sync_id, 'upsert')
          }
        }
        const stays = await offlineDb.accommodations.where('place_sync_id').equals(place.sync_id).toArray()
        for (const stay of stays.filter(item => !item.deleted_at)) {
          await offlineDb.accommodations.put({ ...stay, deleted_at: now, updated_at: now })
          if (stay.sync_id) await markLocalChange('accommodation', stay.sync_id, 'delete')
        }
        const reservations = await offlineDb.reservations.where('trip_id').equals(localTripId).toArray()
        for (const reservation of reservations.filter(item => !item.deleted_at && (item.place_id === place.id || stays.some(stay => stay.id === Number(item.accommodation_id))))) {
          const linkedStay = stays.some(stay => stay.id === Number(reservation.accommodation_id))
          const changed = { ...reservation,
            ...(reservation.place_id === place.id ? { place_id: null, place_sync_id: null } : {}),
            ...(linkedStay ? { accommodation_id: null, accommodation_sync_id: null } : {}), updated_at: now }
          await offlineDb.reservations.put(changed)
          if (changed.sync_id) await markLocalChange('reservation', changed.sync_id, 'upsert')
        }
      },
    )
    return { success: true }
  },

  async deleteMany(tripId: number | string, ids: number[]): Promise<{ deleted: number[]; count: number }> {
    for (const id of ids) await this.delete(tripId, id)
    return { deleted: ids, count: ids.length }
  },

  async updateMany(tripId: number | string, ids: number[], data: Record<string, unknown>): Promise<{ updated: number[]; count: number }> {
    for (const id of ids) await this.update(tripId, id, data)
    return { updated: ids, count: ids.length }
  },
}
