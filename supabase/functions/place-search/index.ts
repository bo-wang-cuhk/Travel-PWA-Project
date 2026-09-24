import { corsHeaders, json } from '../_shared/http.ts'
import { BaiduProvider, GoogleProvider, OSMProvider, searchWithFallback } from './providers.ts'
import { osmRequest } from './osmRequest.ts'
import { fetchPlaceDetails } from './details.ts'

const NOMINATIM_URL = Deno.env.get('PLACE_SEARCH_BASE_URL')?.replace(/\/$/, '')
  || 'https://nominatim.openstreetmap.org'
const APP_USER_AGENT = Deno.env.get('PLACE_SEARCH_USER_AGENT')
  || 'Roamune-Travel-PWA/1.0 (https://github.com/bo-wang-cuhk/Travel-PWA-Project)'

interface SearchBody {
  action?: 'search' | 'reverse' | 'resolve-url' | 'details'
  provider?: 'baidu' | 'osm'
  providerPlaceId?: string
  q?: string
  lang?: string
  limit?: number
  lat?: number
  lng?: number
  bounds?: { low: { lat: number; lng: number }; high: { lat: number; lng: number } }
  url?: string
}

interface NominatimResult {
  osm_type?: string
  osm_id?: number | string
  lat?: string
  lon?: string
  display_name?: string
  name?: string
  type?: string
  category?: string
  address?: Record<string, string>
  extratags?: Record<string, string>
  namedetails?: Record<string, string>
}

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clampLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : 8
}

function preferredName(row: NominatimResult): string {
  return row.name
    || row.namedetails?.name
    || row.address?.attraction
    || row.address?.tourism
    || row.address?.amenity
    || row.address?.shop
    || row.display_name?.split(',')[0]?.trim()
    || ''
}

function normalize(row: NominatimResult) {
  const lat = finite(row.lat)
  const lng = finite(row.lon)
  if (lat === null || lng === null) return null
  const osmType = row.osm_type || 'place'
  const osmId = row.osm_id == null ? null : `${osmType}:${row.osm_id}`
  return {
    name: preferredName(row),
    address: row.display_name || null,
    lat,
    lng,
    source: 'nominatim',
    external_place_id: osmId,
    osm_id: osmId,
    website: row.extratags?.website || row.extratags?.['contact:website'] || null,
    phone: row.extratags?.phone || row.extratags?.['contact:phone'] || null,
    category: row.category || null,
    type: row.type || null,
  }
}

async function nominatim(path: string, params: URLSearchParams, lang?: string): Promise<unknown> {
  params.set('format', 'jsonv2')
  params.set('addressdetails', '1')
  params.set('extratags', '1')
  params.set('namedetails', '1')
  return osmRequest(`${NOMINATIM_URL}${path}?${params}`, lang, APP_USER_AGENT)
}

function parseGoogleCoordinates(input: string): { lat: number; lng: number } | null {
  const patterns = [/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, /[?&](?:query|q)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/]
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (!match) continue
    const lat = finite(match[1]); const lng = finite(match[2])
    if (lat !== null && lng !== null) return { lat, lng }
  }
  return null
}

async function resolveGoogleUrl(rawUrl: string, lang?: string) {
  const url = new URL(rawUrl)
  const host = url.hostname.toLowerCase()
  const allowed = host === 'maps.app.goo.gl'
    || host === 'goo.gl'
    || /^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)
    || /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)
  if (!allowed) throw new Error('Unsupported map URL')

  let resolved = rawUrl
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') {
    const response = await fetch(rawUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': APP_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    })
    resolved = response.url
  }
  const coords = parseGoogleCoordinates(resolved)
  if (!coords) return { lat: null, lng: null, name: null, address: null }
  const raw = await nominatim('/reverse', new URLSearchParams({ lat: String(coords.lat), lon: String(coords.lng), zoom: '18' }), lang) as NominatimResult
  const place = normalize(raw)
  return place || { ...coords, name: null, address: null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json() as SearchBody
    const action = body.action || 'search'
    if (action === 'details') {
      // Search can still fall back to Google; its detail data is intentionally
      // outside this local cache feature.
      if (!['baidu', 'osm'].includes(body.provider || '')
        || !body.providerPlaceId || body.providerPlaceId.length > 200) {
        return json({ error: 'Invalid place details request' }, 400)
      }
      return json(await fetchPlaceDetails(body.provider!, body.providerPlaceId, body.lang, {
        baiduKey: Deno.env.get('BAIDU_MAPS_AK'),
        baiduSecurityKey: Deno.env.get('BAIDU_MAPS_SK'),
        osmUrl: NOMINATIM_URL,
        userAgent: APP_USER_AGENT,
      }))
    }
    if (action === 'search') {
      const q = body.q?.trim()
      if (!q || q.length > 200) return json({ error: 'Invalid search query' }, 400)
      const bounds = body.bounds
      if (bounds && ![bounds.low?.lat, bounds.low?.lng, bounds.high?.lat, bounds.high?.lng]
        .every(value => typeof value === 'number' && Number.isFinite(value))) {
        return json({ error: 'Invalid bounds' }, 400)
      }
      const providers = []
      const baiduKey = Deno.env.get('BAIDU_MAPS_AK')
      const baiduSecurityKey = Deno.env.get('BAIDU_MAPS_SK')
      const googleKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
      console.info('[place-search:configuration]', { baidu: Boolean(baiduKey), baiduSn: Boolean(baiduSecurityKey), google: Boolean(googleKey) })
      if (baiduKey) providers.push(new BaiduProvider(baiduKey, baiduSecurityKey))
      if (googleKey) providers.push(new GoogleProvider(googleKey))
      providers.push(new OSMProvider(NOMINATIM_URL, APP_USER_AGENT))
      return json(await searchWithFallback({ q, lang: body.lang, limit: clampLimit(body.limit), bounds }, providers))
    }

    if (action === 'reverse') {
      const lat = finite(body.lat); const lng = finite(body.lng)
      if (lat === null || lng === null) return json({ error: 'Invalid coordinates' }, 400)
      const raw = await nominatim('/reverse', new URLSearchParams({ lat: String(lat), lon: String(lng), zoom: '18' }), body.lang) as NominatimResult
      return json(normalize(raw) || { lat, lng, name: null, address: null })
    }

    if (action === 'resolve-url') {
      if (!body.url || body.url.length > 2048) return json({ error: 'Invalid map URL' }, 400)
      return json(await resolveGoogleUrl(body.url, body.lang))
    }

    return json({ error: 'Unsupported action' }, 400)
  } catch (error) {
    console.error('[place-search]', error)
    return json({ error: 'Place search is temporarily unavailable' }, 502)
  }
})
