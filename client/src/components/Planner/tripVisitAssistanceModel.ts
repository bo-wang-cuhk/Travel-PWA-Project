import type { Place, Trip } from '../../types'
import type { GeoPosition } from '../../hooks/useGeolocation'
import { haversineKm } from '../../utils/geo'

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function visitAssistancePhase(trip: Pick<Trip, 'start_date' | 'end_date'>, today = localDateKey()): 'active' | 'ended' | 'other' {
  if (!trip.start_date || !trip.end_date) return 'other'
  if (today > trip.end_date.slice(0, 10)) return 'ended'
  if (today >= trip.start_date.slice(0, 10)) return 'active'
  return 'other'
}

export function nearestUnpromptedPlace(places: Place[], position: GeoPosition, prompted: ReadonlySet<number>): Place | null {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng) || !Number.isFinite(position.accuracy) || position.accuracy > 100) return null
  if (!Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 60_000) return null
  let nearest: Place | null = null
  let distance = 0.1
  for (const place of places) {
    if ((place.visit_status ?? 'planned') !== 'planned' || prompted.has(place.id)) continue
    if (place.lat == null || place.lng == null || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue
    const km = haversineKm(position, { lat: place.lat, lng: place.lng })
    if (km <= distance) { nearest = place; distance = km }
  }
  return nearest
}
