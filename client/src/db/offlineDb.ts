import Dexie, { type Table } from 'dexie';
import type { Trip, Day, Place, TodoItem, BudgetItem, Reservation, TripFile, Accommodation, TripMember, Tag, Category } from '../types';
import type { LocalTripRecord, StoredTripRecord } from '../domain/tripSyncModel';
import type { LocalDayRecord, StoredDayRecord } from '../domain/daySyncModel';
import type { LocalDayNoteRecord } from '../domain/dayNoteSyncModel';
import type { LocalPlaceRecord, StoredPlaceRecord } from '../domain/placeSyncModel';
import type { LocalAssignmentRecord, StoredAssignmentRecord } from '../domain/assignmentSyncModel';
import type { LocalAccommodationRecord, StoredAccommodationRecord } from '../domain/accommodationSyncModel';
import type { LocalReservationRecord, StoredReservationRecord } from '../domain/reservationSyncModel';
import type { LocalBudgetItemRecord, StoredBudgetItemRecord } from '../domain/budgetSyncModel';
import type { LocalTodoRecord, StoredTodoRecord } from '../domain/todoSyncModel';
import type { LocalPackingConfigRecord, LocalPackingItemRecord, StoredPackingBagRecord, StoredPackingItemRecord } from '../domain/packingSyncModel';
import type { LocalVacayRecord } from '../domain/vacaySyncModel';
import type { LocalTripFileRecord, StoredTripFileRecord } from '../domain/tripFileSyncModel';
import type { HolidayCacheRecord } from '../services/holiday/types';
import type {
  EntitySyncMetaRecord,
  SyncConflictRecord,
  SyncOutboxRecord,
  SyncStateRecord,
} from '../sync/types';
import { randomId } from '../utils/randomId';

/** TripMember enriched with tripId so we can index by trip. */
export interface CachedTripMember extends TripMember {
  tripId: number;
}

// ── Queue + sync types ────────────────────────────────────────────────────────

// 'conflict' is terminal-until-resolved: the server rejected the replay because
// the entity changed underneath the offline edit (#1135 ask 3). It is surfaced
// to the user for a keep-mine / keep-theirs decision rather than dropped.
export type MutationStatus = 'pending' | 'syncing' | 'failed' | 'conflict';

export interface QueuedMutation {
  /** UUID — also used as X-Idempotency-Key sent to the server */
  id: string;
  tripId: number;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: unknown;
  createdAt: number;
  status: MutationStatus;
  attempts: number;
  lastError: string | null;
  /** Dexie table name to write the server response into after flush (e.g. 'places') */
  resource?: string;
  /** For CREATE mutations enqueued offline: the temporary negative id written to Dexie */
  tempId?: number;
  /** For DELETE mutations: the entity id to remove from Dexie on flush */
  entityId?: number;
  /**
   * For PUT/DELETE enqueued offline against a still-unsynced (negative-id) entity:
   * the temp id of the target. The url carries an `{id}` placeholder that the
   * mutation queue rewrites to the real server id once the dependent CREATE flushes.
   */
  tempEntityId?: number;
  /**
   * Optimistic-concurrency token: the entity's `updated_at` at the moment the
   * offline edit was made. Sent as `X-Base-Updated-At` on replay so the server
   * can reject the write (409) if someone else changed the entity in the
   * meantime. Absent for creates and for resources without a token.
   */
  baseUpdatedAt?: string | null;
  /**
   * Set when the replay came back 409: the server's current version of the
   * entity, kept so the conflict resolver can show "theirs" beside "mine"
   * (which is reconstructed from `body`). Only present while status==='conflict'.
   */
  conflictServer?: unknown;
  /** When the conflict was detected (for ordering / display). */
  conflictAt?: number;
  /**
   * When the row was marked 'syncing'. Only meaningful while it is — the flush
   * that set it clears the row on success or moves it off 'syncing' on failure.
   * A stamp that outlives its flush is how a killed tab is recognised on the
   * next one (see mutationQueue's STUCK_SYNCING_MS).
   */
  syncingSince?: number;
}

export interface SyncMeta {
  tripId: number;
  lastSyncedAt: number | null;
  status: 'idle' | 'syncing' | 'error';
  /** Bounding box [minLng, minLat, maxLng, maxLat] of pre-downloaded map tiles */
  tilesBbox: [number, number, number, number] | null;
  /** Non-photo files available offline for this trip after the last sync. */
  filesCachedCount: number;
}

export interface BlobCacheEntry {
  /** Relative URL, e.g. "/api/files/42/download" */
  url: string;
  /**
   * Trip this blob belongs to, so it is evicted together with the trip in
   * clearTripData. Legacy rows cached before v3 carry the sentinel -1.
   */
  tripId: number;
  blob: Blob;
  /** Byte size captured at insert time — Blob.size is not reliably preserved
   *  across IndexedDB round-trips, so the LRU budget reads this instead. */
  bytes: number;
  mime: string;
  cachedAt: number;
}

/** An uploaded booking-import source file, kept so the review flow can attach it to the
 *  created bookings even after a page reload during the (background) parse. Keyed by job. */
export interface ImportSourceFile {
  jobId: string;
  fileName: string;
  blob: Blob;
  createdAt: number;
}

/** Small durable flags that belong to the local database itself. */
export interface AppMeta {
  key: string;
  value: string;
}

export interface TripFileBlobRecord {
  syncId: string;
  blob: Blob;
  mime: string;
  bytes: number;
  updatedAt: number;
}

// ── Dexie class ────────────────────────────────────────────────────────────────

/**
 * The offline DB is scoped per user so that one account can never read another
 * account's cached data on a shared device. Anonymous (logged-out) state uses
 * the base name; a logged-in user uses `trek-offline-u<userId>`.
 */
const ANON_DB_NAME = 'trek-offline';

function userDbName(userId: number | string): string {
  return `trek-offline-u${userId}`;
}

/**
 * Best-effort read of the persisted auth snapshot so the very first DB opened on
 * app load (before loadUser resolves) is already the correct per-user one — the
 * PWA can render cached data offline without leaking across users.
 */
function initialDbName(): string {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('trek_auth_snapshot') : null;
    if (!raw) return ANON_DB_NAME;
    const id = JSON.parse(raw)?.state?.user?.id;
    return id != null ? userDbName(id) : ANON_DB_NAME;
  } catch {
    return ANON_DB_NAME;
  }
}

