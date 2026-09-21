import { continentForCountry, strongerVisitStatus, tripVisitStatus, type VisitStatus } from '@trek/shared'
import { offlineDb } from '../../db/offlineDb'
import { emptyAtlas, type LocalAtlasRecord } from '../../domain/atlasSyncModel'
import { useAuthStore } from '../../store/authStore'
import { markLocalChange } from '../../sync/localChangeRepository'
import { randomId } from '../../utils/randomId'
import type { AtlasData, AtlasCountry, BucketItem, CountryDetail } from './atlasModel'
import { locatePoint } from './atlasGeo'

function ownerId(): string {
  return useAuthStore.getState().user?.auth_id || 'local-atlas'
}

export async function atlasRecord(): Promise<LocalAtlasRecord> {
  const id = ownerId()
  return await offlineDb.atlasData.get(id) || emptyAtlas(id)
}

async function updateAtlas(update: (row: LocalAtlasRecord) => LocalAtlasRecord): Promise<void> {
  const id = ownerId()
  await offlineDb.transaction('rw', [offlineDb.atlasData, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
    const current = await offlineDb.atlasData.get(id) || emptyAtlas(id)
    const next = update(current)
    await offlineDb.atlasData.put({ ...next, updatedAt: new Date().toISOString() })
    if (id !== 'local-atlas') await markLocalChange('atlas', id, 'upsert')
  })
}

export async function markCountry(code: string): Promise<void> {
  await updateAtlas(row => ({ ...row, manualCountries: [...new Set([...row.manualCountries, code])], hiddenCountries: row.hiddenCountries.filter(value => value !== code) }))
}

export async function unmarkCountry(code: string): Promise<void> {
  await updateAtlas(row => ({ ...row, manualCountries: row.manualCountries.filter(value => value !== code), hiddenCountries: [...new Set([...row.hiddenCountries, code])], manualRegions: row.manualRegions.filter(value => value.countryCode !== code) }))
}

export async function markRegion(code: string, name: string, countryCode: string): Promise<void> {
  await updateAtlas(row => ({ ...row, manualRegions: [...row.manualRegions.filter(value => value.code !== code), { code, name, countryCode }], hiddenRegions: row.hiddenRegions.filter(value => value !== code), hiddenCountries: row.hiddenCountries.filter(value => value !== countryCode) }))
}

export async function unmarkRegion(code: string): Promise<void> {
  await updateAtlas(row => ({ ...row, manualRegions: row.manualRegions.filter(value => value.code !== code), hiddenRegions: [...new Set([...row.hiddenRegions, code])] }))
}

export async function addBucket(input: Partial<BucketItem>): Promise<BucketItem> {
  const item: BucketItem = { id: randomId(), name: input.name || '', lat: input.lat ?? null, lng: input.lng ?? null, country_code: input.country_code ?? null, notes: input.notes ?? null, target_date: input.target_date ?? null }
  await updateAtlas(row => ({ ...row, bucketItems: [{ ...item, id: String(item.id) }, ...row.bucketItems] }))
  return item
}

export async function deleteBucket(id: string | number): Promise<void> {
  await updateAtlas(row => ({ ...row, bucketItems: row.bucketItems.filter(item => item.id !== id) }))
}

interface ResolvedPlace { id: number; name: string; lat: number; lng: number; tripId: number; code: string; regionCode: string | null; regionName: string | null }

async function localVisits() {
  const trips = (await offlineDb.trips.toArray()).filter(trip => !trip.deleted_at)
  const tripIds = new Set(trips.map(trip => trip.id))
  const places = (await offlineDb.places.toArray()).filter(place => !place.deleted_at && tripIds.has(place.trip_id) && place.lat != null && place.lng != null)
  const resolved: ResolvedPlace[] = []
  for (const place of places) {
    try {
      const info = await locatePoint(place.lat!, place.lng!)
      if (info.country_code) resolved.push({ id: place.id, name: place.name, lat: place.lat!, lng: place.lng!, tripId: place.trip_id, code: info.country_code, regionCode: info.region_code, regionName: info.region_name })
    } catch {
      // Missing geometry must not prevent manual marks or the wish list loading.
      break
    }
  }
  return { trips, places, resolved }
}

