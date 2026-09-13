export type SyncEntityType = 'trip' | 'day' | 'place' | 'assignment' | 'accommodation' | 'reservation' | 'budgetItem' | 'todo' | 'packingBag' | 'packingItem' | 'packingConfig' | 'vacay'
export type SyncOperation = 'upsert' | 'delete'
export type EntitySyncStatus = 'synced' | 'pending' | 'syncing' | 'conflict' | 'error'

export interface LocalChange {
  entityType: SyncEntityType
  entityId: string
  operation: SyncOperation
  baseVersion?: string | null
  payload?: unknown
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
  connect(): Promise<ProviderStatus>
  disconnect(): Promise<void>
  pull(cursor?: string | null): Promise<RemoteChanges>
  push(changes: LocalChange[], cursor?: string | null): Promise<PushResult>
  getStatus(): Promise<ProviderStatus>
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

export interface GitHubSyncPublicConfig {
  owner: string
  repository: string
  branch: string
  enabled: boolean
}

export interface SyncProviderConfigRecord {
  providerId: string
  config: GitHubSyncPublicConfig
}

export interface SyncCredentialRecord {
  providerId: string
  secret: string
}
