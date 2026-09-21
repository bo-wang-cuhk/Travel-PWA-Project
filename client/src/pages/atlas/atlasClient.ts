import apiClient from '../../api/client'
import { STANDALONE_MODE } from '../../config/runtimeMode'
import { addBucket, atlasRecord, atlasStats, countryDetail, deleteBucket, markCountry, markRegion, unmarkCountry, unmarkRegion, visitedRegions } from './atlasRepository'
import { countryGeo, locatePoint, selectedRegionGeo } from './atlasGeo'

/** Compatibility boundary: the TREK Server path remains available outside PWA mode. */
const atlasClient = {
  async get(path: string, config?: { params?: Record<string, unknown>; timeout?: number }): Promise<{ data: any }> {
    if (!STANDALONE_MODE) return apiClient.get(path, config)
    if (path === '/addons/atlas/stats') return { data: await atlasStats() }
    if (path === '/addons/atlas/bucket-list') return { data: { items: (await atlasRecord()).bucketItems } }
    if (path === '/addons/atlas/countries/geo') return { data: await countryGeo() }
    if (path.startsWith('/addons/atlas/regions/geo')) {
      const codes = new URLSearchParams(path.split('?')[1] || '').get('countries')?.split(',') || []
      return { data: await selectedRegionGeo(codes) }
    }
    if (path.startsWith('/addons/atlas/regions')) return { data: { regions: await visitedRegions() } }
    if (path === '/addons/atlas/locate') return { data: await locatePoint(Number(config?.params?.lat), Number(config?.params?.lng)) }
    const country = path.match(/^\/addons\/atlas\/country\/([^/]+)$/)
    if (country) return { data: await countryDetail(decodeURIComponent(country[1])) }
    throw new Error(`Unknown local Atlas read: ${path}`)
  },
  async post(path: string, body?: any): Promise<{ data: any }> {
    if (!STANDALONE_MODE) return apiClient.post(path, body)
    const country = path.match(/^\/addons\/atlas\/country\/([^/]+)\/mark$/)
    if (country) { await markCountry(decodeURIComponent(country[1])); return { data: { ok: true } } }
    const region = path.match(/^\/addons\/atlas\/region\/([^/]+)\/mark$/)
    if (region) { await markRegion(decodeURIComponent(region[1]), String(body?.name || ''), String(body?.country_code || '')); return { data: { ok: true } } }
    if (path === '/addons/atlas/bucket-list') return { data: { item: await addBucket(body) } }
    throw new Error(`Unknown local Atlas write: ${path}`)
  },
  async delete(path: string): Promise<{ data: any }> {
    if (!STANDALONE_MODE) return apiClient.delete(path)
    const country = path.match(/^\/addons\/atlas\/country\/([^/]+)\/mark$/)
    if (country) { await unmarkCountry(decodeURIComponent(country[1])); return { data: { ok: true } } }
    const region = path.match(/^\/addons\/atlas\/region\/([^/]+)\/mark$/)
    if (region) { await unmarkRegion(decodeURIComponent(region[1])); return { data: { ok: true } } }
    const bucket = path.match(/^\/addons\/atlas\/bucket-list\/([^/]+)$/)
    if (bucket) { await deleteBucket(decodeURIComponent(bucket[1])); return { data: { ok: true } } }
    throw new Error(`Unknown local Atlas delete: ${path}`)
  },
}

export default atlasClient
