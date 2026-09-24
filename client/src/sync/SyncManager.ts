import { asLocalTripRecord, offlineDb } from '../db/offlineDb'
import { applySyncedDay, toSyncedDay, type LocalDayRecord, type SyncedDay } from '../domain/daySyncModel'
import { applySyncedDayNote, toSyncedDayNote, type SyncedDayNote } from '../domain/dayNoteSyncModel'
import { applySyncedPlace, toSyncedPlace, type LocalPlaceRecord, type SyncedPlace } from '../domain/placeSyncModel'
import { applySyncedAssignment, toSyncedAssignment, type LocalAssignmentRecord, type SyncedAssignment } from '../domain/assignmentSyncModel'
import { applySyncedAccommodation, toSyncedAccommodation, type LocalAccommodationRecord, type SyncedAccommodation } from '../domain/accommodationSyncModel'
import { applySyncedReservation, toSyncedReservation, type LocalReservationRecord, type SyncedReservation } from '../domain/reservationSyncModel'
import { applySyncedBudgetItem, toSyncedBudgetItem, type LocalBudgetItemRecord, type SyncedBudgetItem } from '../domain/budgetSyncModel'
import { applySyncedTodo, toSyncedTodo, type LocalTodoRecord, type SyncedTodo } from '../domain/todoSyncModel'
import { applySyncedPackingBag, applySyncedPackingConfig, applySyncedPackingItem, toSyncedPackingBag, toSyncedPackingConfig, toSyncedPackingItem, type LocalPackingBagRecord, type LocalPackingItemRecord, type SyncedPackingBag, type SyncedPackingConfig, type SyncedPackingItem } from '../domain/packingSyncModel'
import { applySyncedVacay, toSyncedVacay, VACAY_SYNC_ID, type SyncedVacay } from '../domain/vacaySyncModel'
import { isSyncedAtlas, type SyncedAtlas } from '../domain/atlasSyncModel'
import { applySyncedTrip, toSyncedTrip, type SyncedTrip } from '../domain/tripSyncModel'
import { applySyncedTripFile, toSyncedTripFile, type LocalTripFileRecord, type SyncedTripFile } from '../domain/tripFileSyncModel'
import { applySyncedCategory, toSyncedCategory, type LocalCategoryRecord, type SyncedCategory } from '../domain/categorySyncModel'
import { applySyncedCollection, applySyncedCollectionPlace, toSyncedCollection, toSyncedCollectionPlace, type LocalCollectionPlaceRecord, type LocalCollectionRecord, type SyncedCollection, type SyncedCollectionPlace } from '../domain/collectionSyncModel'
import { toSyncedJourney, toSyncedJourneyEntry, type LocalJourneyRecord, type LocalJourneyEntryRecord, type SyncedJourney, type SyncedJourneyEntry } from '../domain/journeySyncModel'
import { syncEntityKey } from './localChangeRepository'
import type { LocalChange, RemoteChange, SyncProvider, SyncStateRecord } from './types'

