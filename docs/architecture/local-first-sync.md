# Local-first data and personal cloud sync

## 1. Current architecture

TREK originally treats the server as the source of truth. Its existing Dexie database is an offline cache and its `mutationQueue` replays REST requests. In the standalone PWA, Trip, Day, Place, Assignment, Accommodation, Reservation and Expense/Budget CRUD now use their repositories and IndexedDB, while later child modules remain server-backed.

The migration proceeds by dependency boundary: Trip, then Day, then Place and Assignment, then Accommodation and Reservation, then Expense/Budget. The legacy server cache sync remains intact for non-standalone TREK operation.

## 2. Target architecture

```text
Page / component
      ↓
Store / hook
      ↓
Repository
      ↓
IndexedDB (working database)
      ↓
SyncManager
      ↓
SyncProvider
      ├── GitHubSyncProvider
      └── future cloud providers
```

No UI write waits for a provider request. Provider errors affect sync status only.

## 3. Data flow

Local write:

```text
Trip/Day/Place/Assignment/Accommodation/Reservation/Expense Repository transaction
  ├── write the domain row
  ├── upsert syncOutbox
  └── mark entitySyncMeta pending
```

Sync performs pull before push. Remote changes are merged into IndexedDB, non-conflicting outbox entries are pushed, and sync metadata is updated only after the remote commit succeeds.

## 4. Repository responsibility

Repositories own local business CRUD, timestamps, UUID creation, tombstones and the atomic creation of outbox entries. They do not know which provider is configured and contain no GitHub API logic.

## 5. IndexedDB responsibility

Dexie is the working database and persists business rows, provider-neutral sync metadata, conflicts, provider configuration and device-local credentials. Version 6 migrates Trip, version 7 migrates Day, version 8 migrates Place and Assignment, version 9 migrates Accommodation and Reservation, and version 10 migrates Expense/Budget without clearing data.

Numeric ids remain temporary local compatibility keys. `sync_id` is the canonical UUID exported to providers. Day and Place carry a Trip UUID; Assignment carries Trip, Day and Place UUIDs. Numeric ids are never exported.

Version 7 adds Day UUIDs, parent UUIDs, timestamps and tombstones, then queues existing rows for their first provider sync. Orphaned legacy rows are marked with an `orphan:<numeric-id>` parent reference rather than silently deleted.

Version 8 gives Place the same lifecycle metadata and extracts legacy Assignments embedded in cached Day rows into a dedicated table. Missing parent relations are marked as migration errors and are not uploaded. Category ids, ratings and participants remain local/server projections until those modules are migrated.

Version 9 adds canonical UUIDs and relation UUIDs to Accommodation and Reservation, preserves numeric ids as local compatibility keys, and queues valid legacy rows for initial sync. Reservation day-position keys and day references nested in transport metadata are translated to Day UUIDs at the provider boundary. Traveler/account projections and external-service state are deliberately excluded from the portable payload.

Version 10 adds canonical UUIDs and Trip, Reservation and Place UUID relations to Expense/Budget rows. Member and payer names/amounts are portable snapshots, while provider-specific fields stay outside the domain model. Invalid legacy relations are retained locally, marked as migration errors and excluded from upload.

## 6. SyncManager responsibility

`SyncManager` coordinates pull, conflict detection, local merge, push and status updates. It only consumes `SyncProvider`; it does not inspect repository names, GitHub paths or GitHub responses.

Triggers are app startup, foreground resume, offline-to-online, debounced local changes and manual sync.

## 7. SyncProvider interface

Providers implement `connect`, `disconnect`, `pull`, `push` and `getStatus`. Cursors and remote versions are opaque strings. Changes use only entity type, canonical UUID, operation, base version and domain payload.

## 8. GitHubSyncProvider responsibility

The GitHub provider validates access, initializes an empty repository, reads the manifest and Trip-scoped documents, maps Git state to opaque versions, and writes all changed files plus the manifest in one Git tree commit. The branch ref is advanced with `force: false`; a moved ref causes a pull/retry instead of an overwrite.

## 9. GitHub data layout

```text
manifest.json
trips/<trip-uuid>/trip.json
trips/<trip-uuid>/days.json
trips/<trip-uuid>/places.json
trips/<trip-uuid>/assignments.json
trips/<trip-uuid>/accommodations.json
trips/<trip-uuid>/reservations.json
trips/<trip-uuid>/expenses.json
```

The manifest contains schema version and per-entity path, parent UUIDs, timestamps, tombstone and opaque content version. It does not duplicate domain payloads. Child entities are grouped by Trip in their respective files, while conflict metadata remains per entity.

## 10. Sync sequence

1. Check network and local configuration.
2. Connect to the provider.
3. Pull the remote cursor and manifest.
4. Merge non-conflicting remote changes into IndexedDB.
5. Persist conflicts without replacing either side.
6. Read pending local outbox entries.
7. Push non-conflicting entries atomically.
8. Store remote versions, cursor and completion time.

## 11. Conflict strategy

If local and remote both changed since `remoteVersion`, the local entity remains the visible working copy. Local and remote snapshots are stored in `syncConflicts`, the entity and outbox are marked `conflict`, and that entity is not pushed. Resolution UI is intentionally deferred, but both versions are retained.

## 12. Token strategy

Owner, repository, branch and enabled state are device-local configuration. The fine-grained PAT is kept separately in IndexedDB and is excluded from exports, provider payloads, logs and builds. It must be limited to Contents read/write on the dedicated private data repository.

A static PWA cannot protect a stored token from malicious code executing in the same origin. Least privilege, CSP and a dedicated repository are therefore part of the security boundary. OAuth or a GitHub App can later replace the credential source without changing repositories or SyncManager.

## 13. Schema migration strategy

All changes use Dexie version upgrades. Version 6 backfills Trip; version 7 adds Day identity and parent indexes; version 8 adds Place identity and the Assignment table; version 9 adds Accommodation and Reservation identities; version 10 adds Expense/Budget identities, relation indexes and outbox backfill. No reinstall, storage clear or destructive migration is required. Tombstones are retained until a future garbage-collection policy is implemented.

## 14. Future Supabase integration

`SupabaseSyncProvider` will implement the same provider interface and translate opaque cursors/versions to its own change tracking. UI, Trip repository, IndexedDB tables and Trip payloads remain unchanged. Multiple providers can later use separate `syncState` rows; fan-out policy belongs above the provider, not in repositories.

## Implemented boundary

Trip, Day, Place, Assignment, Accommodation, Reservation and Expense/Budget are migrated. Their normal CRUD and ordering operations are local-first and sync through the provider-neutral outbox. Reservation creation can atomically create a linked Accommodation and requested Expense. Deleting or shrinking a parent also tombstones or unlinks affected children so dangling relations are not synced. Expense member/payment flags, payer splits, category order and Reservation price mirroring persist locally.

DayNote items, Todo, Packing, files, collaboration, Auth and server removal are not implemented. Day title and whole-day notes are fields of Day and are migrated; the separate DayNote item collection is not. Place image upload and collaborative rating, Assignment participants, Reservation travelers, booking parsing/import, upcoming-booking aggregation and external AirTrail refresh remain online-only enhancements. Expense settlement records and live exchange-rate refresh remain online services and are not included in GitHub sync.

The legacy TREK Server cache/WebSocket path remains for non-standalone use, but it is not part of the GitHub Pages core write path. “Clear offline data” retains all migrated working rows and only removes disposable, not-yet-migrated caches.
