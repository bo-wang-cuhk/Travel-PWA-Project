export interface GitHubManifestTrip {
  path: string
  updatedAt: string
  deletedAt: string | null
  contentHash: string
}

export interface GitHubManifest {
  schemaVersion: 1
  updatedAt: string
  trips: Record<string, GitHubManifestTrip>
}

export const EMPTY_MANIFEST: GitHubManifest = {
  schemaVersion: 1,
  updatedAt: '1970-01-01T00:00:00.000Z',
  trips: {},
}
