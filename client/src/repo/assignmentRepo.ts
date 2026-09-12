import { offlineDb } from '../db/offlineDb'
import type { LocalAssignmentRecord, StoredAssignmentRecord } from '../domain/assignmentSyncModel'
import type { LocalDayRecord } from '../domain/daySyncModel'
import type { LocalPlaceRecord } from '../domain/placeSyncModel'
import { markLocalChange } from '../sync/localChangeRepository'
import type { Assignment, AssignmentsMap } from '../types'
import { randomId } from '../utils/randomId'

async function nextLocalAssignmentId(): Promise<number> {
  const first = await offlineDb.assignments.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

function asLocalAssignment(
  value: StoredAssignmentRecord,
  tripSyncId: string,
  daySyncId: string,
  placeSyncId: string,
): LocalAssignmentRecord {
  const now = new Date().toISOString()
  return {
    ...value,
    trip_id: value.trip_id!,
    sync_id: value.sync_id || randomId(),
    trip_sync_id: value.trip_sync_id || tripSyncId,
    day_sync_id: value.day_sync_id || daySyncId,
    place_sync_id: value.place_sync_id || placeSyncId,
    created_at: value.created_at || now,
    updated_at: value.updated_at || value.created_at || now,
    deleted_at: value.deleted_at ?? null,
  }
}

async function activeForDay(dayId: number): Promise<LocalAssignmentRecord[]> {
  const rows = await offlineDb.assignments.where('day_id').equals(dayId).toArray()
  return rows
    .filter(item => !item.deleted_at)
    .sort((a, b) => a.order_index - b.order_index) as LocalAssignmentRecord[]
}

async function withPlace(value: LocalAssignmentRecord): Promise<Assignment | null> {
  const place = await offlineDb.places.get(value.place_id) as LocalPlaceRecord | undefined
  if (!place || place.deleted_at) return null
  return {
    ...value,
    place: {
      ...place,
      place_time: value.assignment_time ?? place.place_time,
      end_time: value.assignment_end_time ?? place.end_time,
    },
  }
}

async function reindex(dayId: number, now: string): Promise<void> {
  const rows = await activeForDay(dayId)
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].order_index === index) continue
    const changed = { ...rows[index], order_index: index, updated_at: now }
    await offlineDb.assignments.put(changed)
    await markLocalChange('assignment', changed.sync_id, 'upsert')
  }
}

