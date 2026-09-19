# Local-first workspace sync

## Current architecture

Supabase Auth owns identity and session. Every profile starts with one Personal Workspace. The first direct member addition promotes that workspace in place to a Shared Workspace, preserving its ID and every existing business row. Supabase is the authoritative cloud copy; the active workspace's scoped IndexedDB data is the complete working copy used by pages and repositories.

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
Active Personal/Shared Workspace tables + sync_changes
```

The former GitHub repository/PAT provider is removed. Dexie v15 deletes its local configuration and credential stores; v17 queues existing provider-neutral data once for import into Supabase.

## Data flow

- Local CRUD commits the business row and outbox entry in one IndexedDB transaction. UI success never waits for Supabase.
- Online local changes schedule a near-immediate background Supabase write. `sync_changes` Realtime INSERT events notify other members to pull; the durable cursor remains authoritative if an event is missed.
- A restored session schedules sync at login. Foregrounding the app, reconnecting the network and the manual button also trigger it.
- A fresh device has cursor `0` and downloads the latest version of every cloud entity into IndexedDB.
- Later runs query `sync_changes.cursor > local cursor`; no cloud change means no business rows are downloaded.
- An offline failure leaves outbox rows intact. Recovery uploads them before pulling cloud incrementals. Offline edits use their local `updated_at` for LWW; a stale edit loses to a newer cloud row and the pull restores that cloud version.
- Successful runs store the cloud cursor and `lastSyncAt` in IndexedDB `syncState`.

## Responsibilities

Repositories own local CRUD, UUID creation, timestamps, soft deletion and atomic outbox writes. They know neither Supabase tables nor sessions.

IndexedDB owns the current user's working data, compatibility numeric IDs, `syncOutbox`, per-entity sync metadata and `syncState`. Databases are scoped by user and active workspace. An owner's original per-user database stays in use when their Personal Workspace is promoted to Shared.

`SyncManager` serializes provider-neutral domain documents, orders relationships, uploads pending changes, applies remote changes and advances the local cursor. A provider advertises `last-write-wins`; future providers can retain merge/conflict behavior.

`SyncProvider` connects, pushes provider-neutral changes, pulls from an opaque cursor and reports status. Its optional attachment channel uploads/downloads binary objects without leaking Supabase concepts into repositories. `SupabaseSyncProvider` resolves the authenticated user's active Shared Workspace first, otherwise their Personal Workspace, maps entity types to Supabase tables and never handles passwords or privileged keys.

Workspace membership is managed by the authenticated `workspace-members` Edge Function. It checks the caller's active profile, reads active profiles with a server-side key, filters the caller, existing members and people already in another Shared Workspace, validates that the caller is the workspace owner/admin, and writes `workspace_members` directly. There is no invitation token or acceptance state. Ordinary clients retain read-only access to membership tables.

When an account first opens a workspace owned by somebody else, it opens a separate workspace-scoped IndexedDB database before pulling. Its previous Personal Workspace data and pending edits remain in their own local database; rows cannot leak across workspaces. The last active workspace database is restored on an offline cold start.

## Cloud schema

Each business table contains:

```text
id, workspace_id, created_by, updated_by,
created_at, updated_at, revision, deleted_at, payload
```

The cloud primary key is `(workspace_id, id)`. Domain IDs remain stable and
provider-neutral, while fixed aggregate IDs such as `personal-vacay` may safely
exist in multiple workspaces.

Tables are `trips`, `trip_days`, `day_notes`, `places`, `assignments`, `accommodations`, `reservations`, `budget_items`, `todo_items`, `packing_bags`, `packing_items`, `packing_configs`, `trip_files`, and `vacay_records`.

Attachment metadata is a normal revisioned `trip_files` entity. Binary bodies use the private `trip-attachments` Storage bucket at `workspaceId/tripId/fileId/name`. Storage RLS checks the authenticated user's Workspace membership; no object is public. New uploads first enter the durable `tripFileBlobs` IndexedDB table, then the sync manager uploads the body before committing its metadata. A fresh device downloads both metadata and body into IndexedDB, so previously synchronized files remain available offline.

`sync_changes` is an append-only cursor log written by database triggers and published to Supabase Realtime as a notification channel. It contains no separate client secret. RLS restricts every row and change-log query to Workspace members. The frontend uses only the Supabase URL and publishable key; authorization comes from the user's Supabase session and RLS.

## Conflict and deletion policy

Online concurrent edits use Last Write Wins: IndexedDB updates immediately, a near-immediate background upsert commits to Supabase, and the last accepted cloud write is canonical. Other members receive a Realtime notification and pull the durable change log. Offline replays call `push_offline_workspace_change`; they only replace a cloud row if their local `updated_at` is newer than its cloud `updated_at`. Pending local changes are pushed before pulling; a losing offline edit is replaced locally by the cloud version. An edit made while a run is in flight remains pending for the next run and is never dropped.

Deletes are tombstones. Repositories set `deleted_at`, retain the payload and enqueue `delete`; Supabase updates the row instead of physically deleting it. Deleting a Trip tombstones its migrated children in the same IndexedDB transaction.

## Schema migration

Dexie upgrades are additive and preserve existing records. v16 extracts embedded DayNote items into a first-class table. v17 re-queues all valid existing rows for the one-time provider migration. v18 normalizes file UUID relationships and adds durable binary storage. Users must not clear browser storage to upgrade.

Supabase changes are committed as ordered SQL migrations. The base identity migration remains separate from personal data tables and DayNote coverage.

## Trip boundary coverage

The personal Trip sync boundary includes Trip (including uploaded cover photos), Day, individual DayNote/log cards, Place, day-place Assignment and transport fields, Accommodation, Reservation, Expense/Budget, Todo, Packing Bag, Packing Item, and file/photo metadata plus binary bodies. Primary and additional file-to-Place/Reservation links use UUID relationships. Personal packing templates/settings and Vacay data are Workspace-scoped aggregates outside a single Trip but use the same pipeline.

Shared Workspace members now use the same Trip and Vacay data boundary and member directory. Live chat/polls and public share links remain outside this phase. Plugin/MCP/Admin data, public-holiday caches, map tiles, exchange rates and other replaceable online-service caches are not Workspace Trip records and remain separate.

## Future providers

A future cloud provider implements `SyncProvider` and consumes the same domain documents. Pages, repositories, IndexedDB tables and UUID relationships remain unchanged. Provider-specific row versions, table names and API responses must stay inside the provider.
