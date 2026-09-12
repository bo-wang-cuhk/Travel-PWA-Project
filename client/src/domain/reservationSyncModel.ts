import type { Reservation, ReservationEndpoint } from '../types'

export interface LocalReservationRecord extends Reservation {
  sync_id: string
  trip_sync_id: string
  day_sync_id: string | null
  end_day_sync_id: string | null
  place_sync_id: string | null
  assignment_sync_id: string | null
  accommodation_sync_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type StoredReservationRecord = Reservation & Partial<Omit<LocalReservationRecord, keyof Reservation>>

export interface SyncedReservation {
  schemaVersion: 1
  id: string
  tripId: string
  dayId: string | null
  endDayId: string | null
  placeId: string | null
  assignmentId: string | null
  accommodationId: string | null
  title: string
  reservationTime: string | null
  reservationEndTime: string | null
  location: string | null
  confirmationNumber: string | null
  notes: string | null
  url: string | null
  status: string
  type: string
  metadata: unknown
  needsReview: number
  ingestState: string | null
  dayPlanPosition: number | null
  dayPositions: Record<string, number> | null
  endpoints: ReservationEndpoint[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function parsedMetadata(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  try { return JSON.parse(value) } catch { return value }
}

function mapMetadata(value: unknown, resolveDay: (value: string | number) => string | number | undefined): unknown {
  if (Array.isArray(value)) return value.map(item => mapMetadata(item, resolveDay))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'dep_day_id' || key === 'arr_day_id') && (typeof item === 'number' || typeof item === 'string')) {
      result[key] = resolveDay(item) ?? null
    } else if (key === 'day_positions' && item && typeof item === 'object' && !Array.isArray(item)) {
      result[key] = Object.fromEntries(Object.entries(item as Record<string, unknown>).flatMap(([id, position]) => {
        const mapped = resolveDay(id); return mapped == null ? [] : [[String(mapped), position]]
      }))
    } else result[key] = mapMetadata(item, resolveDay)
  }
  return result
}

export function toSyncedReservation(value: LocalReservationRecord, daySyncIds: Map<number, string>): SyncedReservation {
  const dayPositions = value.day_positions
    ? Object.fromEntries(Object.entries(value.day_positions).flatMap(([id, position]) => {
        const syncId = daySyncIds.get(Number(id)); return syncId ? [[syncId, position]] : []
      }))
    : null
  return {
    schemaVersion: 1, id: value.sync_id, tripId: value.trip_sync_id,
    dayId: value.day_sync_id, endDayId: value.end_day_sync_id, placeId: value.place_sync_id,
    assignmentId: value.assignment_sync_id, accommodationId: value.accommodation_sync_id,
    title: value.title, reservationTime: value.reservation_time ?? null,
    reservationEndTime: value.reservation_end_time ?? null, location: value.location ?? null,
    confirmationNumber: value.confirmation_number ?? null, notes: value.notes ?? null, url: value.url ?? null,
    status: value.status, type: value.type,
    metadata: mapMetadata(parsedMetadata(value.metadata), id => daySyncIds.get(Number(id))),
    needsReview: value.needs_review ?? 0, ingestState: value.ingest_state ?? null,
    dayPlanPosition: value.day_plan_position ?? null, dayPositions,
    endpoints: value.endpoints ?? [], createdAt: value.created_at, updatedAt: value.updated_at, deletedAt: value.deleted_at,
  }
}

export function applySyncedReservation(
  remote: SyncedReservation, localId: number, relations: {
    tripId: number; dayId: number | null; endDayId: number | null; placeId: number | null;
    assignmentId: number | null; accommodationId: number | null; dayIds: Map<string, number>
  },
): LocalReservationRecord {
  const dayPositions = remote.dayPositions
    ? Object.fromEntries(Object.entries(remote.dayPositions).flatMap(([id, position]) => {
        const local = relations.dayIds.get(id); return local == null ? [] : [[String(local), position]]
      }))
    : null
  return {
    id: localId, sync_id: remote.id, trip_id: relations.tripId, trip_sync_id: remote.tripId,
    day_id: relations.dayId, day_sync_id: remote.dayId, end_day_id: relations.endDayId, end_day_sync_id: remote.endDayId,
    place_id: relations.placeId, place_sync_id: remote.placeId,
    assignment_id: relations.assignmentId, assignment_sync_id: remote.assignmentId,
    accommodation_id: relations.accommodationId, accommodation_sync_id: remote.accommodationId,
    title: remote.title, reservation_time: remote.reservationTime, reservation_end_time: remote.reservationEndTime,
    location: remote.location, confirmation_number: remote.confirmationNumber, notes: remote.notes, url: remote.url,
    status: remote.status, type: remote.type,
    metadata: remote.metadata == null ? null : JSON.stringify(mapMetadata(remote.metadata, id => relations.dayIds.get(String(id)))), needs_review: remote.needsReview,
    ingest_state: remote.ingestState ?? undefined, day_plan_position: remote.dayPlanPosition,
    day_positions: dayPositions, endpoints: remote.endpoints,
    created_at: remote.createdAt, updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
  }
}