export async function atlasStats(): Promise<AtlasData> {
  const [record, { trips, places, resolved }] = await Promise.all([atlasRecord(), localVisits()])
  const byCode = new Map<string, { places: ResolvedPlace[]; tripIds: Set<number>; status: VisitStatus }>()
  for (const place of resolved) {
    const trip = trips.find(value => value.id === place.tripId)
    const status = tripVisitStatus(trip?.start_date, trip?.end_date)
    const current = byCode.get(place.code)
    if (current) { current.places.push(place); current.tripIds.add(place.tripId); current.status = strongerVisitStatus(current.status, status) }
    else byCode.set(place.code, { places: [place], tripIds: new Set([place.tripId]), status })
  }
  const countries: AtlasCountry[] = [...byCode].map(([code, entry]) => {
    const dates = trips.filter(trip => entry.tripIds.has(trip.id)).map(trip => trip.start_date).filter((date): date is string => !!date).sort()
    return { code, placeCount: entry.places.length, tripCount: entry.tripIds.size, firstVisit: dates[0] || null, lastVisit: dates[dates.length - 1] || null, status: record.manualCountries.includes(code) ? 'visited' : entry.status }
  })
  for (const code of record.manualCountries) {
    if (record.hiddenCountries.includes(code)) continue
    if (!countries.some(country => country.code === code)) countries.push({ code, placeCount: 0, tripCount: 0, firstVisit: null, lastVisit: null, status: 'visited' })
  }
  for (const region of record.manualRegions) {
    if (record.hiddenRegions.includes(region.code) || record.hiddenCountries.includes(region.countryCode)) continue
    if (!countries.some(country => country.code === region.countryCode)) countries.push({ code: region.countryCode, placeCount: 0, tripCount: 0, firstVisit: null, lastVisit: null, status: 'visited' })
  }
  const visible = countries.filter(country => country.placeCount > 0 || !record.hiddenCountries.includes(country.code))
  const visited = visible.filter(country => country.status === 'visited')
  const continents: Record<string, number> = {}
  const continentsPlanned: Record<string, number> = {}
  for (const country of visible) {
    const map = country.status === 'visited' ? continents : continentsPlanned
    const continent = continentForCountry(country.code)
    map[continent] = (map[continent] || 0) + 1
  }
  const totalDays = trips.reduce((sum, trip) => trip.start_date && trip.end_date ? sum + Math.max(0, Math.floor((Date.parse(trip.end_date) - Date.parse(trip.start_date)) / 86400000) + 1) : sum, 0)
  return { countries: visible, stats: { totalTrips: trips.length, totalPlaces: places.length, totalCountries: visited.length, totalDays, totalCountriesPlanned: visible.filter(country => country.status === 'planned').length, totalCountriesIdea: visible.filter(country => country.status === 'idea').length }, mostVisited: [...visited].sort((a,b) => b.tripCount - a.tripCount)[0] || null, continents, continentsPlanned }
}

export async function visitedRegions(): Promise<Record<string, { code: string; name: string; placeCount: number; manuallyMarked?: boolean; status?: VisitStatus }[]>> {
  const [record, { resolved, trips }] = await Promise.all([atlasRecord(), localVisits()])
  const result: Record<string, { code: string; name: string; placeCount: number; manuallyMarked?: boolean; status?: VisitStatus }[]> = {}
  for (const place of resolved) {
    if (!place.regionCode || record.hiddenRegions.includes(place.regionCode) || record.hiddenCountries.includes(place.code)) continue
    const list = result[place.code] ||= []
    const existing = list.find(value => value.code === place.regionCode)
    const trip = trips.find(value => value.id === place.tripId)
    const status = tripVisitStatus(trip?.start_date, trip?.end_date)
    if (existing) { existing.placeCount++; existing.status = strongerVisitStatus(existing.status || 'idea', status) }
    else list.push({ code: place.regionCode, name: place.regionName || place.regionCode, placeCount: 1, status })
  }
  for (const region of record.manualRegions) {
    if (record.hiddenRegions.includes(region.code) || record.hiddenCountries.includes(region.countryCode)) continue
    const list = result[region.countryCode] ||= []
    const existing = list.find(value => value.code === region.code)
    if (existing) { existing.manuallyMarked = true; existing.status = 'visited' }
    else list.push({ code: region.code, name: region.name, placeCount: 0, manuallyMarked: true, status: 'visited' })
  }
  return result
}

export async function countryDetail(code: string): Promise<CountryDetail> {
  const [record, { trips, resolved }] = await Promise.all([atlasRecord(), localVisits()])
  const places = resolved.filter(value => value.code === code)
  const ids = new Set(places.map(value => value.tripId))
  return { places: places.map(place => ({ id: place.id, name: place.name, lat: place.lat, lng: place.lng })), trips: trips.filter(trip => ids.has(trip.id)).map(trip => ({ id: trip.id, title: trip.title })), manually_marked: record.manualCountries.includes(code) }
}
