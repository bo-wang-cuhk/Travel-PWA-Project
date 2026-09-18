import { offlineDb } from '../db/offlineDb'
import type { LocalTripFileRecord } from '../domain/tripFileSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { TripFile } from '../types'
import { randomId } from '../utils/randomId'

const liveObjectUrls = new Map<string, string>()

async function nextLocalId(): Promise<number> {
  const first = await offlineDb.tripFiles.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

async function displayFile(row: LocalTripFileRecord): Promise<TripFile> {
  const body = await offlineDb.tripFileBlobs.get(row.sync_id)
  if (!body) return { ...row, url: '' }
  const cached = liveObjectUrls.get(row.sync_id)
  if (cached) return { ...row, url: cached }
  const url = URL.createObjectURL(body.blob.type ? body.blob : new Blob([body.blob], { type: body.mime }))
  liveObjectUrls.set(row.sync_id, url)
  return { ...row, url }
}

export async function resolveStoredFileUrl(value: string | null | undefined): Promise<string | null> {
  if (!value?.startsWith('trek-file:')) return value ?? null
  const syncId = value.slice('trek-file:'.length)
  const row = await offlineDb.tripFiles.where('sync_id').equals(syncId).first() as LocalTripFileRecord | undefined
  return row ? (await displayFile(row)).url || null : null
}

function formNumber(data: FormData, key: string): number | null {
  const raw = data.get(key)
  if (typeof raw !== 'string' || !raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export const fileRepo = {
  async list(tripId: number | string, trash = false): Promise<{ files: TripFile[] }> {
    const rows = (await offlineDb.tripFiles.where('trip_id').equals(Number(tripId)).toArray()) as LocalTripFileRecord[]
    const selected = rows.filter(row => trash ? Boolean(row.deleted_at) && !row.purged_at : !row.deleted_at)
    return { files: await Promise.all(selected.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(displayFile)) }
  },

  async create(tripId: number | string, data: FormData): Promise<{ file: TripFile }> {
    const body = data.get('file')
    if (!(body instanceof Blob)) throw new Error('No file selected')
    const trip = await offlineDb.trips.get(Number(tripId))
    if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
    const placeId = formNumber(data, 'place_id')
    const reservationId = formNumber(data, 'reservation_id')
    const [place, reservation] = await Promise.all([
      placeId == null ? undefined : offlineDb.places.get(placeId),
      reservationId == null ? undefined : offlineDb.reservations.get(reservationId),
    ])
    const id = await nextLocalId()
    const syncId = randomId()
    const now = new Date().toISOString()
    const originalName = body instanceof File && body.name ? body.name : 'attachment'
    const row: LocalTripFileRecord = {
      id, sync_id: syncId, trip_id: trip.id, trip_sync_id: trip.sync_id,
      place_id: placeId, place_sync_id: place?.sync_id ?? null,
      reservation_id: reservationId, reservation_sync_id: reservation?.sync_id ?? null,
      linked_place_ids: [], linked_place_sync_ids: [], linked_reservation_ids: [], linked_reservation_sync_ids: [],
      note_id: null, filename: `${syncId}-${originalName}`, original_name: originalName,
      file_size: body.size, mime_type: body.type || 'application/octet-stream',
      description: String(data.get('description') || '') || null, starred: 0,
      created_at: now, updated_at: now, deleted_at: null,
      purged_at: null,
      storage_path: `${trip.sync_id}/${syncId}/${encodeURIComponent(originalName.split('/').join('_'))}`, url: '',
    }
    await offlineDb.transaction('rw', [offlineDb.tripFiles, offlineDb.tripFileBlobs, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      await offlineDb.tripFiles.add(row)
      await offlineDb.tripFileBlobs.put({ syncId, blob: body, mime: row.mime_type, bytes: body.size, updatedAt: Date.now() })
      await markLocalChange('tripFile', syncId, 'upsert')
    })
    return { file: await displayFile(row) }
  },

  async saveTripCover(tripId: number | string, body: File): Promise<{ storedValue: string; displayUrl: string }> {
    const data = new FormData()
    data.append('file', body)
    data.append('description', '__trip_cover__')
    const file = (await this.create(tripId, data)).file as TripFile & { sync_id: string }
    return { storedValue: `trek-file:${file.sync_id}`, displayUrl: file.url }
  },

  async update(id: number, patch: Partial<TripFile>): Promise<TripFile> {
    return offlineDb.transaction('rw', [offlineDb.tripFiles, offlineDb.tripFileBlobs, offlineDb.places, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const current = await offlineDb.tripFiles.get(id) as LocalTripFileRecord | undefined
      if (!current) throw new Error('File not found')
      const [place, reservation] = await Promise.all([
        patch.place_id == null ? undefined : offlineDb.places.get(patch.place_id),
        patch.reservation_id == null ? undefined : offlineDb.reservations.get(patch.reservation_id),
      ])
      const linkedPlaceIds = (patch.linked_place_ids ?? current.linked_place_ids ?? []).filter((value): value is number => value != null)
      const linkedReservationIds = (patch.linked_reservation_ids ?? current.linked_reservation_ids ?? []).filter((value): value is number => value != null)
      const [linkedPlaces, linkedReservations] = await Promise.all([
        Promise.all(linkedPlaceIds.map(value => offlineDb.places.get(value))),
        Promise.all(linkedReservationIds.map(value => offlineDb.reservations.get(value))),
      ])
      const next: LocalTripFileRecord = {
        ...current, ...patch,
        place_sync_id: patch.place_id === undefined ? current.place_sync_id : place?.sync_id ?? null,
        reservation_sync_id: patch.reservation_id === undefined ? current.reservation_sync_id : reservation?.sync_id ?? null,
        linked_place_ids: linkedPlaceIds,
        linked_place_sync_ids: linkedPlaces.flatMap(value => value?.sync_id ? [value.sync_id] : []),
        linked_reservation_ids: linkedReservationIds,
        linked_reservation_sync_ids: linkedReservations.flatMap(value => value?.sync_id ? [value.sync_id] : []),
        updated_at: new Date().toISOString(),
      }
      await offlineDb.tripFiles.put(next)
      await markLocalChange('tripFile', next.sync_id, next.deleted_at ? 'delete' : 'upsert')
      return displayFile(next)
    })
  },

  async toggleStar(id: number): Promise<TripFile> {
    const current = await offlineDb.tripFiles.get(id)
    if (!current) throw new Error('File not found')
    return this.update(id, { starred: current.starred ? 0 : 1 })
  },

  async trash(id: number): Promise<void> { await this.update(id, { deleted_at: new Date().toISOString() }) },
  async restore(id: number): Promise<void> { await this.update(id, { deleted_at: null }) },
  async permanentDelete(id: number): Promise<void> {
    const current = await offlineDb.tripFiles.get(id)
    if (!current) return
    await this.update(id, { deleted_at: current.deleted_at || new Date().toISOString(), purged_at: new Date().toISOString() } as Partial<TripFile>)
  },

  async emptyTrash(tripId: number | string): Promise<void> {
    const rows = (await offlineDb.tripFiles.where('trip_id').equals(Number(tripId)).toArray()) as LocalTripFileRecord[]
    for (const row of rows.filter(item => item.deleted_at && !item.purged_at)) await this.permanentDelete(row.id)
  },
}
