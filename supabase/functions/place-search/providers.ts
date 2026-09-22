import { osmRequest } from './osmRequest.ts'
import { createHash } from 'node:crypto'

export interface PlaceSearchBounds {
  low: { lat: number; lng: number }
  high: { lat: number; lng: number }
}

export interface PlaceSearchQuery {
  q: string
  lang?: string
  limit: number
  bounds?: PlaceSearchBounds
}

/** Make a point-shaped trip bias usable by Nominatim and Google. */
export function normalizedSearchBounds(bounds?: PlaceSearchBounds): PlaceSearchBounds | undefined {
  if (!bounds) return undefined
  const values = [bounds.low.lat, bounds.low.lng, bounds.high.lat, bounds.high.lng]
  if (!values.every(Number.isFinite)) return undefined
  const south = Math.min(bounds.low.lat, bounds.high.lat)
  const north = Math.max(bounds.low.lat, bounds.high.lat)
  const west = Math.min(bounds.low.lng, bounds.high.lng)
  const east = Math.max(bounds.low.lng, bounds.high.lng)
  if (south < -90 || north > 90 || west < -180 || east > 180) return undefined
  const latPad = south === north ? 0.05 : 0
  const lngPad = west === east ? 0.05 : 0
  return {
    low: { lat: Math.max(-90, south - latPad), lng: Math.max(-180, west - lngPad) },
    high: { lat: Math.min(90, north + latPad), lng: Math.min(180, east + lngPad) },
  }
}

export interface PlaceSearchResult {
  name: string
  address: string | null
  latitude: number
  longitude: number
  source: 'baidu' | 'google' | 'osm'
  externalPlaceId: string | null
}

export interface PlaceSearchProvider {
  readonly name: PlaceSearchResult['source']
  search(query: PlaceSearchQuery): Promise<PlaceSearchResult[]>
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function validPoint(latitude: unknown, longitude: unknown): { latitude: number; longitude: number } | null {
  const lat = finite(latitude)
  const lng = finite(longitude)
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { latitude: lat, longitude: lng }
    : null
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// Baidu can return GCJ-02 with ret_coordtype=gcj02ll. Convert to the
// WGS84 coordinates used by our map, IndexedDB and Supabase records.
function transformLat(x: number, y: number): number {
  let value = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
  value += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3
  value += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3
  return value
}
function transformLng(x: number, y: number): number {
  let value = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
  value += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3
  value += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3
  return value
}
function wgsToGcj(lat: number, lng: number): { lat: number; lng: number } {
  if (lng < 72.004 || lng > 137.8347 || lat < .8293 || lat > 55.8271) return { lat, lng }
  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const radLat = lat / 180 * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - .006693421622965943 * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = dLat * 180 / (6378245 * (1 - .006693421622965943) / (magic * sqrtMagic) * Math.PI)
  dLng = dLng * 180 / (6378245 / sqrtMagic * Math.cos(radLat) * Math.PI)
  return { lat: lat + dLat, lng: lng + dLng }
}
function gcjToWgs(lat: number, lng: number): { latitude: number; longitude: number } {
  let guess = { lat, lng }
  for (let i = 0; i < 4; i++) {
    const converted = wgsToGcj(guess.lat, guess.lng)
    guess = { lat: guess.lat + lat - converted.lat, lng: guess.lng + lng - converted.lng }
  }
  return { latitude: guess.lat, longitude: guess.lng }
}

interface BaiduRow {
  uid?: string
  name?: string
  address?: string
  location?: { lat?: number; lng?: number }
}

export class BaiduProvider implements PlaceSearchProvider {
  readonly name = 'baidu'
  constructor(private readonly key: string, private readonly securityKey?: string) {}

  async search(query: PlaceSearchQuery): Promise<PlaceSearchResult[]> {
    // Place v2 documents nationwide search; v3 suggestion documents only a
    // city-level region. With a viewport, send its centre as a ranking bias.
    const params = new URLSearchParams({
      query: query.q, region: '全国', city_limit: 'false', ak: this.key,
      output: 'json', ret_coordtype: 'gcj02ll',
    })
    if (query.bounds) {
      const { low, high } = query.bounds
      params.set('location', `${(low.lat + high.lat) / 2},${(low.lng + high.lng) / 2}`)
      params.set('coord_type', '1')
    }
    const path = '/place/v2/suggestion'
    if (this.securityKey) params.set('sn', baiduSignature(path, params, this.securityKey))
    const data = await fetchJson(`https://api.map.baidu.com${path}?${params}`) as {
      status?: number; message?: string; result?: BaiduRow[]
    }
    if (data.status !== 0) {
      throw new Error(`Baidu status ${data.status ?? 'invalid response'}: ${data.message ?? ''}`)
    }
    if (!Array.isArray(data.result)) throw new Error('Invalid Baidu suggestion response')
    return data.result.flatMap((row): PlaceSearchResult[] => {
      const point = validPoint(row.location?.lat, row.location?.lng)
      if (!point || !row.name) return []
      return [{
        name: row.name, address: row.address || null,
        ...gcjToWgs(point.latitude, point.longitude),
        source: this.name, externalPlaceId: row.uid || null,
      }]
    }).slice(0, query.limit)
  }
}

/** Baidu signs the encoded path and ordered query, with SK appended before hashing. */
export function baiduSignature(path: string, params: URLSearchParams, securityKey: string): string {
  return createHash('md5')
    .update(encodeURIComponent(`${path}?${params.toString()}${securityKey}`))
    .digest('hex')
}

interface GoogleRow {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
}

export class GoogleProvider implements PlaceSearchProvider {
  readonly name = 'google'
  constructor(private readonly key: string) {}

  async search(query: PlaceSearchQuery): Promise<PlaceSearchResult[]> {
    const body: Record<string, unknown> = {
      textQuery: query.q, maxResultCount: query.limit,
    }
    if (query.lang) body.languageCode = query.lang.split('-')[0]
    const bounds = normalizedSearchBounds(query.bounds)
    if (bounds) {
      const { low, high } = bounds
      body.locationBias = { rectangle: {
        low: { latitude: low.lat, longitude: low.lng },
        high: { latitude: high.lat, longitude: high.lng },
      } }
    }
    const data = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': this.key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify(body),
    }) as { places?: GoogleRow[]; error?: unknown }
    if (data.error || (data.places !== undefined && !Array.isArray(data.places))) throw new Error('Invalid Google Places response')
    return (data.places || []).flatMap(row => {
      const point = validPoint(row.location?.latitude, row.location?.longitude)
      if (!point || !row.displayName?.text) return []
      return [{ name: row.displayName.text, address: row.formattedAddress || null,
        ...point, source: this.name, externalPlaceId: row.id || null }]
    })
  }
}

