import type { Place } from '../types'

/** Local-first Place row. Numeric ids remain UI compatibility keys only. */
export interface LocalPlaceRecord extends Place {
  sync_id: string
  trip_sync_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type StoredPlaceRecord = Place & Partial<Pick<LocalPlaceRecord,
  'sync_id' | 'trip_sync_id' | 'created_at' | 'updated_at' | 'deleted_at'
>>

/** Provider-neutral Place document. Server/account projections are omitted. */
export interface SyncedPlace {
  schemaVersion: 1
  id: string
  tripId: string
  name: string
  description: string | null
  lat: number | null
  lng: number | null
  address: string | null
  price: number | null
  currency: string | null
  reservationStatus: string | null
  reservationNotes: string | null
  reservationDatetime: string | null
  placeTime: string | null
  endTime: string | null
  durationMinutes: number | null
  notes: string | null
  imageUrl: string | null
  googlePlaceId: string | null
  googleFtid: string | null
  osmId: string | null
  source?: string | null
  externalPlaceId?: string | null
  routeGeometry: string | null
  routeColor: string | null
  website: string | null
  phone: string | null
  transportMode: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedPlace(place: LocalPlaceRecord): SyncedPlace {
  return {
    schemaVersion: 1,
    id: place.sync_id,
    tripId: place.trip_sync_id,
    name: place.name,
    description: place.description ?? null,
    lat: place.lat ?? null,
    lng: place.lng ?? null,
    address: place.address ?? null,
    price: place.price ?? null,
    currency: place.currency ?? null,
    reservationStatus: place.reservation_status ?? null,
    reservationNotes: place.reservation_notes ?? null,
    reservationDatetime: place.reservation_datetime ?? null,
    placeTime: place.place_time ?? null,
    endTime: place.end_time ?? null,
    durationMinutes: place.duration_minutes ?? null,
    notes: place.notes ?? null,
    imageUrl: place.image_url ?? null,
    googlePlaceId: place.google_place_id ?? null,
    googleFtid: place.google_ftid ?? null,
    osmId: place.osm_id ?? null,
    source: place.source ?? null,
    externalPlaceId: place.external_place_id ?? null,
    routeGeometry: place.route_geometry ?? null,
    routeColor: place.route_color ?? null,
    website: place.website ?? null,
    phone: place.phone ?? null,
    transportMode: place.transport_mode ?? null,
    createdAt: place.created_at,
    updatedAt: place.updated_at,
    deletedAt: place.deleted_at,
  }
}

export function applySyncedPlace(remote: SyncedPlace, localId: number, tripId: number): LocalPlaceRecord {
  return {
    id: localId,
    sync_id: remote.id,
    trip_id: tripId,
    trip_sync_id: remote.tripId,
    name: remote.name,
    description: remote.description,
    lat: remote.lat,
    lng: remote.lng,
    address: remote.address,
    category_id: null,
    price: remote.price,
    currency: remote.currency,
    reservation_status: remote.reservationStatus,
    reservation_notes: remote.reservationNotes,
    reservation_datetime: remote.reservationDatetime,
    place_time: remote.placeTime,
    end_time: remote.endTime,
    duration_minutes: remote.durationMinutes,
    notes: remote.notes,
    image_url: remote.imageUrl,
    google_place_id: remote.googlePlaceId,
    google_ftid: remote.googleFtid,
    osm_id: remote.osmId,
    source: remote.source ?? null,
    external_place_id: remote.externalPlaceId ?? null,
    route_geometry: remote.routeGeometry,
    route_color: remote.routeColor,
    website: remote.website,
    phone: remote.phone,
    transport_mode: remote.transportMode,
    created_at: remote.createdAt,
    updated_at: remote.updatedAt,
    deleted_at: remote.deletedAt,
  }
}
