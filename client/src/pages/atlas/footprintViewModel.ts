export type FootprintViewMode = 'china' | 'global'
export interface FootprintPoint { lat: number; lng: number; countryCode: string }
export const FOOTPRINT_VIEW_KEY = 'trek_footprint_view_mode'
export function readFootprintViewMode(): FootprintViewMode {
  try { return localStorage.getItem(FOOTPRINT_VIEW_KEY) === 'global' ? 'global' : 'china' } catch { return 'china' }
}
export function filterFootprintPoints(points: FootprintPoint[], mode: FootprintViewMode): FootprintPoint[] {
  return points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && (mode === 'global' || p.countryCode === 'CN'))
}
/** Smallest longitude arc, including points across the date line. Leaflet uses lat/lng. */
export function footprintBounds(points: FootprintPoint[]): [[number, number], [number, number]] | null {
  if (!points.length) return null
  if (points.length === 1) return [[points[0].lat, points[0].lng], [points[0].lat, points[0].lng]]
  const lngs = points.map(p => (p.lng + 360) % 360).sort((a, b) => a - b)
  let gap = -1, start = lngs[0]
  for (let i = 0; i < lngs.length; i++) {
    const next = i + 1 < lngs.length ? lngs[i + 1] : lngs[0] + 360
    if (next - lngs[i] > gap) { gap = next - lngs[i]; start = next % 360 }
  }
  let end = start + 360 - gap
  if ((start + end) / 2 > 180) { start -= 360; end -= 360 }
  return [[Math.min(...points.map(p => p.lat)), start], [Math.max(...points.map(p => p.lat)), end]]
}