class TrekOfflineDb extends Dexie {
  trips!: Table<StoredTripRecord, number>;
  days!: Table<StoredDayRecord, number>;
  dayNotes!: Table<LocalDayNoteRecord, number>;
  places!: Table<StoredPlaceRecord, number>;
  assignments!: Table<StoredAssignmentRecord, number>;
  packingItems!: Table<StoredPackingItemRecord, number>;
  packingBags!: Table<StoredPackingBagRecord, number>;
  packingConfig!: Table<LocalPackingConfigRecord, string>;
  todoItems!: Table<StoredTodoRecord, number>;
  vacayData!: Table<LocalVacayRecord, string>;
  holidayCache!: Table<HolidayCacheRecord, string>;
  budgetItems!: Table<StoredBudgetItemRecord, number>;
  reservations!: Table<StoredReservationRecord, number>;
  tripFiles!: Table<StoredTripFileRecord, number>;
  tripFileBlobs!: Table<TripFileBlobRecord, string>;
  accommodations!: Table<StoredAccommodationRecord, number>;
  tripMembers!: Table<CachedTripMember, [number, number]>;
  tags!: Table<Tag, number>;
  categories!: Table<Category, number>;
  mutationQueue!: Table<QueuedMutation, string>;
  syncMeta!: Table<SyncMeta, number>;
  blobCache!: Table<BlobCacheEntry, string>;
  importFiles!: Table<ImportSourceFile, [string, string]>;
  appMeta!: Table<AppMeta, string>;
  syncOutbox!: Table<SyncOutboxRecord, string>;
  entitySyncMeta!: Table<EntitySyncMetaRecord, string>;
  syncState!: Table<SyncStateRecord, string>;
  syncConflicts!: Table<SyncConflictRecord, string>;

