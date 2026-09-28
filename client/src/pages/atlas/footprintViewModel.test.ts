import { describe, it, expect, afterEach } from 'vitest'
import { filterFootprintPoints, footprintBounds, readFootprintViewMode, FOOTPRINT_VIEW_KEY } from './footprintViewModel'
afterEach(() => localStorage.removeItem(FOOTPRINT_VIEW_KEY))
describe('footprint views', () => {
  const points = [
    { lat: 39.9, lng: 116.4, countryCode: 'CN' },
    { lat: 22.3, lng: 114.2, countryCode: 'HK' },
    { lat: 35.7, lng: 139.7, countryCode: 'JP' },
  ]
  it('defaults to China and remembers a valid global preference', () => {
    expect(readFootprintViewMode()).toBe('china')
    localStorage.setItem(FOOTPRINT_VIEW_KEY, 'global')
    expect(readFootprintViewMode()).toBe('global')
    localStorage.setItem(FOOTPRINT_VIEW_KEY, 'invalid')
    expect(readFootprintViewMode()).toBe('china')
  })
  it('strictly limits China to CN without mutating the full set', () => {
    expect(filterFootprintPoints(points, 'china')).toEqual([points[0]])
    expect(filterFootprintPoints(points, 'global')).toEqual(points)
    expect(points).toHaveLength(3)
  })
  it('ignores invalid coordinates and supports zero coordinates', () => {
    expect(filterFootprintPoints([{lat: 0, lng: 0, countryCode: 'CN'}, {lat: NaN, lng: 1, countryCode: 'CN'}], 'china')).toHaveLength(1)
  })
  it('handles empty and one-place views', () => {
    expect(footprintBounds([])).toBeNull()
    expect(footprintBounds([points[0]])).toEqual([[39.9, 116.4], [39.9, 116.4]])
  })
  it('takes the short arc across the date line', () => {
    const bounds = footprintBounds([{lat: 10, lng: 179, countryCode: 'FJ'}, {lat: 12, lng: -179, countryCode: 'FJ'}])!
    expect(bounds[1][1] - bounds[0][1]).toBe(2)
    expect(bounds[0][0]).toBe(10)
    expect(bounds[1][0]).toBe(12)
  })
})
