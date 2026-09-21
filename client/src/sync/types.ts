export type SyncEntityType = 'trip' | 'day' | 'dayNote' | 'place' | 'assignment' | 'accommodation' | 'reservation' | 'budgetItem' | 'todo' | 'packingBag' | 'packingItem' | 'packingConfig' | 'tripFile' | 'vacay' | 'atlas'
export type SyncOperation = 'upsert' | 'delete'
export type EntitySyncStatus = 'synced' | 'pending' | 'syncing' | 'conflict' | 'error'

export interface LocalChange {
  entityType: SyncEntityType
  entityId: string
  operation: SyncOperation
  baseVersion?: string | null
  payload?: unknown
  /** A durable edit made offline (or retried after a network failure). */
  offline?: boolean
  changedAt?: number
}

export interface RemoteChange {
  entityType: SyncEntityType
  entityId: string
  operation: SyncOperation
  remoteVersion: string
  payload?: unknown
}

export interface RemoteChanges {
  cursor: string | null
  changes: RemoteChange[]
}

export interface PushResult {
  cursor: string
  versions: Record<string, string>
}

export interface ProviderStatus {
  connected: boolean
  message?: string
}

export interface SyncProvider {
  readonly id: string
  readonly syncMode?: 'merge' | 'last-write-wins'
  connect(): Promise<ProviderStatus>
  disconnect(): Promise<void>
  pull(cursor?: string | null): Promise<RemoteChanges>
  push(changes: LocalChange[], cursor?: string | null): Promise<PushResult>
  getStatus(): Promise<ProviderStatus>
  /** Optional binary-object channel. Business metadata still travels through push/pull. */
  uploadAttachment?(path: string, blob: Blob, contentType: string): Promise<void>
  downloadAttachment?(path: string): Promise<Blob>
}

export interface SyncOutboxRecord {
  key: string
  entityType: SyncEntityType
  entityId: string
  operation: SyncOperation
  changedAt: number
  status: 'pending' | 'syncing' | 'error' | 'conflict'
  attempts: number
  lastError: string | null
  offline?: boolean
}

export interface EntitySyncMetaRecord {
  key: string
  entityType: SyncEntityType
  entityId: string
  status: EntitySyncStatus
  remoteVersion: string | null
  lastSyncedAt: number | null
  lastError: string | null
}

export interface SyncStateRecord {
  providerId: string
  cursor: string | null
  lastSyncAt: number | null
  lastError: string | null
  status: 'idle' | 'syncing' | 'error'
}

export interface SyncConflictRecord {
  key: string
  entityType: SyncEntityType
  entityId: string
  baseVersion: string | null
  remoteVersion: string
  localSnapshot: unknown
  remoteSnapshot: unknown
  detectedAt: number
}
