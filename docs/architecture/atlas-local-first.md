# Atlas local-first migration

The standalone PWA reads Atlas from IndexedDB. Trips and Places already synced into the active workspace are the source for derived country and region visits. Manual country/region marks, explicit hides and bucket-list entries are stored in one personal Atlas document (`atlasData`, Dexie v19); each local change queues an `atlas` upsert for the existing SyncManager. Supabase stores the document in `atlas_records` and publishes revisions through `sync_changes`. The row and its change-log entries are readable only by the owning Auth user, including inside a shared workspace. The existing last-write-wins policy applies to offline edits.

`atlasClient` preserves the existing Atlas page contract: standalone mode uses local repositories and static geography; TREK Server mode keeps the previous API. Both desktop and mobile mark flows use it. Place search continues to use the separate map-search service; it is an online enhancement, not part of Atlas sync.

The country and region boundaries are generated from TREK's bundled data with `node --max-old-space-size=2048 scripts/build-atlas-geo.mjs`. The resulting 0.6 MB and 2.7 MB gzip files are PWA precache assets, so country/region selection remains available offline after installation. The app stores no map-service credentials in Atlas data.

## Migration boundary

This change does **not** copy old `visited_countries`, `visited_regions`, `hidden_*`, or `bucket_list` rows from a running TREK Server. Those rows remain untouched on the Server. They need a separately authorized, one-time export/import before Server shutdown if the old account contains irreplaceable manual Atlas data. Already-migrated Trips and Places are derived locally without such an import. Do not treat an empty Atlas document as proof that the old Server had no manual marks.

Atlas is scoped to the active local workspace database, as are its derived Trips and Places. Switching workspaces presents that workspace's Atlas document. There is no cross-workspace aggregate view in this phase.

`20260921100000_atlas_private_sync.sql` must be applied to Supabase before deploying the frontend change. It extends the offline LWW RPC and restricts change-log visibility for Atlas; without it, local operations still work but cloud sync reports an error.