export interface NominatimRow {
  osm_type?: string
  osm_id?: number | string
  lat?: string
  lon?: string
  display_name?: string
  name?: string
  address?: Record<string, string>
  namedetails?: Record<string, string>
  extratags?: Record<string, string>
  category?: string
  type?: string
}

export function normalizeOsm(row: NominatimRow): PlaceSearchResult | null {
  const point = validPoint(row.lat, row.lon)
  if (!point) return null
  return {
    name: row.name || row.namedetails?.name || row.address?.attraction || row.address?.tourism
      || row.address?.amenity || row.address?.shop || row.display_name?.split(',')[0]?.trim() || '',
    address: row.display_name || null, ...point, source: 'osm',
    externalPlaceId: row.osm_id == null ? null : `${row.osm_type || 'place'}:${row.osm_id}`,
  }
}

export class OSMProvider implements PlaceSearchProvider {
  readonly name = 'osm'
  constructor(private readonly baseUrl: string, private readonly userAgent: string) {}

  async search(query: PlaceSearchQuery): Promise<PlaceSearchResult[]> {
    const params = new URLSearchParams({ q: query.q, limit: String(query.limit), format: 'jsonv2', addressdetails: '1' })
    const bounds = normalizedSearchBounds(query.bounds)
    if (bounds) {
      const { low, high } = bounds
      params.set('viewbox', `${low.lng},${high.lat},${high.lng},${low.lat}`)
    }
    const data = await osmRequest(`${this.baseUrl}/search?${params}`, query.lang, this.userAgent)
    if (!Array.isArray(data)) throw new Error('Invalid OSM response')
    return (data as NominatimRow[]).map(normalizeOsm).filter((row): row is PlaceSearchResult => row !== null)
  }
}

export interface ProviderStats { provider: PlaceSearchResult['source']; request_count: number; last_error: string | null }
const stats = new Map<PlaceSearchResult['source'], ProviderStats>()
export function providerStats(): ProviderStats[] { return [...stats.values()].map(row => ({ ...row })) }

export async function searchWithFallback(query: PlaceSearchQuery, providers: PlaceSearchProvider[]): Promise<{
  places: PlaceSearchResult[]; source: PlaceSearchResult['source']
}> {
  for (const provider of providers) {
    const record = stats.get(provider.name) || { provider: provider.name, request_count: 0, last_error: null }
    record.request_count++
    stats.set(provider.name, record)
    try {
      const places = await provider.search(query)
      record.last_error = null
      console.info('[place-search:provider]', record)
      return { places, source: provider.name }
    } catch (error) {
      record.last_error = error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'
      console.error('[place-search:provider]', record)
    }
  }
  throw new Error('Place search is temporarily unavailable')
}
