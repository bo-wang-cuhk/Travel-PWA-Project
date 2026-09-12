export interface GitHubManifestTrip {
  path: string
  updatedAt: string
  deletedAt: string | null
  contentHash: string
}

export interface GitHubManifestDay extends GitHubManifestTrip {
  tripId: string
}

export interface GitHubDaysFile {
  schemaVersion: 1
  tripId: string
  updatedAt: string
  days: import('../../../domain/daySyncModel').SyncedDay[]
}

export interface GitHubManifest {
  schemaVersion: 1
  updatedAt: string
  trips: Record<string, GitHubManifestTrip>
  /** Optional for backwards compatibility with phase-one manifests. */
  days?: Record<string, GitHubManifestDay>
}

export const EMPTY_MANIFEST: GitHubManifest = {
  schemaVersion: 1,
  updatedAt: '1970-01-01T00:00:00.000Z',
  trips: {},
  days: {},
}
