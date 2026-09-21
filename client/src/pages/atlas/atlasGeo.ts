import type { GeoJsonFeatureCollection } from '../../types'

type Feature = GeoJsonFeatureCollection['features'][number]
let countriesPromise: Promise<GeoJsonFeatureCollection> | null = null
let regionsPromise: Promise<GeoJsonFeatureCollection> | null = null

async function load(name: 'admin0' | 'admin1'): Promise<GeoJsonFeatureCollection> {
  const response = await fetch(`${import.meta.env.BASE_URL}atlas/${name}.geojson.gz`)
  if (!response.ok) throw new Error(`Atlas boundary download failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const stream = new Blob([bytes as BlobPart]).stream()
  const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? stream.pipeThrough(new DecompressionStream('gzip')) : stream
  return JSON.parse(await new Response(decoded).text()) as GeoJsonFeatureCollection
}

export function countryGeo(): Promise<GeoJsonFeatureCollection> {
  return countriesPromise ??= load('admin0').catch(error => { countriesPromise = null; throw error })
}

export function regionGeo(): Promise<GeoJsonFeatureCollection> {
  return regionsPromise ??= load('admin1').catch(error => { regionsPromise = null; throw error })
}

export async function selectedRegionGeo(codes: string[]): Promise<GeoJsonFeatureCollection> {
  const all = await regionGeo()
  const selected = new Set(codes.map(code => code.toUpperCase()))
  return { type: 'FeatureCollection', features: all.features.filter(feature => selected.has(String(feature.properties?.iso_a2 || '').toUpperCase())) }
}

function inRing(point: [number, number], ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

const boundsCache = new WeakMap<Feature, [number, number, number, number]>()
function bounds(feature: Feature): [number, number, number, number] {
  const cached = boundsCache.get(feature)
  if (cached) return cached
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      minX = Math.min(minX, value[0]); maxX = Math.max(maxX, value[0])
      minY = Math.min(minY, value[1]); maxY = Math.max(maxY, value[1])
    } else for (const child of value) visit(child)
  }
  visit(feature.geometry.coordinates)
  const result: [number, number, number, number] = [minX, minY, maxX, maxY]
  boundsCache.set(feature, result)
  return result
}

function contains(feature: Feature, lat: number, lng: number): boolean {
  const [minX, minY, maxX, maxY] = bounds(feature)
  if (lng < minX || lng > maxX || lat < minY || lat > maxY) return false
  const geometry = feature.geometry as { type: string; coordinates: number[][][] | number[][][][] }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][]
  return polygons.some(rings => rings.length > 0 && inRing([lng, lat], rings[0]) && !rings.slice(1).some(hole => inRing([lng, lat], hole)))
}

export async function locatePoint(lat: number, lng: number): Promise<{ country_code: string | null; region_code: string | null; region_name: string | null }> {
  const code = await locateCountry(lat, lng)
  if (!code) return { country_code: null, region_code: null, region_name: null }
  const regions = await regionGeo()
  const region = regions.features.find(feature => String(feature.properties?.iso_a2 || '').toUpperCase() === code && contains(feature, lat, lng))
  return { country_code: code, region_code: String(region?.properties?.iso_3166_2 || '') || null, region_name: String(region?.properties?.name || '') || null }
}

export async function locateCountry(lat: number, lng: number): Promise<string | null> {
  const countries = await countryGeo()
  const country = countries.features.find(feature => contains(feature, lat, lng))
  const code = String(country?.properties?.ISO_A2 || '')
  return code && code !== '-99' ? code : null
}
