import { asLocalTripRecord, offlineDb } from '../db/offlineDb'
import { applySyncedTrip, toSyncedTrip, type SyncedTrip } from '../domain/tripSyncModel'
import { syncEntityKey } from './localChangeRepository'
import type { LocalChange, RemoteChange, SyncProvider } from './types'

async function nextLocalTripId(): Promise<number> {
  const first = await offlineDb.trips.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

export interface SyncRunResult {
  pulled: number
  pushed: number
  conflicts: number
  cursor: string | null
}

/** Coordinates local data and an interchangeable provider. */
export class SyncManager {
  constructor(private readonly provider: SyncProvider) {}

  private async applyRemote(change: RemoteChange): Promise<'applied' | 'conflict' | 'unchanged'> {
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

  async sync(): Promise<SyncRunResult> {
    const previous = await offlineDb.syncState.get(this.provider.id)
    await offlineDb.syncState.put({
      providerId: this.provider.id,
      cursor: previous?.cursor ?? null,
      lastSyncAt: previous?.lastSyncAt ?? null,
      lastError: null,
      status: 'syncing',
    })

    try {
      await this.provider.connect()
      // Pull before push. Store the observed head before pushing so a retry after
      // a non-fast-forward starts from the exact remote version we merged.
      const remote = await this.provider.pull(previous?.cursor)
      let pulled = 0
      let conflicts = 0
      for (const change of remote.changes) {
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
        const trip = await offlineDb.trips.where('sync_id').equals(row.entityId).first()
        if (!trip) continue
        const meta = await offlineDb.entitySyncMeta.get(row.key)
        changes.push({
          entityType: row.entityType,
          entityId: row.entityId,
          operation: row.operation,
          baseVersion: meta?.remoteVersion,
          payload: row.operation === 'upsert'
            ? toSyncedTrip({ ...asLocalTripRecord(trip), sync_id: row.entityId })
            : undefined,
        })
      }

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