async function nextLocalTripId(): Promise<number> {
  const first = await offlineDb.trips.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

async function nextLocalDayId(): Promise<number> {
  const first = await offlineDb.days.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}
async function nextLocalDayNoteId(): Promise<number> { const first = await offlineDb.dayNotes.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }

async function nextLocalPlaceId(): Promise<number> {
  const first = await offlineDb.places.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}
async function nextLocalCategoryId(): Promise<number> { const first = await offlineDb.categories.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalCollectionId(): Promise<number> { const first = await offlineDb.collections.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalCollectionPlaceId(): Promise<number> { const first = await offlineDb.collectionPlaces.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalJourneyId(): Promise<number> { const first = await offlineDb.journeys.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalJourneyEntryId(): Promise<number> { const first = await offlineDb.journeyEntries.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
function localUserId(): number { try { const raw = localStorage.getItem('trek_auth_snapshot'); return Number(raw ? JSON.parse(raw)?.state?.user?.id ?? 0 : 0) } catch { return 0 } }

async function nextLocalAssignmentId(): Promise<number> {
  const first = await offlineDb.assignments.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}
async function nextLocalAccommodationId(): Promise<number> { const first = await offlineDb.accommodations.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalReservationId(): Promise<number> { const first = await offlineDb.reservations.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalBudgetItemId(): Promise<number> { const first = await offlineDb.budgetItems.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalTodoId(): Promise<number> { const first = await offlineDb.todoItems.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalPackingBagId(): Promise<number> { const first = await offlineDb.packingBags.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalPackingItemId(): Promise<number> { const first = await offlineDb.packingItems.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }
async function nextLocalTripFileId(): Promise<number> { const first = await offlineDb.tripFiles.orderBy('id').first(); return first && first.id < 0 ? first.id - 1 : -1 }

export interface SyncRunResult {
  pulled: number
  pushed: number
  conflicts: number
  cursor: string | null
}

/** Coordinates local data and an interchangeable provider. */
export class SyncManager {
  constructor(private readonly provider: SyncProvider) {}

  private async applyRemoteTrip(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts],
      async () => {
        const [meta, pending, local] = await Promise.all([
          offlineDb.entitySyncMeta.get(key),
          offlineDb.syncOutbox.get(key),
          offlineDb.trips.where('sync_id').equals(change.entityId).first(),
        ])
        if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'

        if (pending && pending.status !== 'conflict') {
          await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' })
          await offlineDb.entitySyncMeta.put({
            key,
            entityType: change.entityType,
            entityId: change.entityId,
            status: 'conflict',
            remoteVersion: meta?.remoteVersion ?? null,
            lastSyncedAt: meta?.lastSyncedAt ?? null,
            lastError: 'Both local and remote versions changed',
          })
          await offlineDb.syncConflicts.put({
            key,
            entityType: change.entityType,
            entityId: change.entityId,
            baseVersion: meta?.remoteVersion ?? null,
            remoteVersion: change.remoteVersion,
            localSnapshot: local ? toSyncedTrip(asLocalTripRecord(local)) : null,
            remoteSnapshot: change.payload ?? { deleted: true },
            detectedAt: Date.now(),
          })
          return 'conflict'
        }

        if (change.operation === 'delete') {
          if (local) {
            const now = new Date().toISOString()
            await offlineDb.trips.put({ ...local, deleted_at: now, updated_at: now })
          }
        } else {
          const remote = change.payload as SyncedTrip
          if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) {
            throw new Error(`Invalid remote trip ${change.entityId}`)
          }
          const localId = local?.id ?? await nextLocalTripId()
          await offlineDb.trips.put(applySyncedTrip(remote, localId))
        }

        await offlineDb.entitySyncMeta.put({
          key,
          entityType: change.entityType,
          entityId: change.entityId,
          status: 'synced',
          remoteVersion: change.remoteVersion,
          lastSyncedAt: Date.now(),
          lastError: null,
        })
        await offlineDb.syncConflicts.delete(key)
        return 'applied'
      },
    )
  }

  private async applyRemoteDay(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.days, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts],
      async () => {
        const [meta, pending, local] = await Promise.all([
          offlineDb.entitySyncMeta.get(key),
          offlineDb.syncOutbox.get(key),
          offlineDb.days.where('sync_id').equals(change.entityId).first(),
        ])
        if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'

        if (pending && pending.status !== 'conflict') {
          await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' })
          await offlineDb.entitySyncMeta.put({
            key,
            entityType: change.entityType,
            entityId: change.entityId,
            status: 'conflict',
            remoteVersion: meta?.remoteVersion ?? null,
            lastSyncedAt: meta?.lastSyncedAt ?? null,
            lastError: 'Both local and remote versions changed',
          })
          await offlineDb.syncConflicts.put({
            key,
            entityType: change.entityType,
            entityId: change.entityId,
            baseVersion: meta?.remoteVersion ?? null,
            remoteVersion: change.remoteVersion,
            localSnapshot: local ? toSyncedDay(local as LocalDayRecord) : null,
            remoteSnapshot: change.payload ?? { deleted: true },
            detectedAt: Date.now(),
          })
          return 'conflict'
        }

        if (change.operation === 'delete') {
          if (local) {
            const remote = change.payload as SyncedDay | undefined
            const now = remote?.deletedAt || new Date().toISOString()
            await offlineDb.days.put({ ...local, deleted_at: now, updated_at: remote?.updatedAt || now })
          }
        } else {
          const remote = change.payload as SyncedDay
          if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) {
            throw new Error(`Invalid remote day ${change.entityId}`)
          }
          const trip = await offlineDb.trips.where('sync_id').equals(remote.tripId).first()
          if (!trip || trip.deleted_at) throw new Error(`Parent trip ${remote.tripId} is unavailable for day ${remote.id}`)
          const localId = local?.id ?? await nextLocalDayId()
          await offlineDb.days.put(applySyncedDay(remote, localId, trip.id))
        }

        await offlineDb.entitySyncMeta.put({
          key,
          entityType: change.entityType,
          entityId: change.entityId,
          status: 'synced',
          remoteVersion: change.remoteVersion,
          lastSyncedAt: Date.now(),
          lastError: null,
        })
        await offlineDb.syncConflicts.delete(key)
        return 'applied'
      },
    )
  }

  private async applyRemotePlace(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.categories, offlineDb.places, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts],
      async () => {
        const [meta, pending, local] = await Promise.all([
          offlineDb.entitySyncMeta.get(key),
          offlineDb.syncOutbox.get(key),
          offlineDb.places.where('sync_id').equals(change.entityId).first(),
        ])
        if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
        if (pending && pending.status !== 'conflict') {
          await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' })
          await offlineDb.entitySyncMeta.put({
            key, entityType: 'place', entityId: change.entityId, status: 'conflict',
            remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null,
            lastError: 'Both local and remote versions changed',
          })
          await offlineDb.syncConflicts.put({
            key, entityType: 'place', entityId: change.entityId,
            baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion,
            localSnapshot: local ? toSyncedPlace(local as LocalPlaceRecord) : null,
            remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now(),
          })
          return 'conflict'
        }
        if (change.operation === 'delete') {
          if (local) {
            const remote = change.payload as SyncedPlace | undefined
            const now = remote?.deletedAt || new Date().toISOString()
            await offlineDb.places.put({ ...local, deleted_at: now, updated_at: remote?.updatedAt || now })
          }
        } else {
          const remote = change.payload as SyncedPlace
          if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote place ${change.entityId}`)
          const trip = await offlineDb.trips.where('sync_id').equals(remote.tripId).first()
          if (!trip || trip.deleted_at) throw new Error(`Parent trip ${remote.tripId} is unavailable for place ${remote.id}`)
          const category = remote.categoryId ? await offlineDb.categories.where('sync_id').equals(remote.categoryId).first() : undefined
          await offlineDb.places.put(applySyncedPlace(remote, local?.id ?? await nextLocalPlaceId(), trip.id, category && !category.deleted_at ? category.id : null))
        }
        await offlineDb.entitySyncMeta.put({
          key, entityType: 'place', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion,
          lastSyncedAt: Date.now(), lastError: null,
        })
        await offlineDb.syncConflicts.delete(key)
        return 'applied'
      },
    )
  }

  private async applyRemoteCategory(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.categories, offlineDb.places, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, local] = await Promise.all([
        offlineDb.entitySyncMeta.get(key),
        offlineDb.categories.where('sync_id').equals(change.entityId).first(),
      ])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (change.operation === 'delete') {
        if (local) {
          const now = new Date().toISOString()
          await offlineDb.categories.put({ ...local, deleted_at: now, updated_at: now })
          const linkedPlaces = await offlineDb.places
            .filter(place => place.category_sync_id === change.entityId || place.category_id === local.id)
            .toArray()
          await offlineDb.places.bulkPut(linkedPlaces.map(place => ({
            ...place,
            category_id: null,
            category_sync_id: null,
            category: null,
          })))
        }
      } else {
        const remote = change.payload as SyncedCategory
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote category ${change.entityId}`)
        await offlineDb.categories.put(applySyncedCategory(remote, local?.id ?? await nextLocalCategoryId()))
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'category', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key)
      return 'applied'
    })
  }

  private async applyRemoteCollection(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.collections, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.collections.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (change.operation === 'delete') {
        if (local) { const now = new Date().toISOString(); await offlineDb.collections.put({ ...local, deleted_at: now, updated_at: now }) }
      } else {
        const remote = change.payload as SyncedCollection
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote collection ${change.entityId}`)
        await offlineDb.collections.put(applySyncedCollection(remote, local?.id ?? await nextLocalCollectionId(), localUserId()))
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'collection', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemoteCollectionPlace(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.collections, offlineDb.collectionPlaces, offlineDb.trips, offlineDb.places, offlineDb.categories, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.collectionPlaces.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (change.operation === 'delete') {
        if (local) { const now = new Date().toISOString(); await offlineDb.collectionPlaces.put({ ...local, deleted_at: now, updated_at: now }) }
      } else {
        const remote = change.payload as SyncedCollectionPlace
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote collection place ${change.entityId}`)
        const collection = await offlineDb.collections.where('sync_id').equals(remote.collectionId).first()
        if (!collection || collection.deleted_at) throw new Error(`Collection ${remote.collectionId} is unavailable`)
        const [sourceTrip, sourcePlace, category] = await Promise.all([
          remote.sourceTripId ? offlineDb.trips.where('sync_id').equals(remote.sourceTripId).first() : undefined,
          remote.sourcePlaceId ? offlineDb.places.where('sync_id').equals(remote.sourcePlaceId).first() : undefined,
          remote.categoryId ? offlineDb.categories.where('sync_id').equals(remote.categoryId).first() : undefined,
        ])
        await offlineDb.collectionPlaces.put(applySyncedCollectionPlace(remote, local?.id ?? await nextLocalCollectionPlaceId(), {
          collectionId: collection.id,
          sourceTripId: sourceTrip && !sourceTrip.deleted_at ? sourceTrip.id : null,
          sourcePlaceId: sourcePlace && !sourcePlace.deleted_at ? sourcePlace.id : null,
          categoryId: category && !category.deleted_at ? category.id : null,
        }))
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'collectionPlace', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemoteJourney(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.journeys.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (change.operation === 'delete') {
        if (local) await offlineDb.journeys.put({ ...local, deleted_at: new Date().toISOString() })
      } else {
        const remote = change.payload as SyncedJourney
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote journey ${change.entityId}`)
        const updated = Date.parse(remote.updatedAt)
        const row: LocalJourneyRecord = {
          id: local?.id ?? await nextLocalJourneyId(), sync_id: remote.id, user_id: remote.ownerUserId,
          owner_auth_id: remote.ownerAuthId, owner_username: remote.ownerUsername, title: remote.title, subtitle: remote.subtitle,
          cover_gradient: remote.coverGradient, cover_image: null, status: remote.status,
          trip_sync_ids: remote.tripIds, members: remote.members,
          created_at: Date.parse(remote.createdAt), updated_at: Number.isFinite(updated) ? updated : Date.now(),
          local_updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
        }
        await offlineDb.journeys.put(row)
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'journey', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key)
      return 'applied'
    })
  }

  private async applyRemoteJourneyEntry(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.journeys, offlineDb.journeyEntries, offlineDb.trips, offlineDb.places, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.journeyEntries.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (change.operation === 'delete') {
        if (local) await offlineDb.journeyEntries.put({ ...local, deleted_at: new Date().toISOString() })
      } else {
        const remote = change.payload as SyncedJourneyEntry
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote journey entry ${change.entityId}`)
        const journey = await offlineDb.journeys.where('sync_id').equals(remote.journeyId).first()
        if (!journey || journey.deleted_at) throw new Error(`Journey ${remote.journeyId} is unavailable`)
        const [trip, place] = await Promise.all([
          remote.sourceTripId ? offlineDb.trips.where('sync_id').equals(remote.sourceTripId).first() : undefined,
          remote.sourcePlaceId ? offlineDb.places.where('sync_id').equals(remote.sourcePlaceId).first() : undefined,
        ])
        const row: LocalJourneyEntryRecord = {
          ...remote.value, id: local?.id ?? await nextLocalJourneyEntryId(), sync_id: remote.id,
          journey_id: journey.id, journey_sync_id: journey.sync_id,
          source_trip_id: trip && !trip.deleted_at ? trip.id : null, source_trip_sync_id: remote.sourceTripId,
          source_place_id: place && !place.deleted_at ? place.id : null, source_place_sync_id: remote.sourcePlaceId,
          photos: [], created_at: Date.parse(remote.createdAt), updated_at: Date.parse(remote.updatedAt),
          local_updated_at: remote.updatedAt, deleted_at: remote.deletedAt,
        }
        await offlineDb.journeyEntries.put(row)
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'journeyEntry', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key)
      return 'applied'
    })
  }

  private async applyRemoteDayNote(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.dayNotes, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([
        offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key),
        offlineDb.dayNotes.where('sync_id').equals(change.entityId).first(),
      ])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') {
        await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' })
        await offlineDb.entitySyncMeta.put({ key, entityType: 'dayNote', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' })
        await offlineDb.syncConflicts.put({ key, entityType: 'dayNote', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedDayNote(local) : null, remoteSnapshot: change.payload, detectedAt: Date.now() })
        return 'conflict'
      }
      const remote = change.payload as SyncedDayNote
      if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote day note ${change.entityId}`)
      if (change.operation === 'delete') {
        if (local) await offlineDb.dayNotes.put({ ...local, deleted_at: remote.deletedAt || new Date().toISOString(), updated_at: remote.updatedAt })
      } else {
        const [trip, day] = await Promise.all([
          offlineDb.trips.where('sync_id').equals(remote.tripId).first(),
          offlineDb.days.where('sync_id').equals(remote.dayId).first(),
        ])
        if (!trip || trip.deleted_at || !day || day.deleted_at || day.trip_id !== trip.id) throw new Error(`Day note ${remote.id} has an unavailable relation`)
        await offlineDb.dayNotes.put(applySyncedDayNote(remote, local?.id ?? await nextLocalDayNoteId(), trip.id, day.id))
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'dayNote', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key)
      return 'applied'
    })
  }

  private async applyRemoteAssignment(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction(
      'rw',
      [offlineDb.trips, offlineDb.days, offlineDb.places, offlineDb.assignments, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts],
      async () => {
        const [meta, pending, local] = await Promise.all([
          offlineDb.entitySyncMeta.get(key),
          offlineDb.syncOutbox.get(key),
          offlineDb.assignments.where('sync_id').equals(change.entityId).first(),
        ])
        if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
        if (pending && pending.status !== 'conflict') {
          await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' })
          await offlineDb.entitySyncMeta.put({
            key, entityType: 'assignment', entityId: change.entityId, status: 'conflict',
            remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null,
            lastError: 'Both local and remote versions changed',
          })
          await offlineDb.syncConflicts.put({
            key, entityType: 'assignment', entityId: change.entityId,
            baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion,
            localSnapshot: local ? toSyncedAssignment(local as LocalAssignmentRecord) : null,
            remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now(),
          })
          return 'conflict'
        }
        if (change.operation === 'delete') {
          if (local) {
            const remote = change.payload as SyncedAssignment | undefined
            const now = remote?.deletedAt || new Date().toISOString()
            await offlineDb.assignments.put({ ...local, deleted_at: now, updated_at: remote?.updatedAt || now })
          }
        } else {
          const remote = change.payload as SyncedAssignment
          if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote assignment ${change.entityId}`)
          const [trip, day, place] = await Promise.all([
            offlineDb.trips.where('sync_id').equals(remote.tripId).first(),
            offlineDb.days.where('sync_id').equals(remote.dayId).first(),
            offlineDb.places.where('sync_id').equals(remote.placeId).first(),
          ])
          if (!trip || trip.deleted_at || !day || day.deleted_at || !place || place.deleted_at || day.trip_id !== trip.id || place.trip_id !== trip.id) {
            throw new Error(`Assignment ${remote.id} has an unavailable relation`)
          }
          await offlineDb.assignments.put(applySyncedAssignment(
            remote, local?.id ?? await nextLocalAssignmentId(), trip.id, day.id, place.id,
          ))
        }
        await offlineDb.entitySyncMeta.put({
          key, entityType: 'assignment', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion,
          lastSyncedAt: Date.now(), lastError: null,
        })
        await offlineDb.syncConflicts.delete(key)
        return 'applied'
      },
    )
  }

  private async applyRemoteAccommodation(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.places, offlineDb.accommodations, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key), offlineDb.accommodations.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') {
        await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' })
        await offlineDb.entitySyncMeta.put({ key, entityType: 'accommodation', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' })
        await offlineDb.syncConflicts.put({ key, entityType: 'accommodation', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedAccommodation(local as LocalAccommodationRecord) : null, remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now() })
        return 'conflict'
      }
      if (change.operation === 'delete') {
        if (local) { const remote = change.payload as SyncedAccommodation | undefined, now = remote?.deletedAt || new Date().toISOString(); await offlineDb.accommodations.put({ ...local, deleted_at: now, updated_at: remote?.updatedAt || now }) }
      } else {
        const remote = change.payload as SyncedAccommodation
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote accommodation ${change.entityId}`)
        const [trip, place, start, end] = await Promise.all([offlineDb.trips.where('sync_id').equals(remote.tripId).first(), remote.placeId ? offlineDb.places.where('sync_id').equals(remote.placeId).first() : undefined, offlineDb.days.where('sync_id').equals(remote.startDayId).first(), offlineDb.days.where('sync_id').equals(remote.endDayId).first()])
        if (!trip || trip.deleted_at || !start || start.deleted_at || start.trip_id !== trip.id || !end || end.deleted_at || end.trip_id !== trip.id || (remote.placeId && (!place || place.deleted_at || place.trip_id !== trip.id))) throw new Error(`Accommodation ${remote.id} has an unavailable relation`)
        await offlineDb.accommodations.put(applySyncedAccommodation(remote, local?.id ?? await nextLocalAccommodationId(), trip.id, place?.id ?? null, start.id, end.id))
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'accommodation', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null }); await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemoteReservation(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    const dayRows = await offlineDb.days.toArray(); const dayIds = new Map(dayRows.filter(row => row.sync_id).map(row => [row.sync_id!, row.id]))
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.days, offlineDb.places, offlineDb.assignments, offlineDb.accommodations, offlineDb.reservations, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key), offlineDb.reservations.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') {
        const localSnapshot = local ? toSyncedReservation(local as LocalReservationRecord, new Map(dayRows.map(row => [row.id, row.sync_id!]))) : null
        await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' }); await offlineDb.entitySyncMeta.put({ key, entityType: 'reservation', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' }); await offlineDb.syncConflicts.put({ key, entityType: 'reservation', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot, remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now() }); return 'conflict'
      }
      if (change.operation === 'delete') {
        if (local) { const remote = change.payload as SyncedReservation | undefined, now = remote?.deletedAt || new Date().toISOString(); await offlineDb.reservations.put({ ...local, deleted_at: now, updated_at: remote?.updatedAt || now }) }
      } else {
        const remote = change.payload as SyncedReservation
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote reservation ${change.entityId}`)
        const [trip, place, assignment, accommodation] = await Promise.all([offlineDb.trips.where('sync_id').equals(remote.tripId).first(), remote.placeId ? offlineDb.places.where('sync_id').equals(remote.placeId).first() : undefined, remote.assignmentId ? offlineDb.assignments.where('sync_id').equals(remote.assignmentId).first() : undefined, remote.accommodationId ? offlineDb.accommodations.where('sync_id').equals(remote.accommodationId).first() : undefined])
        const day = remote.dayId ? dayRows.find(row => row.sync_id === remote.dayId) : undefined
        const endDay = remote.endDayId ? dayRows.find(row => row.sync_id === remote.endDayId) : undefined
        const missing = !trip || trip.deleted_at
          || (remote.dayId && (!day || day.deleted_at || day.trip_id !== trip.id))
          || (remote.endDayId && (!endDay || endDay.deleted_at || endDay.trip_id !== trip.id))
          || (remote.placeId && (!place || place.deleted_at || place.trip_id !== trip.id))
          || (remote.assignmentId && (!assignment || assignment.deleted_at || assignment.trip_id !== trip.id))
          || (remote.accommodationId && (!accommodation || accommodation.deleted_at || accommodation.trip_id !== trip.id))
        if (missing) throw new Error(`Reservation ${remote.id} has an unavailable relation`)
        await offlineDb.reservations.put(applySyncedReservation(remote, local?.id ?? await nextLocalReservationId(), { tripId: trip!.id, dayId: remote.dayId ? dayIds.get(remote.dayId)! : null, endDayId: remote.endDayId ? dayIds.get(remote.endDayId)! : null, placeId: place?.id ?? null, assignmentId: assignment?.id ?? null, accommodationId: accommodation?.id ?? null, dayIds }))
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'reservation', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null }); await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemoteBudgetItem(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.places, offlineDb.reservations, offlineDb.budgetItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([
        offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key),
        offlineDb.budgetItems.where('sync_id').equals(change.entityId).first(),
      ])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') {
        await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' })
        await offlineDb.entitySyncMeta.put({ key, entityType: 'budgetItem', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' })
        await offlineDb.syncConflicts.put({ key, entityType: 'budgetItem', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedBudgetItem(local as LocalBudgetItemRecord) : null, remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now() })
        return 'conflict'
      }
      if (change.operation === 'delete') {
        if (local) { const remote = change.payload as SyncedBudgetItem | undefined, now = remote?.deletedAt || new Date().toISOString(); await offlineDb.budgetItems.put({ ...local, deleted_at: now, updated_at: remote?.updatedAt || now }) }
      } else {
        const remote = change.payload as SyncedBudgetItem
        if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote budget item ${change.entityId}`)
        const [trip, reservation, place] = await Promise.all([
          offlineDb.trips.where('sync_id').equals(remote.tripId).first(),
          remote.reservationId ? offlineDb.reservations.where('sync_id').equals(remote.reservationId).first() : undefined,
          remote.placeId ? offlineDb.places.where('sync_id').equals(remote.placeId).first() : undefined,
        ])
        if (!trip || trip.deleted_at
          || (remote.reservationId && (!reservation || reservation.deleted_at || reservation.trip_id !== trip.id))
          || (remote.placeId && (!place || place.deleted_at || place.trip_id !== trip.id))) throw new Error(`Budget item ${remote.id} has an unavailable relation`)
        await offlineDb.budgetItems.put(applySyncedBudgetItem(remote, local?.id ?? await nextLocalBudgetItemId(), trip.id, reservation?.id ?? null, place?.id ?? null))
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'budgetItem', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key)
      return 'applied'
    })
  }

  private async applyRemoteTodo(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.todoItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key), offlineDb.todoItems.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') { await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' }); await offlineDb.entitySyncMeta.put({ key, entityType: 'todo', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' }); await offlineDb.syncConflicts.put({ key, entityType: 'todo', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedTodo(local as LocalTodoRecord) : null, remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now() }); return 'conflict' }
      const remote = change.payload as SyncedTodo
      if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote todo ${change.entityId}`)
      if (change.operation === 'delete') { if (local) await offlineDb.todoItems.put({ ...local, deleted_at: remote.deletedAt ?? new Date().toISOString(), updated_at: remote.updatedAt }) }
      else { const trip = await offlineDb.trips.where('sync_id').equals(remote.tripId).first(); if (!trip || trip.deleted_at) throw new Error(`Todo ${remote.id} has an unavailable trip`); await offlineDb.todoItems.put(applySyncedTodo(remote, local?.id ?? await nextLocalTodoId(), trip.id)) }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'todo', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null }); await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemotePackingBag(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.packingBags, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key), offlineDb.packingBags.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') { await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' }); await offlineDb.entitySyncMeta.put({ key, entityType: 'packingBag', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' }); await offlineDb.syncConflicts.put({ key, entityType: 'packingBag', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedPackingBag(local as LocalPackingBagRecord) : null, remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now() }); return 'conflict' }
      const remote = change.payload as SyncedPackingBag; if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote packing bag ${change.entityId}`)
      if (change.operation === 'delete') { if (local) await offlineDb.packingBags.put({ ...local, deleted_at: remote.deletedAt ?? new Date().toISOString(), updated_at: remote.updatedAt }) }
      else { const trip = await offlineDb.trips.where('sync_id').equals(remote.tripId).first(); if (!trip || trip.deleted_at) throw new Error(`Packing bag ${remote.id} has an unavailable trip`); await offlineDb.packingBags.put(applySyncedPackingBag(remote, local?.id ?? await nextLocalPackingBagId(), trip.id)) }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'packingBag', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null }); await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemotePackingItem(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.trips, offlineDb.packingBags, offlineDb.packingItems, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key), offlineDb.packingItems.where('sync_id').equals(change.entityId).first()])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') { await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' }); await offlineDb.entitySyncMeta.put({ key, entityType: 'packingItem', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' }); await offlineDb.syncConflicts.put({ key, entityType: 'packingItem', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedPackingItem(local as LocalPackingItemRecord) : null, remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now() }); return 'conflict' }
      const remote = change.payload as SyncedPackingItem; if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote packing item ${change.entityId}`)
      if (change.operation === 'delete') { if (local) await offlineDb.packingItems.put({ ...local, deleted_at: remote.deletedAt ?? new Date().toISOString(), updated_at: remote.updatedAt }) }
      else { const [trip, bag] = await Promise.all([offlineDb.trips.where('sync_id').equals(remote.tripId).first(), remote.bagId ? offlineDb.packingBags.where('sync_id').equals(remote.bagId).first() : undefined]); if (!trip || trip.deleted_at || (remote.bagId && (!bag || bag.deleted_at || bag.trip_id !== trip.id))) throw new Error(`Packing item ${remote.id} has an unavailable relation`); await offlineDb.packingItems.put(applySyncedPackingItem(remote, local?.id ?? await nextLocalPackingItemId(), trip.id, bag?.id ?? null)) }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'packingItem', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null }); await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemoteVacay(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.vacayData, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key), offlineDb.vacayData.get(VACAY_SYNC_ID)])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') { await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' }); await offlineDb.entitySyncMeta.put({ key, entityType: 'vacay', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' }); await offlineDb.syncConflicts.put({ key, entityType: 'vacay', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedVacay(local) : null, remoteSnapshot: change.payload ?? { deleted: true }, detectedAt: Date.now() }); return 'conflict' }
      const remote = change.payload as SyncedVacay; if (!remote || remote.schemaVersion !== 1 || remote.id !== VACAY_SYNC_ID) throw new Error('Invalid remote Vacay document')
      await offlineDb.vacayData.put(applySyncedVacay(remote)); await offlineDb.entitySyncMeta.put({ key, entityType: 'vacay', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null }); await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemoteAtlas(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey('atlas', change.entityId)
    return offlineDb.transaction('rw', [offlineDb.atlasData, offlineDb.entitySyncMeta], async () => {
      const meta = await offlineDb.entitySyncMeta.get(key)
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      const remote = change.payload as SyncedAtlas
      if (!isSyncedAtlas(remote, change.entityId)) throw new Error('Invalid remote Atlas document')
      await offlineDb.atlasData.put(remote)
      await offlineDb.entitySyncMeta.put({ key, entityType: 'atlas', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      return 'applied'
    })
  }

  private async applyRemotePackingConfig(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    return offlineDb.transaction('rw', [offlineDb.packingConfig, offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      const [meta, pending, local] = await Promise.all([offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key), offlineDb.packingConfig.get('personal-packing')])
      if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
      if (pending && pending.status !== 'conflict') { await offlineDb.syncOutbox.update(key, { status: 'conflict', lastError: 'remote changed' }); await offlineDb.entitySyncMeta.put({ key, entityType: 'packingConfig', entityId: change.entityId, status: 'conflict', remoteVersion: meta?.remoteVersion ?? null, lastSyncedAt: meta?.lastSyncedAt ?? null, lastError: 'Both local and remote versions changed' }); await offlineDb.syncConflicts.put({ key, entityType: 'packingConfig', entityId: change.entityId, baseVersion: meta?.remoteVersion ?? null, remoteVersion: change.remoteVersion, localSnapshot: local ? toSyncedPackingConfig(local) : null, remoteSnapshot: change.payload, detectedAt: Date.now() }); return 'conflict' }
      const remote = change.payload as SyncedPackingConfig; if (!remote || remote.schemaVersion !== 1 || remote.id !== 'personal-packing') throw new Error('Invalid remote packing config')
      await offlineDb.packingConfig.put(applySyncedPackingConfig(remote)); await offlineDb.entitySyncMeta.put({ key, entityType: 'packingConfig', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null }); await offlineDb.syncConflicts.delete(key); return 'applied'
    })
  }

  private async applyRemoteTripFile(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    const key = syncEntityKey(change.entityType, change.entityId)
    const [meta, pending, local] = await Promise.all([
      offlineDb.entitySyncMeta.get(key), offlineDb.syncOutbox.get(key),
      offlineDb.tripFiles.where('sync_id').equals(change.entityId).first(),
    ])
    if (meta?.remoteVersion === change.remoteVersion) return 'unchanged'
    if (pending && this.provider.syncMode !== 'last-write-wins') return 'conflict'
    const remote = change.payload as SyncedTripFile
    if (!remote || remote.schemaVersion !== 1 || remote.id !== change.entityId) throw new Error(`Invalid remote file ${change.entityId}`)
    let downloaded: Blob | null = null
    if (change.operation !== 'delete' && !(await offlineDb.tripFileBlobs.get(change.entityId))) {
      if (!this.provider.downloadAttachment) throw new Error('The sync provider does not support attachments')
      downloaded = await this.provider.downloadAttachment(remote.storagePath)
    }
    await offlineDb.transaction('rw', [offlineDb.trips, offlineDb.places, offlineDb.reservations, offlineDb.tripFiles, offlineDb.tripFileBlobs, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
      if (change.operation === 'delete') {
        if (local) await offlineDb.tripFiles.put({ ...local, deleted_at: remote.deletedAt || new Date().toISOString(), updated_at: remote.updatedAt })
      } else {
        const [trip, place, reservation, linkedPlaces, linkedReservations] = await Promise.all([
          offlineDb.trips.where('sync_id').equals(remote.tripId).first(),
          remote.placeId ? offlineDb.places.where('sync_id').equals(remote.placeId).first() : undefined,
          remote.reservationId ? offlineDb.reservations.where('sync_id').equals(remote.reservationId).first() : undefined,
          Promise.all(remote.linkedPlaceIds.map(id => offlineDb.places.where('sync_id').equals(id).first())),
          Promise.all(remote.linkedReservationIds.map(id => offlineDb.reservations.where('sync_id').equals(id).first())),
        ])
        if (!trip || trip.deleted_at || (remote.placeId && (!place || place.deleted_at)) || (remote.reservationId && (!reservation || reservation.deleted_at)) || linkedPlaces.some(value => !value || value.deleted_at) || linkedReservations.some(value => !value || value.deleted_at)) {
          throw new Error(`File ${remote.id} has an unavailable relation`)
        }
        await offlineDb.tripFiles.put(applySyncedTripFile(remote, local?.id ?? await nextLocalTripFileId(), { tripId: trip.id, placeId: place?.id ?? null, reservationId: reservation?.id ?? null, linkedPlaceIds: linkedPlaces.map(value => value!.id), linkedReservationIds: linkedReservations.map(value => value!.id) }))
        if (downloaded) await offlineDb.tripFileBlobs.put({ syncId: remote.id, blob: downloaded, mime: remote.mimeType, bytes: downloaded.size, updatedAt: Date.now() })
      }
      await offlineDb.entitySyncMeta.put({ key, entityType: 'tripFile', entityId: change.entityId, status: 'synced', remoteVersion: change.remoteVersion, lastSyncedAt: Date.now(), lastError: null })
      await offlineDb.syncConflicts.delete(key)
    })
    return 'applied'
  }

  private async applyRemote(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
    // An edit made while a Supabase run is in flight is a newer unsent local
    // write. Leave it in the outbox; the next run will commit it and then pull
    // the cloud winner. Never turn this normal LWW race into a manual conflict.
    if (this.provider.syncMode === 'last-write-wins' && await offlineDb.syncOutbox.get(syncEntityKey(change.entityType, change.entityId))) {
      return 'unchanged'
    }
    if (change.entityType === 'day') return this.applyRemoteDay(change)
    if (change.entityType === 'dayNote') return this.applyRemoteDayNote(change)
    if (change.entityType === 'category') return this.applyRemoteCategory(change)
    if (change.entityType === 'collection') return this.applyRemoteCollection(change)
    if (change.entityType === 'collectionPlace') return this.applyRemoteCollectionPlace(change)
    if (change.entityType === 'journey') return this.applyRemoteJourney(change)
    if (change.entityType === 'journeyEntry') return this.applyRemoteJourneyEntry(change)
    if (change.entityType === 'place') return this.applyRemotePlace(change)
    if (change.entityType === 'assignment') return this.applyRemoteAssignment(change)
    if (change.entityType === 'accommodation') return this.applyRemoteAccommodation(change)
    if (change.entityType === 'reservation') return this.applyRemoteReservation(change)
    if (change.entityType === 'budgetItem') return this.applyRemoteBudgetItem(change)
    if (change.entityType === 'todo') return this.applyRemoteTodo(change)
    if (change.entityType === 'packingBag') return this.applyRemotePackingBag(change)
    if (change.entityType === 'packingItem') return this.applyRemotePackingItem(change)
    if (change.entityType === 'packingConfig') return this.applyRemotePackingConfig(change)
    if (change.entityType === 'tripFile') return this.applyRemoteTripFile(change)
    if (change.entityType === 'vacay') return this.applyRemoteVacay(change)
    if (change.entityType === 'atlas') return this.applyRemoteAtlas(change)
    return this.applyRemoteTrip(change)
  }

  /** Serialize the durable outbox without consulting a cloud implementation. */
  private async collectLocalChanges(): Promise<LocalChange[]> {
    const outbox = await offlineDb.syncOutbox
      .filter(row => row.status === 'pending' || row.status === 'error' || row.status === 'conflict')
      .sortBy('changedAt')
    const changes: LocalChange[] = []
    for (const row of outbox) {
      const meta = await offlineDb.entitySyncMeta.get(row.key)
      if (row.entityType === 'trip') {
        const value = await offlineDb.trips.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'trip', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedTrip({ ...asLocalTripRecord(value), sync_id: row.entityId }) })
      } else if (row.entityType === 'day') {
        const value = await offlineDb.days.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'day', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedDay(value as LocalDayRecord) })
      } else if (row.entityType === 'dayNote') {
        const value = await offlineDb.dayNotes.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'dayNote', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedDayNote(value) })
      } else if (row.entityType === 'category') {
        const value = await offlineDb.categories.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'category', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedCategory(value as LocalCategoryRecord) })
      } else if (row.entityType === 'collection') {
        const value = await offlineDb.collections.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'collection', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedCollection(value as LocalCollectionRecord) })
      } else if (row.entityType === 'collectionPlace') {
        const value = await offlineDb.collectionPlaces.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'collectionPlace', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedCollectionPlace(value as LocalCollectionPlaceRecord) })
      } else if (row.entityType === 'journey') {
        const value = await offlineDb.journeys.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'journey', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedJourney(value) })
      } else if (row.entityType === 'journeyEntry') {
        const value = await offlineDb.journeyEntries.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'journeyEntry', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedJourneyEntry(value) })
      } else if (row.entityType === 'place') {
        const value = await offlineDb.places.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'place', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedPlace(value as LocalPlaceRecord) })
      } else if (row.entityType === 'assignment') {
        const value = await offlineDb.assignments.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'assignment', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedAssignment(value as LocalAssignmentRecord) })
      } else if (row.entityType === 'accommodation') {
        const value = await offlineDb.accommodations.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'accommodation', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedAccommodation(value as LocalAccommodationRecord) })
      } else if (row.entityType === 'reservation') {
        const value = await offlineDb.reservations.where('sync_id').equals(row.entityId).first(); if (!value) continue
        const days = await offlineDb.days.where('trip_id').equals(value.trip_id).toArray()
        changes.push({ entityType: 'reservation', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedReservation(value as LocalReservationRecord, new Map(days.map(day => [day.id, day.sync_id!]))) })
      } else if (row.entityType === 'budgetItem') {
        const value = await offlineDb.budgetItems.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'budgetItem', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedBudgetItem(value as LocalBudgetItemRecord) })
      } else if (row.entityType === 'todo') {
        const value = await offlineDb.todoItems.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'todo', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedTodo(value as LocalTodoRecord) })
      } else if (row.entityType === 'packingBag') {
        const value = await offlineDb.packingBags.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'packingBag', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedPackingBag(value as LocalPackingBagRecord) })
      } else if (row.entityType === 'packingItem') {
        const value = await offlineDb.packingItems.where('sync_id').equals(row.entityId).first(); if (!value) continue
        changes.push({ entityType: 'packingItem', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedPackingItem(value as LocalPackingItemRecord) })
      } else if (row.entityType === 'vacay') {
        const value = await offlineDb.vacayData.get(VACAY_SYNC_ID); if (!value) continue
        changes.push({ entityType: 'vacay', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedVacay(value) })
      } else if (row.entityType === 'atlas') {
        const value = await offlineDb.atlasData.get(row.entityId); if (!value) continue
        changes.push({ entityType: 'atlas', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: value })
      } else if (row.entityType === 'packingConfig') {
        const value = await offlineDb.packingConfig.get('personal-packing'); if (!value) continue
        changes.push({ entityType: 'packingConfig', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedPackingConfig(value) })
      } else if (row.entityType === 'tripFile') {
        const value = await offlineDb.tripFiles.where('sync_id').equals(row.entityId).first() as LocalTripFileRecord | undefined; if (!value) continue
        changes.push({ entityType: 'tripFile', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedTripFile(value) })
      }
    }
    const order = { trip: 0, day: 1, dayNote: 2, category: 2, collection: 2, place: 3, collectionPlace: 4, journey: 5, journeyEntry: 6, assignment: 4, accommodation: 5, reservation: 6, budgetItem: 7, todo: 7, packingBag: 7, packingItem: 8, tripFile: 9, packingConfig: 10, vacay: 10, atlas: 10 } as const
    const queued = new Map(outbox.map(row => [row.key, row]))
    return changes.map(change => {
      const row = queued.get(syncEntityKey(change.entityType, change.entityId))
      return { ...change, offline: Boolean(row?.offline || row?.attempts), changedAt: row?.changedAt }
    }).sort((a, b) => order[a.entityType] - order[b.entityType])
  }

  /** Supabase LWW flow: durable local writes first, then cloud incrementals. */
  private async syncLastWriteWins(previousCursor: string | null): Promise<SyncRunResult> {
    const changes = await this.collectLocalChanges()
    if (changes.length > 0) {
      for (const change of changes.filter(item => item.entityType === 'tripFile' && item.operation === 'upsert')) {
        const metadata = change.payload as SyncedTripFile
        const body = await offlineDb.tripFileBlobs.get(change.entityId)
        if (!body) throw new Error(`Attachment ${metadata.originalName} is not available on this device`)
        if (!this.provider.uploadAttachment) throw new Error('The sync provider does not support attachments')
        await this.provider.uploadAttachment(metadata.storagePath, body.blob, metadata.mimeType)
      }
      for (const change of changes) await offlineDb.syncOutbox.update(syncEntityKey(change.entityType, change.entityId), { status: 'syncing' })
      const pushed = await this.provider.push(changes, previousCursor)
      await offlineDb.transaction('rw', [offlineDb.syncOutbox, offlineDb.entitySyncMeta, offlineDb.syncConflicts], async () => {
        for (const change of changes) {
          const key = syncEntityKey(change.entityType, change.entityId)
          const pending = await offlineDb.syncOutbox.get(key)
          if (pending?.status === 'syncing') await offlineDb.syncOutbox.delete(key)
          await offlineDb.syncConflicts.delete(key)
          await offlineDb.entitySyncMeta.put({
            key, entityType: change.entityType, entityId: change.entityId,
            status: pending?.status === 'pending' ? 'pending' : 'synced',
            remoteVersion: pushed.versions[change.entityId] ?? null, lastSyncedAt: Date.now(), lastError: null,
          })
        }
      })
    }

    // Pull from the device's previous cursor, not the post-push cursor: this
    // downloads our server-stamped revisions plus any concurrent device writes.
    const remote = await this.provider.pull(previousCursor)
    const order = { trip: 0, day: 1, dayNote: 2, category: 2, collection: 2, place: 3, collectionPlace: 4, journey: 5, journeyEntry: 6, assignment: 4, accommodation: 5, reservation: 6, budgetItem: 7, todo: 7, packingBag: 7, packingItem: 8, tripFile: 9, packingConfig: 10, vacay: 10, atlas: 10 } as const
    const ordered = [...remote.changes].sort((a, b) => order[a.entityType] - order[b.entityType])
    let pulled = 0
    for (const change of ordered) {
      const result = await this.applyRemote(change)
      if (result === 'applied') pulled++
    }
    await offlineDb.syncState.put({
      providerId: this.provider.id, cursor: remote.cursor, lastSyncAt: Date.now(), lastError: null, status: 'idle',
    })
    return { pulled, pushed: changes.length, conflicts: 0, cursor: remote.cursor }
  }

  async sync(): Promise<SyncRunResult> {
    // A provider may switch to another workspace-scoped IndexedDB connection.
    // Read the cursor only after connect, never from the prior workspace.
    let previous: SyncStateRecord | undefined
    try {
      await this.provider.connect()
      previous = await offlineDb.syncState.get(this.provider.id)
      await offlineDb.syncState.put({
        providerId: this.provider.id,
        cursor: previous?.cursor ?? null,
        lastSyncAt: previous?.lastSyncAt ?? null,
        lastError: null,
        status: 'syncing',
      })
      if (this.provider.syncMode === 'last-write-wins') return await this.syncLastWriteWins(previous?.cursor ?? null)
      // Pull before push. Store the observed head before pushing so a retry after
      // a non-fast-forward starts from the exact remote version we merged.
      const remote = await this.provider.pull(previous?.cursor)
      let pulled = 0
      let conflicts = 0
      const dependencyOrder = { trip: 0, day: 1, dayNote: 2, category: 2, collection: 2, place: 3, collectionPlace: 4, journey: 5, journeyEntry: 6, assignment: 4, accommodation: 5, reservation: 6, budgetItem: 7, todo: 7, packingBag: 7, packingItem: 8, tripFile: 9, packingConfig: 10, vacay: 10, atlas: 10 } as const
      const orderedRemoteChanges = [...remote.changes].sort(
        (a, b) => dependencyOrder[a.entityType] - dependencyOrder[b.entityType],
      )
      for (const change of orderedRemoteChanges) {
        const result = await this.applyRemote(change)
        if (result === 'applied') pulled++
        if (result === 'conflict') conflicts++
      }
      await offlineDb.syncState.update(this.provider.id, { cursor: remote.cursor })

      const outbox = await offlineDb.syncOutbox
        .filter(row => row.status === 'pending' || row.status === 'error')
        .sortBy('changedAt')
      const changes: LocalChange[] = []
      for (const row of outbox) {
        const meta = await offlineDb.entitySyncMeta.get(row.key)
        if (row.entityType === 'trip') {
          const trip = await offlineDb.trips.where('sync_id').equals(row.entityId).first()
          if (!trip) continue
          changes.push({
            entityType: row.entityType,
            entityId: row.entityId,
            operation: row.operation,
            baseVersion: meta?.remoteVersion,
            payload: row.operation === 'upsert'
              ? toSyncedTrip({ ...asLocalTripRecord(trip), sync_id: row.entityId })
              : undefined,
          })
        } else if (row.entityType === 'day') {
          const day = await offlineDb.days.where('sync_id').equals(row.entityId).first()
          if (!day) continue
          changes.push({
            entityType: row.entityType,
            entityId: row.entityId,
            operation: row.operation,
            baseVersion: meta?.remoteVersion,
            payload: toSyncedDay(day as LocalDayRecord),
          })
        } else if (row.entityType === 'category') {
          const category = await offlineDb.categories.where('sync_id').equals(row.entityId).first()
          if (!category) continue
          changes.push({ entityType: 'category', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedCategory(category as LocalCategoryRecord) })
        } else if (row.entityType === 'collection') {
          const value = await offlineDb.collections.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'collection', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedCollection(value as LocalCollectionRecord) })
        } else if (row.entityType === 'collectionPlace') {
          const value = await offlineDb.collectionPlaces.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'collectionPlace', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedCollectionPlace(value as LocalCollectionPlaceRecord) })
        } else if (row.entityType === 'journey') {
          const value = await offlineDb.journeys.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'journey', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedJourney(value) })
        } else if (row.entityType === 'journeyEntry') {
          const value = await offlineDb.journeyEntries.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'journeyEntry', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedJourneyEntry(value) })
        } else if (row.entityType === 'place') {
          const place = await offlineDb.places.where('sync_id').equals(row.entityId).first()
          if (!place) continue
          changes.push({
            entityType: 'place', entityId: row.entityId, operation: row.operation,
            baseVersion: meta?.remoteVersion, payload: toSyncedPlace(place as LocalPlaceRecord),
          })
        } else if (row.entityType === 'assignment') {
          const assignment = await offlineDb.assignments.where('sync_id').equals(row.entityId).first()
          if (!assignment) continue
          changes.push({
            entityType: 'assignment', entityId: row.entityId, operation: row.operation,
            baseVersion: meta?.remoteVersion, payload: toSyncedAssignment(assignment as LocalAssignmentRecord),
          })
        } else if (row.entityType === 'accommodation') {
          const value = await offlineDb.accommodations.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'accommodation', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedAccommodation(value as LocalAccommodationRecord) })
        } else if (row.entityType === 'reservation') {
          const value = await offlineDb.reservations.where('sync_id').equals(row.entityId).first(); if (!value) continue
          const days = await offlineDb.days.where('trip_id').equals(value.trip_id).toArray()
          changes.push({ entityType: 'reservation', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedReservation(value as LocalReservationRecord, new Map(days.map(day => [day.id, day.sync_id!]))) })
        } else if (row.entityType === 'budgetItem') {
          const value = await offlineDb.budgetItems.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'budgetItem', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedBudgetItem(value as LocalBudgetItemRecord) })
        } else if (row.entityType === 'todo') {
          const value = await offlineDb.todoItems.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'todo', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedTodo(value as LocalTodoRecord) })
        } else if (row.entityType === 'packingBag') {
          const value = await offlineDb.packingBags.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'packingBag', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedPackingBag(value as LocalPackingBagRecord) })
        } else if (row.entityType === 'packingItem') {
          const value = await offlineDb.packingItems.where('sync_id').equals(row.entityId).first(); if (!value) continue
          changes.push({ entityType: 'packingItem', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedPackingItem(value as LocalPackingItemRecord) })
        } else if (row.entityType === 'vacay') {
          const value = await offlineDb.vacayData.get(VACAY_SYNC_ID); if (!value) continue
          changes.push({ entityType: 'vacay', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedVacay(value) })
        } else if (row.entityType === 'packingConfig') {
          const value = await offlineDb.packingConfig.get('personal-packing'); if (!value) continue
          changes.push({ entityType: 'packingConfig', entityId: row.entityId, operation: row.operation, baseVersion: meta?.remoteVersion, payload: toSyncedPackingConfig(value) })
        }
      }
      changes.sort((a, b) => dependencyOrder[a.entityType] - dependencyOrder[b.entityType])

      const pushed = changes.length
      let cursor = remote.cursor
      if (changes.length > 0) {
        for (const change of changes) await offlineDb.syncOutbox.update(syncEntityKey(change.entityType, change.entityId), { status: 'syncing' })
        const result = await this.provider.push(changes, remote.cursor)
        cursor = result.cursor
        await offlineDb.transaction('rw', [offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
          for (const change of changes) {
            const key = syncEntityKey(change.entityType, change.entityId)
            await offlineDb.syncOutbox.delete(key)
            await offlineDb.entitySyncMeta.put({
              key,
              entityType: change.entityType,
              entityId: change.entityId,
              status: 'synced',
              remoteVersion: result.versions[change.entityId] ?? null,
              lastSyncedAt: Date.now(),
              lastError: null,
            })
          }
        })
      }

      await offlineDb.syncState.put({
        providerId: this.provider.id,
        cursor,
        lastSyncAt: Date.now(),
        lastError: null,
        status: 'idle',
      })
      return { pulled, pushed, conflicts, cursor }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await offlineDb.syncOutbox.where('status').equals('syncing').modify(row => {
        row.status = 'error'
        row.attempts += 1
        row.lastError = message
      })
      await offlineDb.syncState.put({
        providerId: this.provider.id,
        cursor: (await offlineDb.syncState.get(this.provider.id))?.cursor ?? null,
        lastSyncAt: previous?.lastSyncAt ?? null,
        lastError: message,
        status: 'error',
      })
      throw error
    } finally {
      await this.provider.disconnect().catch(() => {})
    }
  }
}
