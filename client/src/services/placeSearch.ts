import { getSupabaseClient } from '../auth/supabaseClient'
import { offlineDb } from '../db/offlineDb'

export interface PlaceSearchBounds {
  low: { lat: number; lng: number }
  high: { lat: number; lng: number }
}

export interface PlaceSearchResult {
  name: string
  address: string | null
  lat: number
  lng: number
  source: string
  external_place_id: string | null
  osm_id: string | null
  google_place_id?: string | null
  website: string | null
  phone: string | null
  category?: string | null
  type?: string | null
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().functions.invoke('place-search', { body })
  if (error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const detail = await context.clone().json().catch(() => null) as { error?: unknown } | null
      if (typeof detail?.error === 'string') {
        throw Object.assign(error, { response: { data: detail } })
      }
    }
    throw error
  }
  return data as T
}

interface CachedSearch<T> { savedAt: number; value: T }
const CACHE_PREFIX = 'place-search:v2:'
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000

async function cached<T>(key: string, load: () => Promise<T>, maxAge: (value: T) => number = () => CACHE_MAX_AGE): Promise<T> {
  const cacheKey = `${CACHE_PREFIX}${key}`
  const stored = await offlineDb.appMeta.get(cacheKey).catch(() => undefined)
  let fallback: CachedSearch<T> | undefined
  if (stored) {
    try { fallback = JSON.parse(stored.value) as CachedSearch<T> } catch { /* ignore invalid legacy cache */ }
    if (fallback && Date.now() - fallback.savedAt < maxAge(fallback.value)) return fallback.value
  }
  try {
    const value = await load()
    await offlineDb.appMeta.put({ key: cacheKey, value: JSON.stringify({ savedAt: Date.now(), value }) }).catch(() => {})
    return value
  } catch (error) {
    // A stale result is still useful offline; failed refreshes never destroy it.
    if (fallback) return fallback.value
    throw error
  }
}

function searchKey(q: string, lang?: string, bounds?: PlaceSearchBounds): string {
  const box = bounds
    ? [bounds.low.lat, bounds.low.lng, bounds.high.lat, bounds.high.lng].map(value => value.toFixed(2)).join(',')
    : ''
  return `q:${(lang || '').toLowerCase()}:${q.trim().toLowerCase()}:${box}`
}

interface UnifiedPlaceSearchResult {
  name: string
  address: string | null
  latitude: number
  longitude: number
  source: 'baidu' | 'google' | 'osm'
  externalPlaceId: string | null
}

function toPlace(result: UnifiedPlaceSearchResult): PlaceSearchResult {
  return {
    name: result.name,
    address: result.address,
    lat: result.latitude,
    lng: result.longitude,
    source: result.source,
    external_place_id: result.externalPlaceId,
    osm_id: result.source === 'osm' ? result.externalPlaceId : null,
    google_place_id: result.source === 'google' ? result.externalPlaceId : null,
    website: null,
    phone: null,
  }
}

export const placeSearch = {
  search: (q: string, lang?: string, bounds?: PlaceSearchBounds) => cached(
    searchKey(q, lang, bounds),
    async () => {
      const result = await invoke<{ places: UnifiedPlaceSearchResult[]; source: string }>({ action: 'search', q, lang, bounds })
      return { places: result.places.map(toPlace), source: result.source }
    },
    result => result.source === 'baidu' ? CACHE_MAX_AGE : 15 * 60 * 1000,
  ),

  reverse: (lat: number, lng: number, lang?: string) => cached(
    `r:${(lang || '').toLowerCase()}:${lat.toFixed(4)},${lng.toFixed(4)}`,
    () => invoke<PlaceSearchResult>({ action: 'reverse', lat, lng, lang }),
  ),

  resolveUrl: (url: string, lang?: string) =>
    invoke<Partial<PlaceSearchResult>>({ action: 'resolve-url', url, lang }),
}