  constructor(name: string = ANON_DB_NAME) {
    super(name);

    this.version(1).stores({
      trips:        'id',
      days:         'id, trip_id',
      places:       'id, trip_id',
      packingItems: 'id, trip_id',
      todoItems:    'id, trip_id',
      budgetItems:  'id, trip_id',
      reservations: 'id, trip_id',
      tripFiles:    'id, trip_id',
      mutationQueue:'id, tripId, status, createdAt',
      syncMeta:     'tripId',
      blobCache:    'url, cachedAt',
    });

    this.version(2).stores({
      accommodations: 'id, trip_id',
      tripMembers:    '[tripId+id], tripId',
      tags:           'id',
      categories:     'id',
    });

    // v3: scope the blob cache by trip so it can be evicted with the trip and
    // bounded by an LRU budget (see enforceBlobBudget).
    this.version(3).stores({
      blobCache: 'url, cachedAt, tripId',
    }).upgrade(async (tx) => {
      await tx.table('blobCache').toCollection().modify((row: Partial<BlobCacheEntry>) => {
        if (row.tripId == null) row.tripId = -1;
        if (row.bytes == null) row.bytes = row.blob?.size ?? 0;
      });
    });

    // v4: durable store for booking-import source files (survives a reload mid-parse).
    this.version(4).stores({
      importFiles: '[jobId+fileName], jobId, createdAt',
    });

    // v5: local-only lifecycle markers (currently used to make the development
    // seed a one-time operation, even after the user deletes its trip).
    this.version(5).stores({
      appMeta: 'key',
    });

    // v6: local-first Trip identity plus provider-neutral sync bookkeeping.
    // Existing numeric ids remain the local compatibility key while every row
    // gains a stable UUID used by GitHub and future cloud providers.
    this.version(6).stores({
      trips: 'id, &sync_id, deleted_at, updated_at',
      syncOutbox: 'key, [entityType+entityId], status, changedAt',
      entitySyncMeta: 'key, [entityType+entityId], status',
      syncState: 'providerId, status',
      syncConflicts: 'key, [entityType+entityId], detectedAt',
      syncProviderConfig: 'providerId',
      syncCredentials: 'providerId',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      await tx.table('trips').toCollection().modify((row: Partial<LocalTripRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
      });
      const trips = await tx.table('trips').toArray() as LocalTripRecord[];
      await tx.table('syncOutbox').bulkPut(trips.map(trip => ({
        key: `trip:${trip.sync_id}`,
        entityType: 'trip',
        entityId: trip.sync_id,
        operation: trip.deleted_at ? 'delete' : 'upsert',
        changedAt: Date.parse(trip.updated_at) || Date.now(),
        status: 'pending',
        attempts: 0,
        lastError: null,
      })));
      await tx.table('entitySyncMeta').bulkPut(trips.map(trip => ({
        key: `trip:${trip.sync_id}`,
        entityType: 'trip',
        entityId: trip.sync_id,
        status: 'pending',
        remoteVersion: null,
        lastSyncedAt: null,
        lastError: null,
      })));
    });

    // v7: local-first Day identity and parent UUID. Existing numeric ids stay
    // as compatibility keys until all itinerary children have migrated.
    this.version(7).stores({
      days: 'id, &sync_id, trip_id, trip_sync_id, [trip_sync_id+day_number], deleted_at, updated_at',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const trips = await tx.table('trips').toArray() as LocalTripRecord[];
      const tripSyncIds = new Map(trips.map(trip => [trip.id, trip.sync_id]));
      await tx.table('days').toCollection().modify((row: Partial<LocalDayRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripSyncIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
      });
      const days = await tx.table('days').toArray() as LocalDayRecord[];
      const syncableDays = days.filter(day => !day.trip_sync_id.startsWith('orphan:'));
      await tx.table('syncOutbox').bulkPut(syncableDays.map(day => ({
        key: `day:${day.sync_id}`,
        entityType: 'day',
        entityId: day.sync_id,
        operation: day.deleted_at ? 'delete' : 'upsert',
        changedAt: Date.parse(day.updated_at) || Date.now(),
        status: 'pending',
        attempts: 0,
        lastError: null,
      })));
      await tx.table('entitySyncMeta').bulkPut(days.map(day => ({
        key: `day:${day.sync_id}`,
        entityType: 'day',
        entityId: day.sync_id,
        status: day.trip_sync_id.startsWith('orphan:') ? 'error' : 'pending',
        remoteVersion: null,
        lastSyncedAt: null,
        lastError: day.trip_sync_id.startsWith('orphan:') ? 'Parent Trip was not found during migration' : null,
      })));
    });

    // v8: Place becomes a local-first Trip child and Assignment becomes a
    // first-class table instead of a projection embedded in cached Day rows.
    this.version(8).stores({
      places: 'id, &sync_id, trip_id, trip_sync_id, deleted_at, updated_at',
      assignments: 'id, &sync_id, trip_id, trip_sync_id, day_id, day_sync_id, place_id, place_sync_id, [day_sync_id+order_index], deleted_at, updated_at',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const trips = await tx.table('trips').toArray() as LocalTripRecord[];
      const days = await tx.table('days').toArray() as LocalDayRecord[];
      const tripSyncIds = new Map(trips.map(trip => [trip.id, trip.sync_id]));
      const dayById = new Map(days.map(day => [day.id, day]));

      await tx.table('places').toCollection().modify((row: Partial<LocalPlaceRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripSyncIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
      });
      const places = await tx.table('places').toArray() as LocalPlaceRecord[];
      const placeById = new Map(places.map(place => [place.id, place]));

      const embedded = new Map<number, LocalAssignmentRecord>();
      for (const day of days) {
        for (const assignment of day.assignments ?? []) {
          if (embedded.has(assignment.id)) continue;
          const place = placeById.get(assignment.place_id);
          embedded.set(assignment.id, {
            ...assignment,
            trip_id: day.trip_id,
            sync_id: randomId(),
            trip_sync_id: day.trip_sync_id,
            day_sync_id: day.sync_id,
            place_sync_id: place?.sync_id || `orphan:${assignment.place_id}`,
            created_at: assignment.created_at || now,
            updated_at: assignment.created_at || now,
            deleted_at: null,
          });
        }
      }
      if (embedded.size > 0) await tx.table('assignments').bulkPut([...embedded.values()]);
      await tx.table('days').toCollection().modify((row: LocalDayRecord) => { delete row.assignments });

      const assignments = await tx.table('assignments').toArray() as LocalAssignmentRecord[];
      const placeSyncable = (place: LocalPlaceRecord) => !place.trip_sync_id.startsWith('orphan:');
      const assignmentSyncable = (assignment: LocalAssignmentRecord) =>
        !assignment.trip_sync_id.startsWith('orphan:') &&
        !assignment.day_sync_id.startsWith('orphan:') &&
        !assignment.place_sync_id.startsWith('orphan:') &&
        dayById.has(assignment.day_id);

      await tx.table('syncOutbox').bulkPut([
        ...places.filter(placeSyncable).map(place => ({
          key: `place:${place.sync_id}`, entityType: 'place', entityId: place.sync_id,
          operation: place.deleted_at ? 'delete' : 'upsert', changedAt: Date.parse(place.updated_at) || Date.now(),
          status: 'pending', attempts: 0, lastError: null,
        })),
        ...assignments.filter(assignmentSyncable).map(assignment => ({
          key: `assignment:${assignment.sync_id}`, entityType: 'assignment', entityId: assignment.sync_id,
          operation: assignment.deleted_at ? 'delete' : 'upsert', changedAt: Date.parse(assignment.updated_at) || Date.now(),
          status: 'pending', attempts: 0, lastError: null,
        })),
      ]);
      await tx.table('entitySyncMeta').bulkPut([
        ...places.map(place => ({
          key: `place:${place.sync_id}`, entityType: 'place', entityId: place.sync_id,
          status: placeSyncable(place) ? 'pending' : 'error', remoteVersion: null, lastSyncedAt: null,
          lastError: placeSyncable(place) ? null : 'Parent Trip was not found during migration',
        })),
        ...assignments.map(assignment => ({
          key: `assignment:${assignment.sync_id}`, entityType: 'assignment', entityId: assignment.sync_id,
          status: assignmentSyncable(assignment) ? 'pending' : 'error', remoteVersion: null, lastSyncedAt: null,
          lastError: assignmentSyncable(assignment) ? null : 'Assignment relation was not found during migration',
        })),
      ]);
    });

    // v9: Reservation and Accommodation become local-first, preserving numeric
    // ids only as UI compatibility keys and exporting UUID relationships.
    this.version(9).stores({
      reservations: 'id, &sync_id, trip_id, trip_sync_id, day_id, day_sync_id, accommodation_id, accommodation_sync_id, deleted_at, updated_at',
      accommodations: 'id, &sync_id, trip_id, trip_sync_id, place_sync_id, start_day_sync_id, end_day_sync_id, deleted_at, updated_at',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const [trips, days, places, assignments] = await Promise.all([
        tx.table('trips').toArray() as Promise<LocalTripRecord[]>,
        tx.table('days').toArray() as Promise<LocalDayRecord[]>,
        tx.table('places').toArray() as Promise<LocalPlaceRecord[]>,
        tx.table('assignments').toArray() as Promise<LocalAssignmentRecord[]>,
      ]);
      const tripIds = new Map(trips.map(row => [row.id, row.sync_id]));
      const dayIds = new Map(days.map(row => [row.id, row.sync_id]));
      const placeIds = new Map(places.map(row => [row.id, row.sync_id]));
      const assignmentIds = new Map(assignments.map(row => [row.id, row.sync_id]));

      await tx.table('accommodations').toCollection().modify((row: Partial<LocalAccommodationRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (row.place_sync_id === undefined) row.place_sync_id = row.place_id == null ? null : placeIds.get(Number(row.place_id)) || `orphan:${row.place_id}`;
        if (!row.start_day_sync_id) row.start_day_sync_id = dayIds.get(Number(row.start_day_id)) || `orphan:${row.start_day_id}`;
        if (!row.end_day_sync_id) row.end_day_sync_id = dayIds.get(Number(row.end_day_id)) || `orphan:${row.end_day_id}`;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
      });
      const accommodations = await tx.table('accommodations').toArray() as LocalAccommodationRecord[];
      const accommodationIds = new Map(accommodations.map(row => [row.id, row.sync_id]));

      await tx.table('reservations').toCollection().modify((row: Partial<LocalReservationRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (row.day_sync_id === undefined) row.day_sync_id = row.day_id == null ? null : dayIds.get(Number(row.day_id)) || `orphan:${row.day_id}`;
        if (row.end_day_sync_id === undefined) row.end_day_sync_id = row.end_day_id == null ? null : dayIds.get(Number(row.end_day_id)) || `orphan:${row.end_day_id}`;
        if (row.place_sync_id === undefined) row.place_sync_id = row.place_id == null ? null : placeIds.get(Number(row.place_id)) || `orphan:${row.place_id}`;
        if (row.assignment_sync_id === undefined) row.assignment_sync_id = row.assignment_id == null ? null : assignmentIds.get(Number(row.assignment_id)) || `orphan:${row.assignment_id}`;
        if (row.accommodation_sync_id === undefined) row.accommodation_sync_id = row.accommodation_id == null ? null : accommodationIds.get(Number(row.accommodation_id)) || `orphan:${row.accommodation_id}`;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
      });
      const reservations = await tx.table('reservations').toArray() as LocalReservationRecord[];
      const valid = (values: Array<string | null | undefined>) => values.every(value => !value?.startsWith('orphan:'));
      const accommodationSyncable = (row: LocalAccommodationRecord) => valid([
        row.trip_sync_id, row.place_sync_id, row.start_day_sync_id, row.end_day_sync_id,
      ]);
      const reservationSyncable = (row: LocalReservationRecord) => valid([
        row.trip_sync_id, row.day_sync_id, row.end_day_sync_id, row.place_sync_id, row.assignment_sync_id, row.accommodation_sync_id,
      ]);
      const all = [
        ...accommodations.map(row => ({ row, type: 'accommodation', ok: accommodationSyncable(row) })),
        ...reservations.map(row => ({ row, type: 'reservation', ok: reservationSyncable(row) })),
      ];
      await tx.table('syncOutbox').bulkPut(all.filter(item => item.ok).map(({ row, type }) => ({
        key: `${type}:${row.sync_id}`, entityType: type, entityId: row.sync_id,
        operation: row.deleted_at ? 'delete' : 'upsert', changedAt: Date.parse(row.updated_at) || Date.now(),
        status: 'pending', attempts: 0, lastError: null,
      })));
      await tx.table('entitySyncMeta').bulkPut(all.map(({ row, type, ok }) => ({
        key: `${type}:${row.sync_id}`, entityType: type, entityId: row.sync_id,
        status: ok ? 'pending' : 'error', remoteVersion: null, lastSyncedAt: null,
        lastError: ok ? null : 'Reservation relation was not found during migration',
      })));
    });

    // v10: Expense/Budget items become local-first. User ids remain account
    // references in embedded member/payer snapshots; domain relationships use
    // stable UUIDs so the provider format is independent of local numeric ids.
    this.version(10).stores({
      budgetItems: 'id, &sync_id, trip_id, trip_sync_id, reservation_sync_id, place_sync_id, deleted_at, updated_at',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const [trips, reservations, places] = await Promise.all([
        tx.table('trips').toArray() as Promise<LocalTripRecord[]>,
        tx.table('reservations').toArray() as Promise<LocalReservationRecord[]>,
        tx.table('places').toArray() as Promise<LocalPlaceRecord[]>,
      ]);
      const tripIds = new Map(trips.map(row => [row.id, row.sync_id]));
      const reservationIds = new Map(reservations.map(row => [row.id, row.sync_id]));
      const placeIds = new Map(places.map(row => [row.id, row.sync_id]));
      await tx.table('budgetItems').toCollection().modify((row: Partial<LocalBudgetItemRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (row.reservation_sync_id === undefined) row.reservation_sync_id = row.reservation_id == null ? null : reservationIds.get(Number(row.reservation_id)) || `orphan:${row.reservation_id}`;
        if (row.place_sync_id === undefined) row.place_sync_id = row.place_id == null ? null : placeIds.get(Number(row.place_id)) || `orphan:${row.place_id}`;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
        if (!row.members) row.members = [];
        if (!row.payers) row.payers = [];
      });
      const rows = await tx.table('budgetItems').toArray() as LocalBudgetItemRecord[];
      const syncable = (row: LocalBudgetItemRecord) => [row.trip_sync_id, row.reservation_sync_id, row.place_sync_id]
        .every(value => !value?.startsWith('orphan:'));
      await tx.table('syncOutbox').bulkPut(rows.filter(syncable).map(row => ({
        key: `budgetItem:${row.sync_id}`, entityType: 'budgetItem', entityId: row.sync_id,
        operation: row.deleted_at ? 'delete' : 'upsert', changedAt: Date.parse(row.updated_at) || Date.now(),
        status: 'pending', attempts: 0, lastError: null,
      })));
      await tx.table('entitySyncMeta').bulkPut(rows.map(row => ({
        key: `budgetItem:${row.sync_id}`, entityType: 'budgetItem', entityId: row.sync_id,
        status: syncable(row) ? 'pending' : 'error', remoteVersion: null, lastSyncedAt: null,
        lastError: syncable(row) ? null : 'Budget item relation was not found during migration',
      })));
    });

    // v11: Todo becomes a local-first Trip child with provider-neutral UUIDs.
    this.version(11).stores({
      todoItems: 'id, &sync_id, trip_id, trip_sync_id, deleted_at, updated_at',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const trips = await tx.table('trips').toArray() as LocalTripRecord[];
      const tripIds = new Map(trips.map(row => [row.id, row.sync_id]));
      await tx.table('todoItems').toCollection().modify((row: Partial<LocalTodoRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
        if (row.assigned_user_name === undefined) row.assigned_user_name = null;
      });
      const rows = await tx.table('todoItems').toArray() as LocalTodoRecord[];
      const valid = (row: LocalTodoRecord) => !row.trip_sync_id.startsWith('orphan:');
      await tx.table('syncOutbox').bulkPut(rows.filter(valid).map(row => ({
        key: `todo:${row.sync_id}`, entityType: 'todo', entityId: row.sync_id,
        operation: row.deleted_at ? 'delete' : 'upsert', changedAt: Date.parse(row.updated_at) || Date.now(),
        status: 'pending', attempts: 0, lastError: null,
      })));
      await tx.table('entitySyncMeta').bulkPut(rows.map(row => ({
        key: `todo:${row.sync_id}`, entityType: 'todo', entityId: row.sync_id,
        status: valid(row) ? 'pending' : 'error', remoteVersion: null, lastSyncedAt: null,
        lastError: valid(row) ? null : 'Todo parent trip was not found during migration',
      })));
    });

    // v12: Packing items leave the legacy REST replay queue; bags receive their
    // own local table so item-to-bag relationships can use stable UUIDs.
    this.version(12).stores({
      packingItems: 'id, &sync_id, trip_id, trip_sync_id, bag_sync_id, deleted_at, updated_at',
      packingBags: 'id, &sync_id, trip_id, trip_sync_id, deleted_at, updated_at',
      packingConfig: 'id, updated_at',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const trips = await tx.table('trips').toArray() as LocalTripRecord[];
      const tripIds = new Map(trips.map(row => [row.id, row.sync_id]));
      await tx.table('packingItems').toCollection().modify((row: Partial<LocalPackingItemRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (row.bag_sync_id === undefined) row.bag_sync_id = null;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
      });
      const rows = await tx.table('packingItems').toArray() as LocalPackingItemRecord[];
      const valid = (row: LocalPackingItemRecord) => !row.trip_sync_id.startsWith('orphan:');
      await tx.table('syncOutbox').bulkPut(rows.filter(valid).map(row => ({
        key: `packingItem:${row.sync_id}`, entityType: 'packingItem', entityId: row.sync_id,
        operation: row.deleted_at ? 'delete' : 'upsert', changedAt: Date.parse(row.updated_at) || Date.now(),
        status: 'pending', attempts: 0, lastError: null,
      })));
      await tx.table('entitySyncMeta').bulkPut(rows.map(row => ({
        key: `packingItem:${row.sync_id}`, entityType: 'packingItem', entityId: row.sync_id,
        status: valid(row) ? 'pending' : 'error', remoteVersion: null, lastSyncedAt: null,
        lastError: valid(row) ? null : 'Packing item parent trip was not found during migration',
      })));
    });

    // v13: the personal Vacay calendar is a small non-Trip aggregate. Public and
    // school-holiday responses remain replaceable online-service caches.
    this.version(13).stores({
      vacayData: 'id, updated_at, deleted_at',
    });

    // v14: replaceable online-service cache for official Chinese holiday and
    // makeup-workday exceptions. This is deliberately separate from Vacay sync.
    this.version(14).stores({
      holidayCache: 'key, [countryCode+year], status, lastCheckedAt',
    });

    // v15: Supabase Auth is now the only personal cloud identity and sync
    // provider. Destroy device-local GitHub repository/PAT storage and convert
    // any old manual conflicts back into the durable LWW outbox.
    this.version(15).stores({
      syncProviderConfig: null,
      syncCredentials: null,
    }).upgrade(async tx => {
      await tx.table('syncState').delete('github');
      await tx.table('syncConflicts').clear();
      await tx.table('syncOutbox').where('status').equals('conflict').modify(row => {
        row.status = 'pending';
        row.lastError = null;
      });
      await tx.table('entitySyncMeta').where('status').equals('conflict').modify(row => {
        row.status = 'pending';
        row.lastError = null;
      });
    });

    // v16: individual itinerary notes become first-class local-first records.
    // Existing embedded Day.notes_items are migrated without deleting user data.
    this.version(16).stores({
      dayNotes: 'id, &sync_id, trip_id, trip_sync_id, day_id, day_sync_id, deleted_at, updated_at',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const trips = await tx.table('trips').toArray() as LocalTripRecord[];
      const days = await tx.table('days').toArray() as LocalDayRecord[];
      const tripIds = new Map(trips.map(row => [row.id, row.sync_id]));
      const migrated: LocalDayNoteRecord[] = [];
      for (const day of days) {
        for (const note of day.notes_items ?? []) {
          migrated.push({
            ...note,
            trip_id: day.trip_id,
            sync_id: randomId(),
            trip_sync_id: day.trip_sync_id || tripIds.get(day.trip_id) || `orphan:${day.trip_id}`,
            day_sync_id: day.sync_id || `orphan:${day.id}`,
            created_at: note.created_at || now,
            updated_at: note.created_at || now,
            deleted_at: null,
          });
        }
      }
      if (migrated.length > 0) await tx.table('dayNotes').bulkPut(migrated);
      await tx.table('days').toCollection().modify((row: LocalDayRecord) => { delete row.notes_items });
      const valid = (row: LocalDayNoteRecord) => !row.trip_sync_id.startsWith('orphan:') && !row.day_sync_id.startsWith('orphan:');
      await tx.table('syncOutbox').bulkPut(migrated.filter(valid).map(row => ({
        key: `dayNote:${row.sync_id}`, entityType: 'dayNote', entityId: row.sync_id,
        operation: 'upsert', changedAt: Date.parse(row.updated_at) || Date.now(), status: 'pending', attempts: 0, lastError: null,
      })));
      await tx.table('entitySyncMeta').bulkPut(migrated.map(row => ({
        key: `dayNote:${row.sync_id}`, entityType: 'dayNote', entityId: row.sync_id,
        status: valid(row) ? 'pending' : 'error', remoteVersion: null, lastSyncedAt: null,
        lastError: valid(row) ? null : 'Day note relation was not found during migration',
      })));
    });

    // v17: one-time provider migration. Rows that were previously marked as
    // GitHub-synced must be uploaded to the user's Personal Workspace even
    // though they no longer have an outbox entry.
    this.version(17).stores({}).upgrade(async tx => {
      const groups = [
        ['trips', 'trip', 'sync_id'], ['days', 'day', 'sync_id'], ['dayNotes', 'dayNote', 'sync_id'],
        ['places', 'place', 'sync_id'], ['assignments', 'assignment', 'sync_id'],
        ['accommodations', 'accommodation', 'sync_id'], ['reservations', 'reservation', 'sync_id'],
        ['budgetItems', 'budgetItem', 'sync_id'], ['todoItems', 'todo', 'sync_id'],
        ['packingBags', 'packingBag', 'sync_id'], ['packingItems', 'packingItem', 'sync_id'],
        ['packingConfig', 'packingConfig', 'id'], ['vacayData', 'vacay', 'id'],
      ] as const;
      const outbox: SyncOutboxRecord[] = [];
      const meta: EntitySyncMetaRecord[] = [];
      for (const [tableName, entityType, idField] of groups) {
        const rows = await tx.table(tableName).toArray() as Array<Record<string, unknown>>;
        for (const row of rows) {
          const entityId = row[idField];
          const hasOrphan = Object.values(row).some(value => typeof value === 'string' && value.startsWith('orphan:'));
          if (typeof entityId !== 'string' || !entityId || hasOrphan) continue;
          const key = `${entityType}:${entityId}`;
          const deletedAt = typeof row.deleted_at === 'string' ? row.deleted_at : null;
          const updatedAt = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : Date.now();
          outbox.push({ key, entityType, entityId, operation: deletedAt ? 'delete' : 'upsert', changedAt: updatedAt || Date.now(), status: 'pending', attempts: 0, lastError: null });
          meta.push({ key, entityType, entityId, status: 'pending', remoteVersion: null, lastSyncedAt: null, lastError: null });
        }
      }
      await tx.table('syncOutbox').bulkPut(outbox);
      await tx.table('entitySyncMeta').bulkPut(meta);
      await tx.table('syncConflicts').clear();
      await tx.table('syncState').clear();
    });

    // v18: attachment metadata is a normal soft-deleted sync entity. Binary
    // bodies live in a durable, non-evicting table and are mirrored to private
    // Supabase Storage by the provider.
    this.version(18).stores({
      tripFiles: 'id, &sync_id, trip_id, trip_sync_id, place_sync_id, reservation_sync_id, deleted_at, updated_at',
      tripFileBlobs: 'syncId, updatedAt',
    }).upgrade(async tx => {
      const now = new Date().toISOString();
      const [trips, places, reservations] = await Promise.all([
        tx.table('trips').toArray() as Promise<LocalTripRecord[]>,
        tx.table('places').toArray() as Promise<LocalPlaceRecord[]>,
        tx.table('reservations').toArray() as Promise<LocalReservationRecord[]>,
      ]);
      const tripIds = new Map(trips.map(row => [row.id, row.sync_id]));
      const placeIds = new Map(places.map(row => [row.id, row.sync_id]));
      const reservationIds = new Map(reservations.map(row => [row.id, row.sync_id]));
      await tx.table('tripFiles').toCollection().modify((row: Partial<LocalTripFileRecord>) => {
        if (!row.sync_id) row.sync_id = randomId();
        if (!row.trip_sync_id) row.trip_sync_id = tripIds.get(Number(row.trip_id)) || `orphan:${row.trip_id}`;
        if (row.place_sync_id === undefined) row.place_sync_id = row.place_id == null ? null : placeIds.get(Number(row.place_id)) || `orphan:${row.place_id}`;
        if (row.reservation_sync_id === undefined) row.reservation_sync_id = row.reservation_id == null ? null : reservationIds.get(Number(row.reservation_id)) || `orphan:${row.reservation_id}`;
        if (!row.linked_place_sync_ids) row.linked_place_sync_ids = (row.linked_place_ids || []).flatMap(id => id == null ? [] : [placeIds.get(Number(id)) || `orphan:${id}`]);
        if (!row.linked_reservation_sync_ids) row.linked_reservation_sync_ids = (row.linked_reservation_ids || []).flatMap(id => id == null ? [] : [reservationIds.get(Number(id)) || `orphan:${id}`]);
        if (!row.storage_path) row.storage_path = `${row.trip_sync_id}/${row.sync_id}/${encodeURIComponent(row.original_name || row.filename || 'attachment')}`;
        if (!row.created_at) row.created_at = now;
        if (!row.updated_at) row.updated_at = row.created_at;
        if (row.deleted_at === undefined) row.deleted_at = null;
        if (row.purged_at === undefined) row.purged_at = null;
      });
      const rows = await tx.table('tripFiles').toArray() as LocalTripFileRecord[];
      for (const row of rows) {
        const legacyBlob = row.url ? await tx.table('blobCache').get(row.url) as BlobCacheEntry | undefined : undefined;
        if (legacyBlob?.blob) await tx.table('tripFileBlobs').put({ syncId: row.sync_id, blob: legacyBlob.blob, mime: legacyBlob.mime || row.mime_type, bytes: legacyBlob.bytes || legacyBlob.blob.size, updatedAt: Date.now() });
        const orphan = [row.trip_sync_id, row.place_sync_id, row.reservation_sync_id, ...row.linked_place_sync_ids, ...row.linked_reservation_sync_ids].some(value => value?.startsWith('orphan:'));
        const key = `tripFile:${row.sync_id}`;
        if (!orphan) await tx.table('syncOutbox').put({ key, entityType: 'tripFile', entityId: row.sync_id, operation: row.deleted_at ? 'delete' : 'upsert', changedAt: Date.parse(row.updated_at) || Date.now(), status: 'pending', attempts: 0, lastError: null });
        await tx.table('entitySyncMeta').put({ key, entityType: 'tripFile', entityId: row.sync_id, status: orphan ? 'error' : 'pending', remoteVersion: null, lastSyncedAt: null, lastError: orphan ? 'File relation was not found during migration' : null });
      }
    });
  }
}

