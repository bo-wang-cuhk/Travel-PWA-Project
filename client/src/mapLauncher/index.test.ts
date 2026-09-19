import { describe, expect, it } from 'vitest'
import { buildMapUrl, getMapTargets } from './index'
import { wgs84ToGcj02 } from './coordinate'

const place = { name: '天安门', lat: 39.9087, lng: 116.3975 }

describe('MapLauncher', () => {
  it('keeps WGS84 for Google and Apple', () => {
    expect(buildMapUrl(place, 'google')).toContain('39.9087,116.3975')
    expect(buildMapUrl(place, 'apple')).toContain('ll=39.9087,116.3975')
  })

  it('converts mainland coordinates only inside provider adapters', () => {
    const gcj = wgs84ToGcj02(place)
    expect(gcj.lat).not.toBe(place.lat)
    expect(gcj.lng).not.toBe(place.lng)
    expect(buildMapUrl(place, 'amap')).toContain(`${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`)
    expect(buildMapUrl(place, 'baidu')).toContain('coord_type=bd09ll')
  })

  it('returns every supported provider only for ask-every-time', () => {
    expect(getMapTargets(place, 'ask').map(target => target.id)).toEqual(['google', 'amap', 'baidu', 'apple'])
    expect(getMapTargets(place, 'amap').map(target => target.id)).toEqual(['amap'])
  })
})
