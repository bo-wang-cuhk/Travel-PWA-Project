import { offlineDb } from '../db/offlineDb'
import type { LocalAccommodationRecord } from '../domain/accommodationSyncModel'
import type { LocalDayRecord } from '../domain/daySyncModel'
import type { LocalPlaceRecord } from '../domain/placeSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { Accommodation } from '../types'
import { randomId } from '../utils/randomId'

async function nextId(): Promise<number> {
  const first = await offlineDb.accommodations.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

async function project(row: LocalAccommodationRecord): Promise<Accommodation> {
  const [place, reservation] = await Promise.all([
    row.place_id == null ? undefined : offlineDb.places.get(row.place_id),
    offlineDb.reservations.where('accommodation_id').equals(row.id).first(),
  ])
  return { ...row, place_name: place?.name ?? null, place_address: place?.address ?? null,
    place_image: place?.image_url ?? null, place_lat: place?.lat ?? null, place_lng: place?.lng ?? null,
    reservation_title: reservation?.title ?? null }
}

export const accommodationRepo = {
  async list(tripId: number | string): Promise<{ accommodations: Accommodation[] }> {
    const rows = await offlineDb.accommodations.where('trip_id').equals(Number(tripId)).toArray() as LocalAccommodationRecord[]
    return { accommodations: await Promise.all(rows.filter(row => !row.deleted_at).map(project)) }
  },

  async create(tripId: number | string, data: Record<string, unknown>): Promise<{ accommodation: Accommodation }> {
    const tripLocalId = Number(tripId), placeId = Number(data.place_id), startId = Number(data.start_day_id), endId = Number(data.end_day_id)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.places, offlineDb.accommodations, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const [trip, place, start, end] = await Promise.all([
        offlineDb.trips.get(tripLocalId), offlineDb.places.get(placeId) as Promise<LocalPlaceRecord | undefined>,
        offlineDb.days.get(startId) as Promise<LocalDayRecord | undefined>, offlineDb.days.get(endId) as Promise<LocalDayRecord | undefined>,
      ])
      if (!trip?.sync_id || trip.deleted_at) throw new Error('Trip not found in local database')
      if (!place?.sync_id || place.deleted_at || place.trip_id !== tripLocalId) throw new Error('Place not found in local database')
      if (!start?.sync_id || !end?.sync_id || start.deleted_at || end.deleted_at || start.trip_id !== tripLocalId || end.trip_id !== tripLocalId) throw new Error('Accommodation Day relation is unavailable')
      const now = new Date().toISOString()
      const row: LocalAccommodationRecord = {
        id: await nextId(), sync_id: randomId(), trip_id: tripLocalId, trip_sync_id: trip.sync_id,
        place_id: placeId, place_sync_id: place.sync_id, start_day_id: startId, start_day_sync_id: start.sync_id,
        end_day_id: endId, end_day_sync_id: end.sync_id,
        check_in: data.check_in as string | null | undefined, check_in_end: data.check_in_end as string | null | undefined,
        check_out: data.check_out as string | null | undefined, confirmation: data.confirmation as string | null | undefined,
        notes: data.notes as string | null | undefined, created_at: now, updated_at: now, deleted_at: null,
      }
      await offlineDb.accommodations.add(row); await markLocalChange('accommodation', row.sync_id, 'upsert')
      return { accommodation: await project(row) }
    })
  },

  async update(tripId: number | string, id: number, data: Record<string, unknown>): Promise<{ accommodation: Accommodation }> {
    const tripLocalId = Number(tripId)
    return offlineDb.transaction('rw', [offlineDb.days, offlineDb.places, offlineDb.accommodations, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const old = await offlineDb.accommodations.get(id) as LocalAccommodationRecord | undefined
      if (!old || old.deleted_at || old.trip_id !== tripLocalId) throw new Error('Accommodation not found in local database')
      const placeId = data.place_id == null ? old.place_id : Number(data.place_id), startId = data.start_day_id == null ? old.start_day_id : Number(data.start_day_id), endId = data.end_day_id == null ? old.end_day_id : Number(data.end_day_id)
      const [place, start, end] = await Promise.all([offlineDb.places.get(placeId!), offlineDb.days.get(startId), offlineDb.days.get(endId)])
      if (!place?.sync_id || place.deleted_at || place.trip_id !== tripLocalId || !start?.sync_id || start.deleted_at || start.trip_id !== tripLocalId || !end?.sync_id || end.deleted_at || end.trip_id !== tripLocalId) throw new Error('Accommodation relation is unavailable')
      const row: LocalAccommodationRecord = { ...old, ...(data as Partial<Accommodation>), place_id: placeId, place_sync_id: place.sync_id,
        start_day_id: startId, start_day_sync_id: start.sync_id, end_day_id: endId, end_day_sync_id: end.sync_id,
        updated_at: new Date().toISOString() }
      await offlineDb.accommodations.put(row); await markLocalChange('accommodation', row.sync_id, 'upsert')
      return { accommodation: await project(row) }
    })
  },

  async delete(tripId: number | string, id: number): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.accommodations, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const row = await offlineDb.accommodations.get(id) as LocalAccommodationRecord | undefined
      if (!row || row.deleted_at || row.trip_id !== Number(tripId)) throw new Error('Accommodation not found in local database')
      const now = new Date().toISOString(); await offlineDb.accommodations.put({ ...row, deleted_at: now, updated_at: now })
      await markLocalChange('accommodation', row.sync_id, 'delete')
      const linked = await offlineDb.reservations.where('accommodation_id').equals(id).toArray()
      for (const reservation of linked) {
        await offlineDb.reservations.put({ ...reservation, accommodation_id: null, accommodation_sync_id: null, updated_at: now })
        if (reservation.sync_id) await markLocalChange('reservation', reservation.sync_id, 'upsert')
      }
    })
  },
}
