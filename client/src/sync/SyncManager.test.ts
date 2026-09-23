import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { tripRepo } from '../repo/tripRepo'
import { dayRepo } from '../repo/dayRepo'
import { dayNoteRepo } from '../repo/dayNoteRepo'
import { placeRepo } from '../repo/placeRepo'
import { categoryRepo } from '../repo/categoryRepo'
import { collectionRepo } from '../repo/collectionRepo'
import { assignmentRepo } from '../repo/assignmentRepo'
import { accommodationRepo } from '../repo/accommodationRepo'
import { reservationRepo } from '../repo/reservationRepo'
import { budgetRepo } from '../repo/budgetRepo'
import { todoRepo } from '../repo/todoRepo'
import { packingRepo } from '../repo/packingRepo'
import { vacayRepo } from '../repo/vacayRepo'
import { fileRepo } from '../repo/fileRepo'
import type { LocalChange, ProviderStatus, PushResult, RemoteChanges, SyncEntityType, SyncProvider } from './types'
import type { TripFile } from '../types'
import { SyncManager } from './SyncManager'
import { emptyAtlas } from '../domain/atlasSyncModel'
import { markLocalChange } from './localChangeRepository'

class MemoryProvider implements SyncProvider {
  readonly id: string
  connected = false
  fail = false
  cursor = 0
  remote = new Map<string, { entityType: SyncEntityType; version: string; deleted: boolean; payload?: unknown }>()
  attachments = new Map<string, Blob>()

  constructor(id = 'memory') { this.id = id }

  async connect(): Promise<ProviderStatus> {
    if (this.fail) throw new Error('provider unavailable')
    this.connected = true
    return { connected: true }
  }
  async disconnect(): Promise<void> { this.connected = false }
  async getStatus(): Promise<ProviderStatus> { return { connected: this.connected } }
  async uploadAttachment(path: string, blob: Blob): Promise<void> { this.attachments.set(path, blob) }
  async downloadAttachment(path: string): Promise<Blob> {
    const blob = this.attachments.get(path)
    if (!blob) throw new Error('attachment missing')
    return blob
  }
  async pull(cursor?: string | null): Promise<RemoteChanges> {
    if (this.fail) throw new Error('provider unavailable')
    const current = `c${this.cursor}`
    if (cursor === current) return { cursor: current, changes: [] }
    return {
      cursor: current,
      changes: [...this.remote.entries()].map(([entityId, row]) => ({
        entityType: row.entityType,
        entityId,
        operation: row.deleted ? 'delete' : 'upsert',
        remoteVersion: row.version,
        payload: row.payload,
      })),
    }
  }
  async push(changes: LocalChange[]): Promise<PushResult> {
    if (this.fail) throw new Error('provider unavailable')
    const versions: Record<string, string> = {}
    for (const change of changes) {
      const version = `v${++this.cursor}`
      versions[change.entityId] = version
      this.remote.set(change.entityId, { entityType: change.entityType, version, deleted: change.operation === 'delete', payload: change.payload })
    }
    return { cursor: `c${this.cursor}`, versions }
  }
  editRemote(entityId: string, payload: unknown, entityType: SyncEntityType = 'trip'): void {
    const version = `v${++this.cursor}`
    this.remote.set(entityId, { entityType, version, deleted: false, payload })
  }
  deleteRemote(entityId: string): void {
    const version = `v${++this.cursor}`
    const current = this.remote.get(entityId)
    this.remote.set(entityId, { entityType: current?.entityType ?? 'trip', version, deleted: true, payload: current?.payload })
  }
}

class LastWriteWinsProvider extends MemoryProvider {
  readonly syncMode = 'last-write-wins' as const
  constructor() { super('supabase') }
}

beforeEach(async () => { await clearAll() })

