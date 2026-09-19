import { offlineDb } from '../db/offlineDb'
import type { SyncEntityType, SyncOperation } from './types'

export function syncEntityKey(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}:${entityId}`
}

/** Must be called inside a transaction containing both sync tables. */
export async function markLocalChange(
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperation,
): Promise<void> {
  const key = syncEntityKey(entityType, entityId)
  const existing = await offlineDb.entitySyncMeta.get(key)
  await offlineDb.syncOutbox.put({
    key,
    entityType,
    entityId,
    operation,
    changedAt: Date.now(),
    status: 'pending',
    attempts: 0,
    lastError: null,
    offline: typeof navigator !== 'undefined' && !navigator.onLine,
  })
  await offlineDb.entitySyncMeta.put({
    key,
    entityType,
    entityId,
    status: 'pending',
    remoteVersion: existing?.remoteVersion ?? null,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastError: null,
  })
  queueMicrotask(() => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('travel:local-change'))
  })
}
