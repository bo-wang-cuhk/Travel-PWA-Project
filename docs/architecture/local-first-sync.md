# Local-first personal sync

## Current architecture

Supabase Auth owns identity and session. Every profile owns one Personal Workspace. Supabase is the authoritative cloud copy; the current user's scoped IndexedDB database is the complete working copy used by pages and repositories.

```text
Page / Store
    ↓
Repository
    ↓
IndexedDB + durable syncOutbox
    ↓
SyncManager
    ↓
SupabaseSyncProvider
    ↓
Personal Workspace tables + sync_changes
```

The former GitHub repository/PAT provider is removed. Dexie v15 deletes its local configuration and credential stores; v17 queues existing provider-neutral data once for import into Supabase.

## Data flow

- Local CRUD commits the business row and outbox entry in one IndexedDB transaction. UI success never waits for Supabase.
- A restored session schedules sync at login. Local changes also debounce a sync; foregrounding the app, reconnecting the network and the manual button trigger it too.
- A fresh device has cursor `0` and downloads the latest version of every cloud entity into IndexedDB.
- Later runs query `sync_changes.cursor > local cursor`; no cloud change means no business rows are downloaded.
- An offline failure leaves outbox rows intact. Recovery uploads them before pulling cloud incrementals.
- Successful runs store the cloud cursor and `lastSyncAt` in IndexedDB `syncState`.

## Responsibilities

Repositories own local CRUD, UUID creation, timestamps, soft deletion and atomic outbox writes. They know neither Supabase tables nor sessions.

IndexedDB owns the current user's working data, compatibility numeric IDs, `syncOutbox`, per-entity sync metadata and `syncState`. Databases remain user-scoped.

`SyncManager` serializes provider-neutral domain documents, orders relationships, uploads pending changes, applies remote changes and advances the local cursor. A provider advertises `last-write-wins`; future providers can retain merge/conflict behavior.

`SyncProvider` connects, pushes provider-neutral changes, pulls from an opaque cursor and reports status. Its optional attachment channel uploads/downloads binary objects without leaking Supabase concepts into repositories. `SupabaseSyncProvider` resolves the authenticated user's Personal Workspace, maps entity types to Supabase tables and never handles passwords or privileged keys.

## Cloud schema

Each business table contains:

```text
id, workspace_id, created_by, updated_by,
created_at, updated_at, revision, deleted_at, payload
```

Tables are `trips`, `trip_days`, `day_notes`, `places`, `assignments`, `accommodations`, `reservations`, `budget_items`, `todo_items`, `packing_bags`, `packing_items`, `packing_configs`, `trip_files`, and `vacay_records`.

Attachment metadata is a normal revisioned `trip_files` entity. Binary bodies use the private `trip-attachments` Storage bucket at `workspaceId/tripId/fileId/name`. Storage RLS checks the authenticated user's Workspace membership; no object is public. New uploads first enter the durable `tripFileBlobs` IndexedDB table, then the sync manager uploads the body before committing its metadata. A fresh device downloads both metadata and body into IndexedDB, so previously synchronized files remain available offline.

`sync_changes` is an append-only cursor log written by database triggers. It contains no separate client secret. RLS restricts every row and change-log query to Workspace members. The frontend uses only the Supabase URL and publishable key; authorization comes from the user's Supabase session and RLS.

## Conflict and deletion policy

Personal multi-device sync uses Last Write Wins: pending local changes are committed first, then the device pulls the latest server revisions. The last transaction accepted by Supabase becomes canonical. An edit made while a run is in flight remains pending for the next run and is never dropped.

Deletes are tombstones. Repositories set `deleted_at`, retain the payload and enqueue `delete`; Supabase updates the row instead of physically deleting it. Deleting a Trip tombstones its migrated children in the same IndexedDB transaction.

## Schema migration

Dexie upgrades are additive and preserve existing records. v16 extracts embedded DayNote items into a first-class table. v17 re-queues all valid existing rows for the one-time provider migration. v18 normalizes file UUID relationships and adds durable binary storage. Users must not clear browser storage to upgrade.

Supabase changes are committed as ordered SQL migrations. The base identity migration remains separate from personal data tables and DayNote coverage.

## Trip boundary coverage

The personal Trip sync boundary includes Trip (including uploaded cover photos), Day, individual DayNote/log cards, Place, day-place Assignment and transport fields, Accommodation, Reservation, Expense/Budget, Todo, Packing Bag, Packing Item, and file/photo metadata plus binary bodies. Primary and additional file-to-Place/Reservation links use UUID relationships. Personal packing templates/settings and Vacay data are Workspace-scoped aggregates outside a single Trip but use the same pipeline.

Live collaboration/chat/polls and Workspace sharing are intentionally outside the first personal multi-device phase. Plugin/MCP/Admin data, public-holiday caches, map tiles, exchange rates and other replaceable online-service caches are not personal Trip records and remain separate.

## Future providers

A future cloud provider implements `SyncProvider` and consumes the same domain documents. Pages, repositories, IndexedDB tables and UUID relationships remain unchanged. Provider-specific row versions, table names and API responses must stay inside the provider.