describe('local-first SyncManager', () => {
  it('pushes a personal Atlas document and restores it on a fresh device', async () => {
    const provider = new LastWriteWinsProvider()
    const owner = '22222222-2222-4222-8222-222222222222'
    await offlineDb.transaction('rw', [offlineDb.atlasData, offlineDb.syncOutbox, offlineDb.entitySyncMeta], async () => {
      await offlineDb.atlasData.put({ ...emptyAtlas(owner), manualCountries: ['JP'] })
      await markLocalChange('atlas', owner, 'upsert')
    })
    expect((await new SyncManager(provider).sync()).pushed).toBe(1)
    expect(provider.remote.get(owner)?.payload).toMatchObject({ manualCountries: ['JP'] })
    await clearAll()
    expect((await new SyncManager(provider).sync()).pulled).toBe(1)
    expect((await offlineDb.atlasData.get(owner))?.manualCountries).toEqual(['JP'])
  })
  it('syncs attachment metadata and binary body to a fresh device', async () => {
    if (!URL.createObjectURL) Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test' })
    const provider = new LastWriteWinsProvider()
    const trip = (await tripRepo.create({ title: 'Files', day_count: 0 })).trip
    const form = new FormData()
    form.append('file', new File(['ticket'], 'ticket.pdf', { type: 'application/pdf' }))
    const local = (await fileRepo.create(trip.id, form)).file as TripFile & { sync_id: string; storage_path: string }
    expect((await offlineDb.syncOutbox.toArray()).map(row => row.entityType)).toContain('tripFile')
    expect(await offlineDb.tripFileBlobs.get(local.sync_id)).toBeTruthy()
    await new SyncManager(provider).sync()
    expect(provider.attachments.size).toBe(1)

    await clearAll()
    await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    const pulled = (await fileRepo.list(pulledTrip.id)).files[0] as typeof local
    expect(pulled.original_name).toBe('ticket.pdf')
    expect(await offlineDb.tripFileBlobs.get(pulled.sync_id)).toBeTruthy()
    expect(pulled.file_size).toBe(6)
  })

  it('Scenario A: local Trip is pushed after IndexedDB has already accepted it', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Tokyo', day_count: 0 })
    expect((await tripRepo.list()).trips[0].title).toBe('Tokyo')

    const result = await new SyncManager(provider).sync()
    expect(result.pushed).toBe(1)
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Tokyo' })
    expect(await offlineDb.syncOutbox.count()).toBe(0)
  })

  it('Scenario B: an empty device pulls a Trip and assigns only a local compatibility id', async () => {
    const provider = new MemoryProvider()
    const first = await tripRepo.create({ title: 'Lisbon', day_count: 0 })
    await new SyncManager(provider).sync()
    const syncId = first.trip.sync_id

    await clearAll()
    const result = await new SyncManager(provider).sync()
    const rows = (await tripRepo.list()).trips
    expect(result.pulled).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Lisbon', sync_id: syncId })
    expect(rows[0].id).toBeLessThan(0)
  })

  it('Scenario C: an offline edit remains local and is pushed by a later sync', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Before', day_count: 0 })
    await new SyncManager(provider).sync()
    await tripRepo.update(created.trip.id, { title: 'Offline edit' })
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Offline edit')

    await new SyncManager(provider).sync()
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Offline edit' })
  })

  it('Scenario D: provider failure cannot roll back a local create', async () => {
    const provider = new MemoryProvider()
    provider.fail = true
    const created = await tripRepo.create({ title: 'Safe locally', day_count: 0 })

    await expect(new SyncManager(provider).sync()).rejects.toThrow('provider unavailable')
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Safe locally')
    expect(await offlineDb.syncOutbox.count()).toBe(1)
    expect((await offlineDb.syncState.get('memory'))?.status).toBe('error')
  })

  it('Scenario E: concurrent local and remote edits are retained as a conflict', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Base', day_count: 0 })
    await new SyncManager(provider).sync()
    await tripRepo.update(created.trip.id, { title: 'Local' })
    const remote = provider.remote.get(created.trip.sync_id)!.payload as Record<string, unknown>
    provider.editRemote(created.trip.sync_id, { ...remote, title: 'Remote', updatedAt: new Date().toISOString() })

    const result = await new SyncManager(provider).sync()
    const conflict = await offlineDb.syncConflicts.get(`trip:${created.trip.sync_id}`)
    expect(result.conflicts).toBe(1)
    expect(conflict?.localSnapshot).toMatchObject({ title: 'Local' })
    expect(conflict?.remoteSnapshot).toMatchObject({ title: 'Remote' })
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Local')
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Remote' })
  })

  it('Supabase LWW uploads pending data first and never creates a manual conflict', async () => {
    const provider = new LastWriteWinsProvider()
    const created = await tripRepo.create({ title: 'Base', day_count: 0 })
    await new SyncManager(provider).sync()
    await tripRepo.update(created.trip.id, { title: 'Last local write' })
    const remote = provider.remote.get(created.trip.sync_id)!.payload as Record<string, unknown>
    provider.editRemote(created.trip.sync_id, { ...remote, title: 'Earlier remote write' })

    const result = await new SyncManager(provider).sync()

    expect(result.conflicts).toBe(0)
    expect(provider.remote.get(created.trip.sync_id)?.payload).toMatchObject({ title: 'Last local write' })
    expect((await tripRepo.get(created.trip.id)).trip.title).toBe('Last local write')
    expect(await offlineDb.syncConflicts.count()).toBe(0)
    expect(await offlineDb.syncOutbox.count()).toBe(0)
  })

  it('propagates a remote tombstone without physically deleting the local row', async () => {
    const provider = new MemoryProvider()
    const created = await tripRepo.create({ title: 'Temporary', day_count: 0 })
    await new SyncManager(provider).sync()
    provider.deleteRemote(created.trip.sync_id)

    await new SyncManager(provider).sync()

    expect((await tripRepo.list()).trips).toEqual([])
    expect((await offlineDb.trips.get(created.trip.id))?.deleted_at).toBeTruthy()
  })

  it('pushes and pulls a Day after its parent Trip using stable UUID references', async () => {
    const provider = new MemoryProvider()
    const trip = await tripRepo.create({ title: 'Osaka', day_count: 0 })
    const day = await dayRepo.create(trip.trip.id, { notes: 'Food tour' })

    await new SyncManager(provider).sync()
    expect(provider.remote.get(day.day.sync_id)?.payload).toMatchObject({
      id: day.day.sync_id,
      tripId: trip.trip.sync_id,
      notes: 'Food tour',
    })

    await clearAll()
    await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    const pulledDays = (await dayRepo.list(pulledTrip.id)).days
    expect(pulledDays).toHaveLength(1)
    expect(pulledDays[0]).toMatchObject({ sync_id: day.day.sync_id, trip_sync_id: trip.trip.sync_id, notes: 'Food tour' })
    expect(pulledDays[0].id).toBeLessThan(0)
  })

  it('pushes and pulls individual Day notes as first-class itinerary data', async () => {
    const provider = new LastWriteWinsProvider()
    const { trip } = await tripRepo.create({ title: 'Notebook', day_count: 1 })
    const day = (await dayRepo.list(trip.id)).days[0]
    const { note } = await dayNoteRepo.create(trip.id, day.id, { text: 'Train at nine', color: '#fff4cc' })

    await new SyncManager(provider).sync()
    expect(provider.remote.get(note.sync_id)?.payload).toMatchObject({
      tripId: trip.sync_id, dayId: (await offlineDb.days.get(day.id))!.sync_id, text: 'Train at nine',
    })

    await clearAll()
    await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    const pulledDay = (await dayRepo.list(pulledTrip.id)).days[0]
    expect(pulledDay.notes_items).toMatchObject([{ text: 'Train at nine', color: '#fff4cc' }])
  })

  it('retains both versions when the same Day changes locally and remotely', async () => {
    const provider = new MemoryProvider()
    const trip = await tripRepo.create({ title: 'Seoul', day_count: 0 })
    const day = await dayRepo.create(trip.trip.id)
    await new SyncManager(provider).sync()
    await dayRepo.update(trip.trip.id, day.day.id, { title: 'Local day' })
    const remote = provider.remote.get(day.day.sync_id)!.payload as Record<string, unknown>
    provider.editRemote(day.day.sync_id, { ...remote, title: 'Remote day', updatedAt: new Date().toISOString() }, 'day')

    const result = await new SyncManager(provider).sync()
    expect(result.conflicts).toBe(1)
    expect(await offlineDb.syncConflicts.get(`day:${day.day.sync_id}`)).toMatchObject({
      localSnapshot: { title: 'Local day' },
      remoteSnapshot: { title: 'Remote day' },
    })
    expect((await dayRepo.get(day.day.id)).day.title).toBe('Local day')
  })

  it('pushes and pulls Place and Assignment after their parent entities', async () => {
    const provider = new MemoryProvider()
    const { trip } = await tripRepo.create({ title: 'Nara', day_count: 1 })
    const day = (await dayRepo.list(trip.id)).days[0]
    const { place } = await placeRepo.create(trip.id, { name: 'Tōdai-ji', lat: 34.689 })
    const { assignment } = await assignmentRepo.create(trip.id, day.id, place.id)
    await assignmentRepo.updateTime(trip.id, assignment.id, { place_time: '09:30' })

    await new SyncManager(provider).sync()
    expect(provider.remote.get(place.sync_id)?.payload).toMatchObject({ id: place.sync_id, tripId: trip.sync_id, name: 'Tōdai-ji' })
    expect(provider.remote.get((await offlineDb.assignments.get(assignment.id))!.sync_id!)?.payload).toMatchObject({
      tripId: trip.sync_id,
      dayId: (await offlineDb.days.get(day.id))!.sync_id,
      placeId: place.sync_id,
      assignmentTime: '09:30',
    })

    await clearAll()
    await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    const pulledDay = (await dayRepo.list(pulledTrip.id)).days[0]
    const pulledPlace = (await placeRepo.list(pulledTrip.id)).places[0]
    const pulledAssignments = await assignmentRepo.listByDay(pulledDay.id)
    expect(pulledPlace).toMatchObject({ name: 'Tōdai-ji', sync_id: place.sync_id })
    expect(pulledAssignments[0]).toMatchObject({ place_id: pulledPlace.id, assignment_time: '09:30' })
  })

  it('retains both versions when the same Assignment changes locally and remotely', async () => {
    const provider = new MemoryProvider()
    const { trip } = await tripRepo.create({ title: 'Tokyo', day_count: 1 })
    const day = (await dayRepo.list(trip.id)).days[0]
    const { place } = await placeRepo.create(trip.id, { name: 'Market' })
    const { assignment } = await assignmentRepo.create(trip.id, day.id, place.id)
    await new SyncManager(provider).sync()
    const stored = await offlineDb.assignments.get(assignment.id)
    await assignmentRepo.updateNotes(trip.id, assignment.id, 'Local note')
    const remote = provider.remote.get(stored!.sync_id!)!.payload as Record<string, unknown>
    provider.editRemote(stored!.sync_id!, { ...remote, notes: 'Remote note', updatedAt: new Date().toISOString() }, 'assignment')

    const result = await new SyncManager(provider).sync()
    expect(result.conflicts).toBe(1)
    expect(await offlineDb.syncConflicts.get(`assignment:${stored!.sync_id}`)).toMatchObject({
      localSnapshot: { notes: 'Local note' }, remoteSnapshot: { notes: 'Remote note' },
    })
    expect((await offlineDb.assignments.get(assignment.id))?.notes).toBe('Local note')
  })

  it('pushes and pulls Accommodation and Reservation with UUID relations', async () => {
    const provider = new MemoryProvider()
    const trip = await tripRepo.create({ title: 'Rome', day_count: 0 })
    const day = await dayRepo.create(trip.trip.id)
    const place = await placeRepo.create(trip.trip.id, { name: 'Hotel' })
    const accommodation = await accommodationRepo.create(trip.trip.id, { place_id: place.place.id, start_day_id: day.day.id, end_day_id: day.day.id })
    const reservation = await reservationRepo.create(trip.trip.id, { title: 'Hotel booking', type: 'hotel', day_id: day.day.id, accommodation_id: accommodation.accommodation.id })

    await new SyncManager(provider).sync()
    expect(provider.remote.get((await offlineDb.accommodations.get(accommodation.accommodation.id))!.sync_id!)?.payload).toMatchObject({ tripId: trip.trip.sync_id, placeId: place.place.sync_id, startDayId: day.day.sync_id })
    const reservationSyncId = (await offlineDb.reservations.get(reservation.reservation.id))!.sync_id!
    expect(provider.remote.get(reservationSyncId)?.payload).toMatchObject({ title: 'Hotel booking', accommodationId: (await offlineDb.accommodations.get(accommodation.accommodation.id))!.sync_id })

    await clearAll(); await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    expect((await accommodationRepo.list(pulledTrip.id)).accommodations[0]).toMatchObject({ place_name: 'Hotel' })
    expect((await reservationRepo.list(pulledTrip.id)).reservations[0]).toMatchObject({ title: 'Hotel booking' })
  })

  it('pushes and pulls an Expense after its Trip, Place, and Reservation', async () => {
    const provider = new MemoryProvider()
    const { trip } = await tripRepo.create({ title: 'Paris', day_count: 0 })
    const { place } = await placeRepo.create(trip.id, { name: 'Cafe' })
    const { reservation } = await reservationRepo.create(trip.id, { title: 'Lunch', type: 'restaurant', place_id: place.id })
    const { item } = await budgetRepo.create(trip.id, { name: 'Lunch', category: 'food', total_price: 42, place_id: place.id, reservation_id: reservation.id })
    const syncId = (await offlineDb.budgetItems.get(item.id))!.sync_id!

    await new SyncManager(provider).sync()
    expect(provider.remote.get(syncId)?.payload).toMatchObject({ tripId: trip.sync_id, placeId: place.sync_id, totalPrice: 42 })

    await clearAll(); await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    const pulled = (await budgetRepo.list(pulledTrip.id)).items[0]
    expect(pulled).toMatchObject({ name: 'Lunch', total_price: 42 })
    expect((await offlineDb.budgetItems.get(pulled.id))?.reservation_sync_id).toBeTruthy()
  })

  it('pushes and pulls categories, place ratings, collections, and saved places', async () => {
    const provider = new LastWriteWinsProvider()
    const { category } = await categoryRepo.create({ name: 'Museum', color: '#334455', icon: 'Landmark' })
    const { trip } = await tripRepo.create({ title: 'Madrid', day_count: 0 })
    const { place } = await placeRepo.create(trip.id, { name: 'Prado', category_id: category.id })
    await placeRepo.rate(trip.id, place.id, 5)
    const collection = await collectionRepo.create({ name: 'Art' })
    const saved = await collectionRepo.saveFromTrip({ collection_id: collection.id, source_trip_id: trip.id, source_place_id: place.id })

    await new SyncManager(provider).sync()
    expect(provider.remote.get(category.sync_id)?.payload).toMatchObject({ name: 'Museum' })
    expect(provider.remote.get(place.sync_id)?.payload).toMatchObject({ categoryId: category.sync_id, ratings: [expect.objectContaining({ rating: 5 })] })
    expect(provider.remote.get(saved.place!.sync_id)?.payload).toMatchObject({ collectionId: expect.any(String), value: expect.objectContaining({ name: 'Prado' }) })

    await clearAll()
    await new SyncManager(provider).sync()
    const pulledCategory = (await categoryRepo.list()).categories[0]
    const pulledTrip = (await tripRepo.list()).trips[0]
    const pulledPlace = (await placeRepo.list(pulledTrip.id)).places[0]
    const pulledCollection = (await collectionRepo.list()).collections[0]
    const pulledSaved = (await collectionRepo.get(pulledCollection.id)).places[0]
    expect(pulledCategory).toMatchObject({ name: 'Museum' })
    expect(pulledPlace).toMatchObject({ name: 'Prado', category_id: pulledCategory.id, rating_avg: 5, rating_count: 1 })
    expect(pulledSaved).toMatchObject({ name: 'Prado', source_place_id: pulledPlace.id })

    provider.deleteRemote(category.sync_id)
    await new SyncManager(provider).sync()
    expect((await categoryRepo.list()).categories).toEqual([])
    expect((await placeRepo.list(pulledTrip.id)).places[0]).toMatchObject({ category_id: null, category: null })
  })

  it('marks concurrent Expense edits as a conflict without overwriting local data', async () => {
    const provider = new MemoryProvider()
    const { trip } = await tripRepo.create({ title: 'Berlin', day_count: 0 })
    const { item } = await budgetRepo.create(trip.id, { name: 'Train', total_price: 10 })
    const syncId = (await offlineDb.budgetItems.get(item.id))!.sync_id!
    await new SyncManager(provider).sync()
    await budgetRepo.update(trip.id, item.id, { total_price: 12 })
    const remote = provider.remote.get(syncId)!.payload as Record<string, unknown>
    provider.editRemote(syncId, { ...remote, totalPrice: 15, updatedAt: new Date().toISOString() }, 'budgetItem')

    const result = await new SyncManager(provider).sync()
    expect(result.conflicts).toBe(1)
    expect(await offlineDb.syncConflicts.get(`budgetItem:${syncId}`)).toMatchObject({
      localSnapshot: { totalPrice: 12 }, remoteSnapshot: { totalPrice: 15 },
    })
    expect((await budgetRepo.list(trip.id)).items[0].total_price).toBe(12)
  })

  it('pushes and pulls Todo, Packing and the personal Vacay calendar', async () => {
    const provider = new MemoryProvider(); const { trip } = await tripRepo.create({ title: 'Local-first', day_count: 0 })
    const todo = await todoRepo.create(trip.id, { name: 'Check passport' })
    const bag = await packingRepo.createBag(trip.id, { name: 'Carry-on' })
    const item = await packingRepo.create(trip.id, { name: 'Passport', bag_id: bag.bag.id })
    await packingRepo.saveAsTemplate(trip.id, 'Essentials')
    await vacayRepo.toggleEntry('2026-06-20', 1)
    await new SyncManager(provider).sync()
    const todoId = (await offlineDb.todoItems.get(todo.item.id))!.sync_id!
    const itemId = (await offlineDb.packingItems.get(item.item.id))!.sync_id!
    expect(provider.remote.get(todoId)?.payload).toMatchObject({ name: 'Check passport', tripId: trip.sync_id })
    expect(provider.remote.get(itemId)?.payload).toMatchObject({ name: 'Passport', bagId: (await offlineDb.packingBags.get(bag.bag.id))!.sync_id })
    expect(provider.remote.get('personal-vacay')?.payload).toMatchObject({ entries: [{ date: '2026-06-20' }] })
    expect(provider.remote.get('personal-packing')?.payload).toMatchObject({ templates: [{ name: 'Essentials' }] })

    await clearAll(); await new SyncManager(provider).sync()
    const pulledTrip = (await tripRepo.list()).trips[0]
    expect((await todoRepo.list(pulledTrip.id)).items[0].name).toBe('Check passport')
    expect((await packingRepo.listBags(pulledTrip.id)).bags[0].name).toBe('Carry-on')
    expect((await packingRepo.list(pulledTrip.id)).items[0].bag_id).toBeLessThan(0)
    expect((await packingRepo.listTemplates()).templates[0].name).toBe('Essentials')
    expect((await vacayRepo.getEntries(2026)).entries[0].date).toBe('2026-06-20')
  })

  it('detects a concurrent Vacay edit without overwriting local dates', async () => {
    const provider = new MemoryProvider(); await vacayRepo.toggleEntry('2026-01-01', 1); await new SyncManager(provider).sync()
    await vacayRepo.toggleEntry('2026-01-02', 1)
    const remote = provider.remote.get('personal-vacay')!.payload as Record<string, unknown>
    provider.editRemote('personal-vacay', { ...remote, entries: [{ date: '2026-01-03', user_id: 1 }], updatedAt: new Date().toISOString() }, 'vacay')
    const result = await new SyncManager(provider).sync()
    expect(result.conflicts).toBe(1); expect((await vacayRepo.getEntries(2026)).entries.map(v => v.date)).toContain('2026-01-02')
    expect(await offlineDb.syncConflicts.get('vacay:personal-vacay')).toBeDefined()
  })
})
