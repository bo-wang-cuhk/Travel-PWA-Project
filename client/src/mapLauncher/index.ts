import { wgs84ToBd09, wgs84ToGcj02 } from './coordinate'

export type MapProvider = 'google' | 'amap' | 'baidu' | 'apple'
export type MapProviderPreference = MapProvider | 'ask'

export interface MapLaunchPlace {
  name?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
}

export interface MapLaunchTarget {
  id: MapProvider
  label: string
  url: string
}

export const MAP_PROVIDER_OPTIONS: { value: MapProviderPreference; label: string; labelZh: string }[] = [
  { value: 'google', label: 'Google Maps', labelZh: 'Google 地图' },
  { value: 'amap', label: 'Amap', labelZh: '高德地图' },
  { value: 'baidu', label: 'Baidu Maps', labelZh: '百度地图' },
  { value: 'apple', label: 'Apple Maps', labelZh: 'Apple 地图' },
  { value: 'ask', label: 'Ask every time', labelZh: '每次询问' },
]

function validCoords(place: MapLaunchPlace): place is MapLaunchPlace & { lat: number; lng: number } {
  return Number.isFinite(place.lat) && Number.isFinite(place.lng)
}

function title(place: MapLaunchPlace): string {
  return place.name?.trim() || place.address?.trim() || ''
}

function fixed(value: number): string {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

export function buildMapUrl(place: MapLaunchPlace, provider: MapProvider): string | null {
  const label = title(place)
  if (!validCoords(place)) {
    if (!label) return null
    if (provider === 'google') return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`
    if (provider === 'apple') return `https://maps.apple.com/?q=${encodeURIComponent(label)}`
    return null
  }

  const wgs = { lat: place.lat, lng: place.lng }
  if (provider === 'google') {
    return `https://www.google.com/maps/search/?api=1&query=${fixed(wgs.lat)},${fixed(wgs.lng)}`
  }
  if (provider === 'apple') {
    const q = label ? `q=${encodeURIComponent(label)}&` : ''
    return `https://maps.apple.com/?${q}ll=${fixed(wgs.lat)},${fixed(wgs.lng)}`
  }
  if (provider === 'amap') {
    const gcj = wgs84ToGcj02(wgs)
    return `https://uri.amap.com/marker?position=${fixed(gcj.lng)},${fixed(gcj.lat)}&name=${encodeURIComponent(label)}&coordinate=gaode&callnative=1`
  }
  const bd = wgs84ToBd09(wgs)
  return `https://api.map.baidu.com/marker?location=${fixed(bd.lat)},${fixed(bd.lng)}&title=${encodeURIComponent(label)}&coord_type=bd09ll&output=html&src=webapp.roamune.travel`
}

export function getMapTargets(place: MapLaunchPlace, preference: MapProviderPreference = 'ask', language = 'zh'): MapLaunchTarget[] {
  const providers: MapProvider[] = preference === 'ask'
    ? ['google', 'amap', 'baidu', 'apple']
    : [preference]
  return providers.flatMap(provider => {
    const url = buildMapUrl(place, provider)
    if (!url) return []
    const option = MAP_PROVIDER_OPTIONS.find(item => item.value === provider)!
    return [{ id: provider, label: language.startsWith('zh') ? option.labelZh : option.label, url }]
  })
}
