/** Private Atlas choices; trip/place-derived visits are rebuilt locally. */
export interface AtlasBucketRecord {
  id: string
  name: string
  lat: number | null
  lng: number | null
  country_code: string | null
  notes: string | null
  target_date: string | null
}

export interface AtlasRegionMark {
  code: string
  name: string
  countryCode: string
}

export interface SyncedAtlas {
  schemaVersion: 1
  id: string // auth.users.id; never a username or local numeric id
  manualCountries: string[]
  hiddenCountries: string[]
  manualRegions: AtlasRegionMark[]
  hiddenRegions: string[]
  bucketItems: AtlasBucketRecord[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type LocalAtlasRecord = SyncedAtlas

export function emptyAtlas(id: string): LocalAtlasRecord {
  const now = new Date().toISOString()
  return { schemaVersion: 1, id, manualCountries: [], hiddenCountries: [], manualRegions: [], hiddenRegions: [], bucketItems: [], createdAt: now, updatedAt: now, deletedAt: null }
}

export function isSyncedAtlas(value: unknown, id: string): value is SyncedAtlas {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<SyncedAtlas>
  return row.schemaVersion === 1 && row.id === id &&
    Array.isArray(row.manualCountries) && Array.isArray(row.hiddenCountries) &&
    Array.isArray(row.manualRegions) && Array.isArray(row.hiddenRegions) &&
    Array.isArray(row.bucketItems) && typeof row.updatedAt === 'string'
}
