import { osmRequest } from '../../../../supabase/functions/place-search/osmRequest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaiduProvider, baiduSignature, GoogleProvider, OSMProvider, searchWithFallback } from '../../../../supabase/functions/place-search/providers'

const query = { q: '故宫', limit: 8 }
afterEach(() => vi.unstubAllGlobals())

describe('place-search fallback', () => {
  it('matches Baidu documented SN signature and signs requests when SK is configured', async () => {
    expect(baiduSignature('/geocoder/v2/', new URLSearchParams('address=%E7%99%BE%E5%BA%A6%E5%A4%A7%E5%8E%A6&output=json&ak=yourak'), 'yoursk'))
      .toBe('7de5a22212ffaa9e326444c75a58f9a0')
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 0, results: [] }) })
    vi.stubGlobal('fetch', fetch)
    await new BaiduProvider('ak', 'sk').search(query)
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('sn')).toMatch(/^[a-f0-9]{32}$/)
  })

  it('uses Baidu first and converts its coordinates to WGS84', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      status: 0, results: [{ uid: 'bd-1', name: '故宫博物院', address: '景山前街4号',
        location: { lat: 39.9171, lng: 116.4035 } }],
    }) })
    vi.stubGlobal('fetch', fetch)
    const google = { name: 'google' as const, search: vi.fn() }
    const result = await searchWithFallback(query, [new BaiduProvider('secret'), google])
    expect(result.source).toBe('baidu')
    expect(google.search).not.toHaveBeenCalled()
    expect(result.places[0]).toMatchObject({ name: '故宫博物院', source: 'baidu', externalPlaceId: 'bd-1' })
    expect(result.places[0].longitude).toBeLessThan(116.4035)
    expect(fetch.mock.calls[0][0]).toContain('ret_coordtype=gcj02ll')
    expect(fetch.mock.calls[0][0]).toContain('/place/v2/suggestion?')
    expect(fetch.mock.calls[0][0]).toContain('city_limit=false')
  })

  it('normalizes a Google Places response after Baidu fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 302 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ places: [{ id: 'ChIJ1',
        displayName: { text: '故宫博物院' }, formattedAddress: '北京市东城区景山前街4号',
        location: { latitude: 39.9163, longitude: 116.3972 } }] }) })
    vi.stubGlobal('fetch', fetch)
    const result = await searchWithFallback(query, [new BaiduProvider('secret'), new GoogleProvider('secret')])
    expect(result).toMatchObject({ source: 'google', places: [{ name: '故宫博物院',
      address: '北京市东城区景山前街4号', latitude: 39.9163, longitude: 116.3972,
      source: 'google', externalPlaceId: 'ChIJ1' }] })
    expect(fetch.mock.calls[1][1].headers['X-Goog-FieldMask']).toContain('places.location')
  })

  it('falls through quota and transport errors in order', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 302, message: 'quota' }) })
      .mockRejectedValueOnce(new Error('Google timeout'))
      .mockResolvedValueOnce({ ok: true, json: async () => [{ osm_type: 'way', osm_id: 123,
        name: '故宫', lat: '39.9163', lon: '116.3972', display_name: '故宫, 北京' }] })
    vi.stubGlobal('fetch', fetch)
    const result = await searchWithFallback(query, [new BaiduProvider('secret'), new GoogleProvider('secret'),
      new OSMProvider('https://nominatim.openstreetmap.org', 'test-agent')])
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ source: 'osm', places: [{ latitude: 39.9163, longitude: 116.3972,
      externalPlaceId: 'way:123' }] })
  })

  it('expands a one-place viewbox before sending it to OSM', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetch)
    await new OSMProvider('https://nominatim.openstreetmap.org', 'test-agent').search({
      ...query, bounds: { low: { lat: 30.638, lng: 119.682 }, high: { lat: 30.638, lng: 119.682 } },
    })
    const url = new URL(fetch.mock.calls[0][0])
    const [west, north, east, south] = url.searchParams.get('viewbox')!.split(',').map(Number)
    expect(west).toBeCloseTo(119.632)
    expect(north).toBeCloseTo(30.688)
    expect(east).toBeCloseTo(119.732)
    expect(south).toBeCloseTo(30.588)
  })

  it('returns a successful empty result without calling later providers', async () => {
    const google = { name: 'google' as const, search: vi.fn() }
    const result = await searchWithFallback(query, [{ name: 'baidu', search: async () => [] }, google])
    expect(result).toEqual({ source: 'baidu', places: [] })
    expect(google.search).not.toHaveBeenCalled()
  })

  it('spaces OSM search and reverse requests in the same Edge isolate', async () => {
    const starts: number[] = []
    vi.stubGlobal('fetch', vi.fn(async () => {
      starts.push(Date.now())
      return { ok: true, json: async () => [] }
    }))
    await Promise.all([
      osmRequest('https://nominatim.openstreetmap.org/search', 'zh', 'test-agent'),
      osmRequest('https://nominatim.openstreetmap.org/reverse', 'zh', 'test-agent'),
    ])
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_000)
  })

  it('reports unavailability after every provider fails', async () => {
    await expect(searchWithFallback(query, [{ name: 'baidu', search: async () => { throw new Error('down') } }]))
      .rejects.toThrow('temporarily unavailable')
  })
})
