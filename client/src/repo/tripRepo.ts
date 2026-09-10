import { offlineDb, clearTripData } from '../db/offlineDb'
import type { Trip } from '../types'
import type { ActiveTripResponse, TripCreateRequest, TripUpdateRequest } from '@trek/shared'

export interface LocalTripOwner {
  id: number
  username?: string | null
}

const DEVELOPMENT_SEED_KEY = 'development-trip-seeded-v1'

function inclusiveDayCount(startDate?: string | null, endDate?: string | null): number | undefined {
  if (!startDate || !endDate) return undefined
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  return Math.round((end - start) / 86_400_000) + 1
}

async function nextLocalTripId(): Promise<number> {
  const first = await offlineDb.trips.orderBy('id').first()
  return first && first.id < 0 ? first.id - 1 : -1
}

function tripFromCreate(
  id: number,
  data: TripCreateRequest,
  owner: LocalTripOwner | undefined,
  now: string,
): Trip {
  return {
    id,
    user_id: owner?.id ?? 0,
    title: data.title,
    description: data.description ?? null,
    start_date: data.start_date ?? null,
    end_date: data.end_date ?? null,
    currency: data.currency ?? 'EUR',
    cover_image: null,
    is_archived: 0,
    reminder_days: data.reminder_days ?? 3,
    created_at: now,
    updated_at: now,
    day_count: inclusiveDayCount(data.start_date, data.end_date) ?? data.day_count ?? 7,
    place_count: 0,
    is_owner: 1,
    owner_username: owner?.username ?? undefined,
    shared_count: 0,
  }
}

/**
 * Write the development sample through the same IndexedDB used by the app.
 * appMeta makes this a one-time seed: deleting Japan 2026 does not recreate it.
 */
export async function ensureDevelopmentSeed(): Promise<void> {
  await offlineDb.transaction('rw', [offlineDb.trips, offlineDb.appMeta], async () => {
    if (await offlineDb.appMeta.get(DEVELOPMENT_SEED_KEY)) return
    if (await offlineDb.trips.count() === 0) {
      const now = new Date().toISOString()
      await offlineDb.trips.put(tripFromCreate(-1, {
        title: 'Japan 2026',
        description: 'Development seed trip',
        start_date: '2026-11-01',
        end_date: '2026-11-10',
        currency: 'JPY',
        reminder_days: 3,
      }, undefined, now))
    }
    await offlineDb.appMeta.put({ key: DEVELOPMENT_SEED_KEY, value: new Date().toISOString() })
  })
}

/**
 * Offline stand-in for GET /trips/active. Mirrors the server's ranking
 * (trips.service.ts activeTrip): the trip running today, else the next one to
 * start, else the most recently started. Dates are plain local calendar dates.
 */
function pickActive(trips: Trip[]): Trip | null {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const relevance = (t: Trip): number => {
    if (t.start_date && t.end_date && t.start_date <= today && t.end_date >= today) return 0
    if (t.start_date && t.start_date >= today) return 1
    return 2
  }
  const ranked = [...trips].sort((a, b) => {
    const ra = relevance(a)
    const rb = relevance(b)
    if (ra !== rb) return ra - rb
    // Upcoming: soonest first. Everything else: most recently started first.
    return ra === 2
      ? (b.start_date ?? '').localeCompare(a.start_date ?? '')
      : (a.start_date ?? '').localeCompare(b.start_date ?? '')
  })
  return ranked[0] ?? null
}

export const tripRepo = {
  async list(): Promise<{ trips: Trip[]; archivedTrips: Trip[] }> {
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test') await ensureDevelopmentSeed()
    const all = await offlineDb.trips.toArray()
    return {
      trips: all.filter(t => !t.is_archived),
      archivedTrips: all.filter(t => t.is_archived),
    }
  },

  /**
   * The startup redirect asks for this on the very first paint, so it has to
   * answer offline too — otherwise "open my active trip on startup" drops the
   * user on the dashboard whenever the launch has no network.
   */
  async active(): Promise<ActiveTripResponse> {
    const all = await offlineDb.trips.toArray()
    const trip = pickActive(all.filter(t => !t.is_archived))
    return {
      trip: trip
        ? { id: trip.id, title: trip.title, start_date: trip.start_date, end_date: trip.end_date }
        : null,
    }
  },

  async get(tripId: number | string): Promise<{ trip: Trip }> {
    const trip = await offlineDb.trips.get(Number(tripId))
    if (!trip) throw new Error('Trip not found in local database')
    return { trip }
  },

  async create(data: TripCreateRequest, owner?: LocalTripOwner): Promise<{ trip: Trip }> {
    return offlineDb.transaction('rw', offlineDb.trips, async () => {
      const trip = tripFromCreate(await nextLocalTripId(), data, owner, new Date().toISOString())
      await offlineDb.trips.add(trip)
      return { trip }
    })
  },

  async update(tripId: number | string, data: TripUpdateRequest): Promise<{ trip: Trip }> {
    const id = Number(tripId)
    return offlineDb.transaction('rw', offlineDb.trips, async () => {
      const current = await offlineDb.trips.get(id)
      if (!current) throw new Error('Trip not found in local database')
      const { date_shift_mode: _dateShiftMode, ...patch } = data
      void _dateShiftMode
      const trip: Trip = {
        ...current,
        ...patch,
        is_archived: patch.is_archived == null
          ? current.is_archived
          : Number(Boolean(patch.is_archived)),
        day_count: inclusiveDayCount(
          patch.start_date === undefined ? current.start_date : patch.start_date,
          patch.end_date === undefined ? current.end_date : patch.end_date,
        ) ?? patch.day_count ?? current.day_count,
        updated_at: new Date().toISOString(),
      }
      await offlineDb.trips.put(trip)
      return { trip }
    })
  },

  async delete(tripId: number | string): Promise<void> {
    const id = Number(tripId)
    if (!await offlineDb.trips.get(id)) throw new Error('Trip not found in local database')
    await clearTripData(id)
  },

  archive(tripId: number | string): Promise<{ trip: Trip }> {
    return this.update(tripId, { is_archived: 1 })
  },

  unarchive(tripId: number | string): Promise<{ trip: Trip }> {
    return this.update(tripId, { is_archived: 0 })
  },
}
