import { useEffect, useState } from 'react'
import { offlineDb, type PlaceDetailsCache } from '../db/offlineDb'
import { getSupabaseClient } from '../auth/supabaseClient'

export type PlaceDetailsIdentity = Pick<PlaceDetailsCache, 'placeId' | 'providerPlaceId'> & { provider: 'baidu' | 'osm' }
export const PLACE_DETAILS_TTL_MS = 3 * 24 * 60 * 60 * 1000

const inFlight = new Map<string, Promise<PlaceDetailsCache>>()

function matches(cache: PlaceDetailsCache | undefined, identity: PlaceDetailsIdentity): cache is PlaceDetailsCache {
  return !!cache && cache.provider === identity.provider && cache.providerPlaceId === identity.providerPlaceId
}

function expired(cache: PlaceDetailsCache): boolean {
  const fetched = Date.parse(cache.fetchedAt)
  return !Number.isFinite(fetched) || Date.now() - fetched >= PLACE_DETAILS_TTL_MS
}

async function refresh(identity: PlaceDetailsIdentity, lang?: string): Promise<PlaceDetailsCache> {
  const key = `${identity.placeId}:${identity.provider}:${identity.providerPlaceId}:${lang || ''}`
  const existing = inFlight.get(key)
  if (existing) return existing
  const promise = (async () => {
    const { data, error } = await getSupabaseClient().functions.invoke('place-search', {
      body: { action: 'details', provider: identity.provider, providerPlaceId: identity.providerPlaceId, lang },
    })
    if (error) throw error
    if (!data || data.provider !== identity.provider || data.providerPlaceId !== identity.providerPlaceId) {
      throw new Error('Invalid place details response')
    }
    const result: PlaceDetailsCache = {
      placeId: identity.placeId,
      provider: identity.provider,
      providerPlaceId: identity.providerPlaceId,
      fetchedAt: new Date().toISOString(),
      ...Object.fromEntries(['rating', 'ratingCount', 'openingHours', 'phone', 'website', 'photoUrl', 'description']
        .filter(field => data[field] !== undefined && data[field] !== null)
        .map(field => [field, data[field]])),
    }
    await offlineDb.placeDetailsCache.put(result).catch(() => {})
    return result
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

/** Publish local data immediately, then refresh only when its three-day window expires. */
export async function loadPlaceDetails(
  identity: PlaceDetailsIdentity,
  lang?: string,
  onUpdate?: (details: PlaceDetailsCache) => void,
): Promise<PlaceDetailsCache | null> {
  const stored = await offlineDb.placeDetailsCache.get(identity.placeId).catch(() => undefined)
  const cached = matches(stored, identity) ? stored : undefined
  if (cached) onUpdate?.(cached)
  if (cached && !expired(cached)) return cached
  try {
    const updated = await refresh(identity, lang)
    onUpdate?.(updated)
    return updated
  } catch {
    return cached || null
  }
}

export function useCachedPlaceDetails(identity: PlaceDetailsIdentity | null, lang?: string): PlaceDetailsCache | null {
  const [details, setDetails] = useState<PlaceDetailsCache | null>(null)
  const placeId = identity?.placeId
  const provider = identity?.provider
  const providerPlaceId = identity?.providerPlaceId
  useEffect(() => {
    let live = true
    setDetails(null)
    if (placeId && provider && providerPlaceId) {
      void loadPlaceDetails({ placeId, provider, providerPlaceId }, lang, next => {
        if (live) setDetails(next)
      })
    }
    return () => { live = false }
  }, [placeId, provider, providerPlaceId, lang])
  return details
}