export const assignmentRepo = {
  async listByTrip(tripId: number | string): Promise<AssignmentsMap> {
    const rows = await offlineDb.assignments.where('trip_id').equals(Number(tripId)).toArray() as LocalAssignmentRecord[]
    const active = rows.filter(item => !item.deleted_at).sort((a, b) => a.order_index - b.order_index)
    const result: AssignmentsMap = {}
    for (const row of active) {
      const assignment = await withPlace(row)
      if (!assignment) continue
      const key = String(row.day_id)
      ;(result[key] ||= []).push(assignment)
    }
    return result
  },

  async listByDay(dayId: number | string): Promise<Assignment[]> {
    const result = await Promise.all((await activeForDay(Number(dayId))).map(withPlace))
    return result.filter((item): item is Assignment => item !== null)
  },

  async create(
    tripId: number | string,
    dayId: number | string,
    placeId: number | string,
    position?: number | null,
  ): Promise<{ assignment: Assignment }> {
    const localTripId = Number(tripId)
    const localDayId = Number(dayId)
    const localPlaceId = Number(placeId)
    return offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.days, offlineDb.places, offlineDb.assignments, offlineDb.syncOutbox, offlineDb.entitySyncMeta],
      async () => {
        const [trip, day, place] = await Promise.all([
          offlineDb.trips.get(localTripId),
          offlineDb.days.get(localDayId) as Promise<LocalDayRecord | undefined>,
          offlineDb.places.get(localPlaceId) as Promise<LocalPlaceRecord | undefined>,
        ])
        if (!trip || trip.deleted_at || !trip.sync_id) throw new Error('Trip not found in local database')
        if (!day || day.deleted_at || day.trip_id !== localTripId) throw new Error('Day not found in local database')
        if (!place || place.deleted_at || place.trip_id !== localTripId) throw new Error('Place not found in local database')
        const rows = await activeForDay(localDayId)
        const insertAt = Math.max(0, Math.min(position ?? rows.length, rows.length))
        const now = new Date().toISOString()
        for (const row of rows.filter(item => item.order_index >= insertAt)) {
          const shifted = { ...row, order_index: row.order_index + 1, updated_at: now }
          await offlineDb.assignments.put(shifted)
          await markLocalChange('assignment', shifted.sync_id, 'upsert')
        }
        const record: LocalAssignmentRecord = {
          id: await nextLocalAssignmentId(),
          sync_id: randomId(),
          trip_id: localTripId,
          trip_sync_id: trip.sync_id,
          day_id: localDayId,
          day_sync_id: day.sync_id,
          place_id: localPlaceId,
          place_sync_id: place.sync_id,
          order_index: insertAt,
          notes: null,
          assignment_time: null,
          assignment_end_time: null,
          leg_transport_mode: null,
          incoming_leg_transport_mode: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        }
        await offlineDb.assignments.add(record)
        await markLocalChange('assignment', record.sync_id, 'upsert')
        return { assignment: (await withPlace(record))! }
      },
    )
  },

  async update(tripId: number | string, assignmentId: number | string, patch: Partial<Assignment>): Promise<{ assignment: Assignment }> {
    const localTripId = Number(tripId)
    return offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.days, offlineDb.places, offlineDb.assignments, offlineDb.syncOutbox, offlineDb.entitySyncMeta],
      async () => {
        const stored = await offlineDb.assignments.get(Number(assignmentId))
        if (!stored || stored.deleted_at || stored.trip_id !== localTripId) throw new Error('Assignment not found in local database')
        const [trip, day, place] = await Promise.all([
          offlineDb.trips.get(localTripId),
          offlineDb.days.get(stored.day_id) as Promise<LocalDayRecord | undefined>,
          offlineDb.places.get(stored.place_id) as Promise<LocalPlaceRecord | undefined>,
        ])
        if (!trip?.sync_id || !day?.sync_id || !place?.sync_id || trip.deleted_at || day.deleted_at || place.deleted_at) {
          throw new Error('Assignment relation is unavailable in local database')
        }
        const { place: _embeddedPlace, ...fields } = patch
        const assignment = {
          ...asLocalAssignment(stored, trip.sync_id, day.sync_id, place.sync_id),
          ...fields,
          updated_at: new Date().toISOString(),
        }
        await offlineDb.assignments.put(assignment)
        await markLocalChange('assignment', assignment.sync_id, 'upsert')
        return { assignment: (await withPlace(assignment))! }
      },
    )
  },

  updateTime(tripId: number | string, assignmentId: number | string, data: { place_time?: string | null; end_time?: string | null }): Promise<{ assignment: Assignment }> {
    return this.update(tripId, assignmentId, {
      assignment_time: data.place_time ?? null,
      assignment_end_time: data.end_time ?? null,
    })
  },

  updateNotes(tripId: number | string, assignmentId: number | string, notes: string | null): Promise<{ assignment: Assignment }> {
    return this.update(tripId, assignmentId, { notes })
  },

  updateTransport(
    tripId: number | string,
    assignmentId: number | string,
    mode: string | null,
    direction: 'outgoing' | 'incoming' = 'outgoing',
  ): Promise<{ assignment: Assignment }> {
    return this.update(tripId, assignmentId, direction === 'incoming'
      ? { incoming_leg_transport_mode: mode }
      : { leg_transport_mode: mode })
  },

  async delete(tripId: number | string, dayId: number | string, assignmentId: number | string): Promise<void> {
    const localTripId = Number(tripId)
    const localDayId = Number(dayId)
    await offlineDb.transaction('rw', [offlineDb.assignments, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const stored = await offlineDb.assignments.get(Number(assignmentId)) as LocalAssignmentRecord | undefined
      if (!stored || stored.deleted_at || stored.trip_id !== localTripId || stored.day_id !== localDayId) {
        throw new Error('Assignment not found in local database')
      }
      const now = new Date().toISOString()
      const deleted = { ...stored, deleted_at: now, updated_at: now }
      await offlineDb.assignments.put(deleted)
      await markLocalChange('assignment', deleted.sync_id, 'delete')
      const linked = (await offlineDb.reservations.where('trip_id').equals(localTripId).toArray())
        .filter(reservation => !reservation.deleted_at && reservation.assignment_id === stored.id)
      for (const reservation of linked) {
        const changed = { ...reservation, assignment_id: null, assignment_sync_id: null, updated_at: now }
        await offlineDb.reservations.put(changed)
        if (changed.sync_id) await markLocalChange('reservation', changed.sync_id, 'upsert')
      }
      await reindex(localDayId, now)
    })
  },

  async reorder(tripId: number | string, dayId: number | string, orderedIds: number[]): Promise<Assignment[]> {
    const localTripId = Number(tripId)
    const localDayId = Number(dayId)
    return offlineDb.transaction('rw', [offlineDb.assignments, offlineDb.places, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      const rows = (await activeForDay(localDayId)).filter(item => item.trip_id === localTripId)
      if (orderedIds.length !== rows.length || new Set(orderedIds).size !== rows.length || orderedIds.some(id => !rows.some(row => row.id === id))) {
        throw new Error('Assignment reorder must contain every active assignment exactly once')
      }
      const byId = new Map(rows.map(item => [item.id, item]))
      const now = new Date().toISOString()
      for (let index = 0; index < orderedIds.length; index++) {
        const changed = { ...byId.get(orderedIds[index])!, order_index: index, updated_at: now }
        await offlineDb.assignments.put(changed)
        await markLocalChange('assignment', changed.sync_id, 'upsert')
      }
      return this.listByDay(localDayId)
    })
  },

  async move(
    tripId: number | string,
    assignmentId: number | string,
    fromDayId: number | string,
    toDayId: number | string,
    toOrderIndex?: number | null,
  ): Promise<void> {
    const localTripId = Number(tripId)
    const sourceId = Number(fromDayId)
    const targetId = Number(toDayId)
    await offlineDb.transaction(
      'rw',
      [offlineDb.days, offlineDb.assignments, offlineDb.syncOutbox, offlineDb.entitySyncMeta],
      async () => {
        const [stored, target] = await Promise.all([
          offlineDb.assignments.get(Number(assignmentId)) as Promise<LocalAssignmentRecord | undefined>,
          offlineDb.days.get(targetId) as Promise<LocalDayRecord | undefined>,
        ])
        if (!stored || stored.deleted_at || stored.trip_id !== localTripId || stored.day_id !== sourceId) {
          throw new Error('Assignment not found in local database')
        }
        if (!target || target.deleted_at || target.trip_id !== localTripId) throw new Error('Target Day not found in local database')
        const targetRows = (await activeForDay(targetId)).filter(item => item.id !== stored.id)
        const insertAt = Math.max(0, Math.min(toOrderIndex ?? targetRows.length, targetRows.length))
        const now = new Date().toISOString()
        const moved = { ...stored, day_id: targetId, day_sync_id: target.sync_id, order_index: insertAt, updated_at: now }
        await offlineDb.assignments.put(moved)
        await markLocalChange('assignment', moved.sync_id, 'upsert')
        await reindex(sourceId, now)
        const reorderedTarget = (await activeForDay(targetId)).filter(item => item.id !== moved.id)
        reorderedTarget.splice(insertAt, 0, moved)
        for (let index = 0; index < reorderedTarget.length; index++) {
          const changed = { ...reorderedTarget[index], order_index: index, updated_at: now }
          await offlineDb.assignments.put(changed)
          await markLocalChange('assignment', changed.sync_id, 'upsert')
        }
      },
    )
  },
}
