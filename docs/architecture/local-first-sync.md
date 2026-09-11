# Local-first data and personal cloud sync

## 1. Current architecture

TREK originally treats the server as the source of truth. Its existing Dexie database is an offline cache and its `mutationQueue` replays REST requests. In the standalone PWA, Trip CRUD already uses `tripRepo` and IndexedDB, while most child modules remain server-backed.

The first migration phase makes Trip local-first and adds a separate provider-neutral sync path. The legacy server cache sync remains intact for non-standalone TREK operation.

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
TripRepository transaction
  ├── write Trip
  ├── upsert syncOutbox
  └── mark entitySyncMeta pending
```

Sync performs pull before push. Remote changes are merged into IndexedDB, non-conflicting outbox entries are pushed, and sync metadata is updated only after the remote commit succeeds.

## 4. Repository responsibility

Repositories own local business CRUD, timestamps, UUID creation, tombstones and the atomic creation of outbox entries. They do not know which provider is configured and contain no GitHub API logic.

## 5. IndexedDB responsibility

Dexie is the working database and persists business rows, provider-neutral sync metadata, conflicts, provider configuration and device-local credentials. Version 6 migrates existing Trip rows without clearing data.

The numeric `Trip.id` remains a temporary local compatibility key because un-migrated child tables use numeric foreign keys. `Trip.sync_id` is the canonical UUID exported to providers. Numeric ids are never exported.

## 6. SyncManager responsibility

`SyncManager` coordinates pull, conflict detection, local merge, push and status updates. It only consumes `SyncProvider`; it does not inspect repository names, GitHub paths or GitHub responses.

Triggers are app startup, foreground resume, offline-to-online, debounced local changes and manual sync.

## 7. SyncProvider interface

Providers implement `connect`, `disconnect`, `pull`, `push` and `getStatus`. Cursors and remote versions are opaque strings. Changes use only entity type, canonical UUID, operation, base version and domain payload.

## 8. GitHubSyncProvider responsibility

The GitHub provider validates access, initializes an empty repository, reads the manifest and Trip documents, maps Git blobs/commits to opaque versions, and writes all changed files plus the manifest in one Git tree commit. The branch ref is advanced with `force: false`; a moved ref causes a pull/retry instead of an overwrite.

## 9. GitHub data layout

```text
manifest.json
trips/<trip-uuid>/trip.json
```

The manifest contains schema version and per-Trip path, timestamps, tombstone and content hash. It does not duplicate Trip payloads. Future child-module files remain grouped below the Trip UUID.

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

If local and remote both changed since `remoteVersion`, the local Trip remains the visible working copy. Local and remote snapshots are stored in `syncConflicts`, the entity and outbox are marked `conflict`, and that entity is not pushed. Resolution UI is intentionally deferred, but both versions are retained.

## 12. Token strategy

Owner, repository, branch and enabled state are device-local configuration. The fine-grained PAT is kept separately in IndexedDB and is excluded from exports, provider payloads, logs and builds. It must be limited to Contents read/write on the dedicated private data repository.

A static PWA cannot protect a stored token from malicious code executing in the same origin. Least privilege, CSP and a dedicated repository are therefore part of the security boundary. OAuth or a GitHub App can later replace the credential source without changing repositories or SyncManager.

## 13. Schema migration strategy

All changes use Dexie version upgrades. Version 6 backfills Trip UUIDs, timestamps and `deleted_at`, creates provider-neutral tables, and queues existing Trips for their first sync. No reinstall, storage clear or destructive migration is required. Tombstones are retained until a future garbage-collection policy is implemented.

## 14. Future Supabase integration

`SupabaseSyncProvider` will implement the same provider interface and translate opaque cursors/versions to its own change tracking. UI, Trip repository, IndexedDB tables and Trip payloads remain unchanged. Multiple providers can later use separate `syncState` rows; fan-out policy belongs above the provider, not in repositories.

## Phase-one boundary

Only Trip is migrated. Day, Place, Expense, Reservation, Todo, Packing, files, collaboration, Auth and server removal are not implemented in this phase.
