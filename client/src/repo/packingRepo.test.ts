import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { packingRepo } from './packingRepo'

beforeEach(async () => {
  await clearAll()
  await offlineDb.trips.put({ id: -1, sync_id: 'trip-a', name: 'Trip', start_date: '2026-01-01', end_date: '2026-01-02', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
})

describe('packingRepo local-first', () => {
  it('supports item CRUD, toggle and reorder without network access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch'); const a = await packingRepo.create(-1, { name: 'Shoes' }); const b = await packingRepo.create(-1, { name: 'Coat' })
    await packingRepo.update(-1, a.item.id, { checked: true }); await packingRepo.reorder(-1, [b.item.id, a.item.id])
    expect((await packingRepo.list(-1)).items.map(v => [v.name, v.checked])).toEqual([['Coat', 0], ['Shoes', 1]])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('creates bags with stable ids and unlinks items when a bag is deleted', async () => {
    const bag = await packingRepo.createBag(-1, { name: 'Carry-on' }); const item = await packingRepo.create(-1, { name: 'Passport', bag_id: bag.bag.id })
    expect((await offlineDb.packingItems.get(item.item.id))?.bag_sync_id).toBeTruthy()
    await packingRepo.deleteBag(-1, bag.bag.id)
    expect((await offlineDb.packingItems.get(item.item.id))?.bag_id).toBeNull()
    expect((await offlineDb.packingBags.get(bag.bag.id))?.deleted_at).toBeTruthy()
  })

  it('imports, saves and reapplies a local template', async () => {
    await packingRepo.bulkImport(-1, [{ name: 'Hat', category: 'Clothes' }]); await packingRepo.saveAsTemplate(-1, 'Basic')
    const template = (await packingRepo.listTemplates()).templates[0]; const result = await packingRepo.applyTemplate(-1, template.id)
    expect(result.count).toBe(1); expect((await packingRepo.list(-1)).items).toHaveLength(2)
    expect((await offlineDb.syncOutbox.get('packingConfig:personal-packing'))?.operation).toBe('upsert')
  })

  it('joins and leaves an item locally and queues both changes for sync', async () => {
    localStorage.setItem('trek_auth_snapshot', JSON.stringify({ state: { user: { id: 8, username: 'Ada' } } }))
    const created = await packingRepo.create(-1, { name: 'Tent' })

    const joined = await packingRepo.addContributor(-1, created.item.id)
    expect(joined.item.contributors).toEqual([{ user_id: 8, username: 'Ada', status: 'joined' }])

    const left = await packingRepo.removeContributor(-1, created.item.id, 8)
    expect(left.item.contributors).toEqual([])
    expect((await offlineDb.syncOutbox.get(`packingItem:${(await offlineDb.packingItems.get(created.item.id))!.sync_id}`))?.status).toBe('pending')
  })
})
