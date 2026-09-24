import { baiduSignature } from './providers.ts'
import { osmRequest } from './osmRequest.ts'

export type DetailsProvider = 'baidu' | 'osm'

export interface ProviderPlaceDetails {
  rating?: number
  ratingCount?: number
  openingHours?: string
  phone?: string
  website?: string
  photoUrl?: string
  description?: string
  provider: DetailsProvider
  providerPlaceId: string
}

const value = (input: unknown): string | undefined =>
  typeof input === 'string' && input.trim() ? input.trim() : undefined
const numeric = (input: unknown): number | undefined => {
  if (input === null || input === undefined || input === '') return undefined
  const n = Number(input)
  return Number.isFinite(n) ? n : undefined
}
const safeUrl = (input: unknown): string | undefined => {
  const raw = value(input)
  if (!raw) return undefined
  try { return new URL(raw).protocol === 'https:' ? raw : undefined } catch { return undefined }
}

async function jsonResponse(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`Place details returned HTTP ${response.status}`)
  const data = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid place details response')
  return data as Record<string, unknown>
}

export async function fetchPlaceDetails(
  provider: DetailsProvider,
  providerPlaceId: string,
  lang: string | undefined,
  config: { baiduKey?: string; baiduSecurityKey?: string; osmUrl: string; userAgent: string },
): Promise<ProviderPlaceDetails> {
  if (provider === 'baidu') {
    if (!config.baiduKey) throw new Error('Baidu Maps is not configured')
    const path = '/place/v2/detail'
    const params = new URLSearchParams({ uid: providerPlaceId, output: 'json', scope: '2', ak: config.baiduKey })
    if (config.baiduSecurityKey) params.set('sn', baiduSignature(path, params, config.baiduSecurityKey))
    const data = await jsonResponse(`https://api.map.baidu.com${path}?${params}`)
    if (data.status !== 0) throw new Error(`Baidu status ${data.status ?? 'invalid'}: ${value(data.message) || ''}`)
    const result = Array.isArray(data.result) ? data.result[0] : data.result
    if (!result || typeof result !== 'object') throw new Error('Baidu place was not found')
    const place = result as Record<string, unknown>
    const info = place.detail_info && typeof place.detail_info === 'object'
      ? place.detail_info as Record<string, unknown> : {}
    const photos = Array.isArray(info.photos) ? info.photos : []
    const firstPhoto = photos[0]
    const photo = typeof firstPhoto === 'string' ? firstPhoto
      : firstPhoto && typeof firstPhoto === 'object' ? (firstPhoto as Record<string, unknown>).url : undefined
    return {
      provider, providerPlaceId,
      rating: numeric(info.overall_rating), ratingCount: numeric(info.comment_num),
      openingHours: value(info.shop_hours), phone: value(place.telephone),
      website: safeUrl(info.website), photoUrl: safeUrl(photo),
      description: value(info.description),
    }
  }

  const match = /^(node|way|relation|N|W|R):(\d+)$/i.exec(providerPlaceId)
  if (!match) throw new Error('Invalid OSM place ID')
  const osmType = ({ node: 'N', way: 'W', relation: 'R' } as Record<string, string>)[match[1].toLowerCase()] || match[1].toUpperCase()
  const params = new URLSearchParams({ osm_ids: `${osmType}${match[2]}`, format: 'jsonv2', extratags: '1' })
  const data = await osmRequest(`${config.osmUrl}/lookup?${params}`, lang, config.userAgent)
  if (!Array.isArray(data) || !data[0]) throw new Error('OSM place was not found')
  const tags = (data[0] as { extratags?: Record<string, string> }).extratags || {}
  return {
    provider, providerPlaceId,
    openingHours: value(tags.opening_hours),
    phone: value(tags.phone) || value(tags['contact:phone']),
    website: safeUrl(tags.website) || safeUrl(tags['contact:website']),
    description: value(tags.description),
    photoUrl: safeUrl(tags.image),
  }
}