// The live instance is swapped on login/logout via reopenForUser/reopenAnonymous.
// A Proxy keeps the exported `offlineDb` binding stable for the ~19 modules that
// import it directly, while every access forwards to the current connection.
let _db = new TrekOfflineDb(initialDbName());

export const offlineDb = new Proxy({} as TrekOfflineDb, {
  get(_target, prop) {
    const value = (_db as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(_db) : value;
  },
  set(_target, prop, value) {
    (_db as unknown as Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
}) as TrekOfflineDb;

async function switchTo(name: string): Promise<void> {
  if (_db.name === name) {
    if (!_db.isOpen()) await _db.open();
    return;
  }
  if (_db.isOpen()) _db.close();
  _db = new TrekOfflineDb(name);
  await _db.open();
}

/** Point the offline DB at a specific user's scoped database (call on login). */
export async function reopenForUser(userId: number | string): Promise<void> {
  await switchTo(userDbName(userId));
}

/** Point the offline DB at the anonymous database (call on logout). */
export async function reopenAnonymous(): Promise<void> {
  await switchTo(ANON_DB_NAME);
}

/**
 * Delete the current user's scoped database entirely and return to the anonymous
 * DB. Used on logout so no trace of the account's data remains on the device.
 */
export async function deleteCurrentUserDb(): Promise<void> {
  // Already anonymous: there is nothing to delete, and opening a second
  // connection to the same name would leak the current handle for the session.
  if (_db.name === ANON_DB_NAME) {
    await switchTo(ANON_DB_NAME);
    return;
  }
  try { await _db.delete(); } catch { /* ignore — fall through to anon */ }
  _db = new TrekOfflineDb(ANON_DB_NAME);
  await _db.open();
}

// ── Bulk upsert helpers ────────────────────────────────────────────────────────

export function asLocalTripRecord(trip: Trip | LocalTripRecord): LocalTripRecord {
  const now = new Date().toISOString();
  const current = trip as Partial<LocalTripRecord>;
  return {
    ...trip,
    sync_id: current.sync_id || randomId(),
    created_at: trip.created_at || now,
    updated_at: trip.updated_at || trip.created_at || now,
    deleted_at: current.deleted_at ?? null,
  } as LocalTripRecord;
}

export async function upsertTrip(trip: Trip | LocalTripRecord): Promise<void> {
  const existing = await offlineDb.trips.get(trip.id);
  await offlineDb.trips.put(asLocalTripRecord({ ...existing, ...trip } as LocalTripRecord));
}

export async function upsertDays(days: Day[]): Promise<void> {
  for (const day of days) {
    const { assignments: _assignments, ...dayFields } = day;
    const incoming = day as Day & { created_at?: string; updated_at?: string };
    const [existing, trip] = await Promise.all([
      offlineDb.days.get(day.id),
      offlineDb.trips.get(day.trip_id),
    ]);
    const now = new Date().toISOString();
    await offlineDb.days.put({
      ...existing,
      ...dayFields,
      sync_id: existing?.sync_id || randomId(),
      trip_sync_id: existing?.trip_sync_id || trip?.sync_id || `orphan:${day.trip_id}`,
      created_at: existing?.created_at || incoming.created_at || now,
      updated_at: incoming.updated_at || existing?.updated_at || incoming.created_at || now,
      deleted_at: existing?.deleted_at ?? null,
    });
  }
}

/** Preserve legacy Server bundle/WS compatibility while Assignment uses its own table. */
export async function upsertAssignmentsFromDays(days: Day[]): Promise<void> {
  for (const incomingDay of days) {
    const day = await offlineDb.days.get(incomingDay.id);
    if (!day?.sync_id || !day.trip_sync_id) continue;
    for (const incoming of incomingDay.assignments ?? []) {
      const { place: _placeProjection, ...fields } = incoming;
      const [existing, place] = await Promise.all([
        offlineDb.assignments.get(incoming.id),
        offlineDb.places.get(incoming.place_id),
      ]);
      const now = new Date().toISOString();
      await offlineDb.assignments.put({
        ...existing,
        ...fields,
        trip_id: day.trip_id,
        sync_id: existing?.sync_id || randomId(),
        trip_sync_id: day.trip_sync_id,
        day_sync_id: day.sync_id,
        place_sync_id: place?.sync_id || existing?.place_sync_id || `orphan:${incoming.place_id}`,
        created_at: existing?.created_at || incoming.created_at || now,
        updated_at: now,
        deleted_at: null,
      });
    }
  }
}

export async function upsertPlaces(places: Place[]): Promise<void> {
  for (const place of places) {
    const [existing, trip] = await Promise.all([
      offlineDb.places.get(place.id),
      offlineDb.trips.get(place.trip_id),
    ]);
    const now = new Date().toISOString();
    await offlineDb.places.put({
      ...existing,
      ...place,
      sync_id: existing?.sync_id || randomId(),
      trip_sync_id: existing?.trip_sync_id || trip?.sync_id || `orphan:${place.trip_id}`,
      created_at: existing?.created_at || place.created_at || now,
      updated_at: place.updated_at || existing?.updated_at || place.created_at || now,
      deleted_at: existing?.deleted_at ?? null,
    });
  }
}

export async function upsertPackingItems(items: StoredPackingItemRecord[]): Promise<void> {
  for (const item of items) {
    const [existing, trip, bag] = await Promise.all([
      offlineDb.packingItems.get(item.id), offlineDb.trips.get(item.trip_id),
      item.bag_id == null ? undefined : offlineDb.packingBags.get(item.bag_id),
    ]);
    const now = new Date().toISOString();
    await offlineDb.packingItems.put({ ...existing, ...item, sync_id: existing?.sync_id || item.sync_id || randomId(),
      trip_sync_id: existing?.trip_sync_id || item.trip_sync_id || trip?.sync_id || `orphan:${item.trip_id}`,
      bag_sync_id: item.bag_id == null ? null : bag?.sync_id ?? existing?.bag_sync_id ?? null,
      created_at: existing?.created_at || item.created_at || now, updated_at: item.updated_at || existing?.updated_at || now,
      deleted_at: existing?.deleted_at ?? item.deleted_at ?? null });
  }
}

export async function upsertTodoItems(items: TodoItem[]): Promise<void> {
  for (const item of items) {
    const [existing, trip] = await Promise.all([offlineDb.todoItems.get(item.id), offlineDb.trips.get(item.trip_id)]);
    const now = new Date().toISOString();
    await offlineDb.todoItems.put({ ...existing, ...item, sync_id: existing?.sync_id || randomId(),
      trip_sync_id: existing?.trip_sync_id || trip?.sync_id || `orphan:${item.trip_id}`,
      created_at: existing?.created_at || now, updated_at: existing?.updated_at || now,
      deleted_at: existing?.deleted_at ?? null });
  }
}

export async function upsertBudgetItems(items: BudgetItem[]): Promise<void> {
  for (const item of items) {
    const [existing, trip, reservation, place] = await Promise.all([
      offlineDb.budgetItems.get(item.id), offlineDb.trips.get(item.trip_id),
      item.reservation_id == null ? undefined : offlineDb.reservations.get(item.reservation_id),
      item.place_id == null ? undefined : offlineDb.places.get(item.place_id),
    ]);
    const now = new Date().toISOString();
    await offlineDb.budgetItems.put({ ...existing, ...item,
      sync_id: existing?.sync_id || randomId(),
      trip_sync_id: existing?.trip_sync_id || trip?.sync_id || `orphan:${item.trip_id}`,
      reservation_sync_id: item.reservation_id == null ? null : reservation?.sync_id || `orphan:${item.reservation_id}`,
      place_sync_id: item.place_id == null ? null : place?.sync_id || `orphan:${item.place_id}`,
      created_at: existing?.created_at || item.created_at || now,
      updated_at: existing?.updated_at || item.created_at || now,
      deleted_at: existing?.deleted_at ?? null,
      members: item.members ?? existing?.members ?? [], payers: item.payers ?? existing?.payers ?? [],
    });
  }
}

export async function upsertReservations(items: Reservation[]): Promise<void> {
  for (const item of items) {
    const [existing, trip, day, endDay, place, assignment, accommodation] = await Promise.all([
      offlineDb.reservations.get(item.id), offlineDb.trips.get(item.trip_id),
      item.day_id == null ? undefined : offlineDb.days.get(item.day_id),
      item.end_day_id == null ? undefined : offlineDb.days.get(item.end_day_id),
      item.place_id == null ? undefined : offlineDb.places.get(item.place_id),
      item.assignment_id == null ? undefined : offlineDb.assignments.get(item.assignment_id),
      item.accommodation_id == null ? undefined : offlineDb.accommodations.get(Number(item.accommodation_id)),
    ]);
    const now = new Date().toISOString();
    await offlineDb.reservations.put({ ...existing, ...item, sync_id: existing?.sync_id || randomId(),
      trip_sync_id: existing?.trip_sync_id || trip?.sync_id || `orphan:${item.trip_id}`,
      day_sync_id: item.day_id == null ? null : day?.sync_id || `orphan:${item.day_id}`,
      end_day_sync_id: item.end_day_id == null ? null : endDay?.sync_id || `orphan:${item.end_day_id}`,
      place_sync_id: item.place_id == null ? null : place?.sync_id || `orphan:${item.place_id}`,
      assignment_sync_id: item.assignment_id == null ? null : assignment?.sync_id || `orphan:${item.assignment_id}`,
      accommodation_sync_id: item.accommodation_id == null ? null : accommodation?.sync_id || `orphan:${item.accommodation_id}`,
      created_at: existing?.created_at || item.created_at || now, updated_at: now, deleted_at: existing?.deleted_at ?? null });
  }
}

export async function upsertTripFiles(files: TripFile[]): Promise<void> {
  for (const file of files) {
    const [existing, trip, place, reservation] = await Promise.all([
      offlineDb.tripFiles.get(file.id), offlineDb.trips.get(file.trip_id),
      file.place_id == null ? undefined : offlineDb.places.get(file.place_id),
      file.reservation_id == null ? undefined : offlineDb.reservations.get(file.reservation_id),
    ]);
    const now = new Date().toISOString();
    const syncId = existing?.sync_id || randomId();
    await offlineDb.tripFiles.put({ ...existing, ...file, sync_id: syncId,
      trip_sync_id: existing?.trip_sync_id || trip?.sync_id || `orphan:${file.trip_id}`,
      place_sync_id: file.place_id == null ? null : place?.sync_id || `orphan:${file.place_id}`,
      reservation_sync_id: file.reservation_id == null ? null : reservation?.sync_id || `orphan:${file.reservation_id}`,
      linked_place_sync_ids: existing?.linked_place_sync_ids || [], linked_reservation_sync_ids: existing?.linked_reservation_sync_ids || [],
      storage_path: existing?.storage_path || `${trip?.sync_id || `orphan:${file.trip_id}`}/${syncId}/${encodeURIComponent(file.original_name || file.filename)}`,
      created_at: existing?.created_at || file.created_at || now, updated_at: existing?.updated_at || file.created_at || now,
      deleted_at: file.deleted_at ?? existing?.deleted_at ?? null });
  }
}

export async function upsertAccommodations(items: Accommodation[]): Promise<void> {
  for (const item of items) {
    const [existing, trip, place, start, end] = await Promise.all([
      offlineDb.accommodations.get(item.id), offlineDb.trips.get(item.trip_id),
      item.place_id == null ? undefined : offlineDb.places.get(item.place_id),
      offlineDb.days.get(item.start_day_id), offlineDb.days.get(item.end_day_id),
    ]);
    const now = new Date().toISOString();
    await offlineDb.accommodations.put({ ...existing, ...item, sync_id: existing?.sync_id || randomId(),
      trip_sync_id: existing?.trip_sync_id || trip?.sync_id || `orphan:${item.trip_id}`,
      place_sync_id: item.place_id == null ? null : place?.sync_id || `orphan:${item.place_id}`,
      start_day_sync_id: start?.sync_id || `orphan:${item.start_day_id}`,
      end_day_sync_id: end?.sync_id || `orphan:${item.end_day_id}`,
      created_at: existing?.created_at || item.created_at || now, updated_at: now, deleted_at: existing?.deleted_at ?? null });
  }
}

export async function upsertTripMembers(tripId: number, members: TripMember[]): Promise<void> {
  const rows: CachedTripMember[] = members.map(m => ({ ...m, tripId }));
  await offlineDb.tripMembers.bulkPut(rows);
}

export async function upsertTags(tags: Tag[]): Promise<void> {
  await offlineDb.tags.bulkPut(tags);
}

export async function upsertCategories(categories: Category[]): Promise<void> {
  await offlineDb.categories.bulkPut(categories);
}

export async function upsertSyncMeta(meta: SyncMeta): Promise<void> {
  await offlineDb.syncMeta.put(meta);
}

/**
 * Read a pre-downloaded file blob for offline use. Returns null when the file
 * was never cached (or on any read error). The stored MIME is reapplied so the
 * caller's inline-vs-download decision stays correct even if the persisted Blob
 * lost its type.
 */
export async function getCachedBlob(url: string): Promise<Blob | null> {
  try {
    const entry = await offlineDb.blobCache.get(url);
    if (!entry) return null;
    return entry.blob.type
      ? entry.blob
      : new Blob([entry.blob], { type: entry.mime || 'application/octet-stream' });
  } catch {
    return null;
  }
}

// ── Booking-import source files ─────────────────────────────────────────────

/** Abandoned import files (never reviewed) are pruned after this long. */
const IMPORT_FILE_TTL_MS = 60 * 60_000;

/**
 * Persist the uploaded source files for a background import job so the per-item review can
 * attach each document to its booking even if the page reloads during the parse. Best-effort.
 */
export async function saveImportFiles(jobId: string, files: File[]): Promise<void> {
  try {
    const now = Date.now();
    await offlineDb.importFiles.bulkPut(files.map(f => ({ jobId, fileName: f.name, blob: f, createdAt: now })));
    // Prune leftovers from imports that were never reviewed.
    await offlineDb.importFiles.where('createdAt').below(now - IMPORT_FILE_TTL_MS).delete();
  } catch { /* the in-memory copy still serves the no-reload path */ }
}

/** A job's stored source files, rebuilt as File objects (name + type preserved for upload). */
export async function getImportFiles(jobId: string): Promise<File[]> {
  try {
    const rows = await offlineDb.importFiles.where('jobId').equals(jobId).toArray();
    return rows.map(r => new File([r.blob], r.fileName, { type: r.blob.type || 'application/octet-stream' }));
  } catch {
    return [];
  }
}

/** Drop a job's stored source files once they've been handed to the review flow. */
export async function deleteImportFiles(jobId: string): Promise<void> {
  try { await offlineDb.importFiles.where('jobId').equals(jobId).delete(); } catch { /* ignore */ }
}

// ── Blob-cache budget ───────────────────────────────────────────────────────

/**
 * Upper bounds for the offline file-blob cache. Kept conservative so trip
 * documents never starve the map-tile cache (sized at MAX_TILES in
 * tilePrefetcher.ts) for the origin's storage quota.
 */
export const BLOB_CACHE_MAX_ENTRIES = 200;
export const BLOB_CACHE_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Evict oldest-by-cachedAt blobs until the cache is under both the entry-count
 * and byte budget. Call after inserting new blobs. LRU on insertion time, which
 * is a reasonable proxy for access for write-once document blobs.
 */
export async function enforceBlobBudget(
  maxCount = BLOB_CACHE_MAX_ENTRIES,
  maxBytes = BLOB_CACHE_MAX_BYTES,
): Promise<void> {
  const entries = await offlineDb.blobCache.orderBy('cachedAt').toArray();
  let count = entries.length;
  let totalBytes = entries.reduce((sum, e) => sum + (e.bytes ?? 0), 0);
  if (count <= maxCount && totalBytes <= maxBytes) return;

  const toDelete: string[] = [];
  for (const e of entries) {
    if (count <= maxCount && totalBytes <= maxBytes) break;
    toDelete.push(e.url);
    totalBytes -= e.bytes ?? 0;
    count -= 1;
  }
  if (toDelete.length) await offlineDb.blobCache.bulkDelete(toDelete);
}

// ── Eviction / cleanup ────────────────────────────────────────────────────────

/**
 * Delete one trip's cached READ data (eviction, per-trip opt-out). The offline
 * write queue is deliberately preserved except for already-dropped 'failed' rows:
 * a trip can be evicted for being stale, or turned off in the storage settings,
 * while it still holds unsynced offline edits (pending/syncing) or unresolved
 * conflicts — those must survive so the user's work is not silently lost (#1135).
 * The replay only needs the queued REST request, not the cached entities, and a
 * successful flush re-adds the canonical row. The full "Clear cache" wipe goes
 * through clearAll(), which intentionally drops everything.
 */
export async function clearTripData(tripId: number): Promise<void> {
  await offlineDb.transaction(
    'rw',
    [
      offlineDb.packingItems,
      offlineDb.packingBags,
      offlineDb.todoItems,
      offlineDb.tripMembers,
      offlineDb.mutationQueue,
      offlineDb.syncMeta,
      offlineDb.blobCache,
    ],
    async () => {
      // Migrated domain tables are the working database, not disposable download
      // caches. Clearing offline extras must never erase user-authored data.
      // Packing and Todo are working data from v11/v12 onward, not disposable cache.
      // Files and their durable bodies are authored working data from v18;
      // cache eviction must not remove them.
      await offlineDb.tripMembers.where('tripId').equals(tripId).delete();
      // Keep pending/syncing/conflict mutations — only purge dead 'failed' rows.
      await offlineDb.mutationQueue.where('tripId').equals(tripId).and(m => m.status === 'failed').delete();
      await offlineDb.syncMeta.where('tripId').equals(tripId).delete();
      await offlineDb.blobCache.where('tripId').equals(tripId).delete();
    },
  );
}

/** Wipe the entire offline database (called on logout). */
export async function clearAll(): Promise<void> {
  await offlineDb.delete();
  // Re-open so subsequent operations don't fail
  await offlineDb.open();
}
