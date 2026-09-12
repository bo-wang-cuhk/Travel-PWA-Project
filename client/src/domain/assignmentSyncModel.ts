import type { Assignment } from '../types'

/** Assignment relations use UUIDs for sync and numeric ids for the current UI. */
export interface LocalAssignmentRecord extends Omit<Assignment, 'place'> {
  trip_id: number
  sync_id: string
  trip_sync_id: string
  day_sync_id: string
  place_sync_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type StoredAssignmentRecord = Omit<Assignment, 'place'> & Partial<Pick<LocalAssignmentRecord,
  'trip_id' | 'sync_id' | 'trip_sync_id' | 'day_sync_id' | 'place_sync_id' |
  'created_at' | 'updated_at' | 'deleted_at'
>>

export interface SyncedAssignment {
  schemaVersion: 1
  id: string
  tripId: string
  dayId: string
  placeId: string
  orderIndex: number
  notes: string | null
  assignmentTime: string | null
  assignmentEndTime: string | null
  legTransportMode: string | null
  incomingLegTransportMode: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function toSyncedAssignment(value: LocalAssignmentRecord): SyncedAssignment {
  return {
    schemaVersion: 1,
    id: value.sync_id,
    tripId: value.trip_sync_id,
    dayId: value.day_sync_id,
    placeId: value.place_sync_id,
    orderIndex: value.order_index,
    notes: value.notes ?? null,
    assignmentTime: value.assignment_time ?? null,
    assignmentEndTime: value.assignment_end_time ?? null,
    legTransportMode: value.leg_transport_mode ?? null,
    incomingLegTransportMode: value.incoming_leg_transport_mode ?? null,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    deletedAt: value.deleted_at,
  }
}

export function applySyncedAssignment(
  remote: SyncedAssignment,
  localId: number,
  tripId: number,
  dayId: number,
  placeId: number,
): LocalAssignmentRecord {
  return {
    id: localId,
    sync_id: remote.id,
    trip_id: tripId,
    trip_sync_id: remote.tripId,
    day_id: dayId,
    day_sync_id: remote.dayId,
    place_id: placeId,
    place_sync_id: remote.placeId,
    order_index: remote.orderIndex,
    notes: remote.notes,
    assignment_time: remote.assignmentTime,
    assignment_end_time: remote.assignmentEndTime,
    leg_transport_mode: remote.legTransportMode,
    incoming_leg_transport_mode: remote.incomingLegTransportMode,
    created_at: remote.createdAt,
    updated_at: remote.updatedAt,
    deleted_at: remote.deletedAt,
  }
}
