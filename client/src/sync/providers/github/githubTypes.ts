export interface GitHubManifestTrip {
  path: string
  updatedAt: string
  deletedAt: string | null
  contentHash: string
}

export interface GitHubManifestDay extends GitHubManifestTrip {
  tripId: string
}

export type GitHubManifestPlace = GitHubManifestDay

export interface GitHubManifestAssignment extends GitHubManifestDay {
  dayId: string
  placeId: string
}

export interface GitHubManifestAccommodation extends GitHubManifestDay {
  placeId: string | null
  startDayId: string
  endDayId: string
}

export interface GitHubManifestReservation extends GitHubManifestDay {
  dayId: string | null
  accommodationId: string | null
}

export interface GitHubDaysFile {
  schemaVersion: 1
  tripId: string
  updatedAt: string
  days: import('../../../domain/daySyncModel').SyncedDay[]
}

export interface GitHubPlacesFile {
  schemaVersion: 1
  tripId: string
  updatedAt: string
  places: import('../../../domain/placeSyncModel').SyncedPlace[]
}

export interface GitHubAssignmentsFile {
  schemaVersion: 1
  tripId: string
  updatedAt: string
  assignments: import('../../../domain/assignmentSyncModel').SyncedAssignment[]
}

export interface GitHubAccommodationsFile {
  schemaVersion: 1
  tripId: string
  updatedAt: string
  accommodations: import('../../../domain/accommodationSyncModel').SyncedAccommodation[]
}

export interface GitHubReservationsFile {
  schemaVersion: 1
  tripId: string
  updatedAt: string
  reservations: import('../../../domain/reservationSyncModel').SyncedReservation[]
}

export interface GitHubManifest {
  schemaVersion: 1
  updatedAt: string
  trips: Record<string, GitHubManifestTrip>
  /** Optional for backwards compatibility with phase-one manifests. */
  days?: Record<string, GitHubManifestDay>
  places?: Record<string, GitHubManifestPlace>
  assignments?: Record<string, GitHubManifestAssignment>
  accommodations?: Record<string, GitHubManifestAccommodation>
  reservations?: Record<string, GitHubManifestReservation>
}

export const EMPTY_MANIFEST: GitHubManifest = {
  schemaVersion: 1,
  updatedAt: '1970-01-01T00:00:00.000Z',
  trips: {},
  days: {},
  places: {},
  assignments: {},
  accommodations: {},
  reservations: {},
}
