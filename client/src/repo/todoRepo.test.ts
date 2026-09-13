import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { todoRepo } from './todoRepo'

beforeEach(async () => {
  await clearAll()
  await offlineDb.trips.put({ id: -1, sync_id: 'trip-a', name: 'Trip', start_date: '2026-01-01', end_date: '2026-01-02', created_at: 'x', updated_at: 'x', deleted_at: null } as never)
})

describe('todoRepo local-first', () => {
  it('creates, updates and toggles without network access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const created = await todoRepo.create(-1, { name: 'Book train', due_date: '2026-01-01' })
    await todoRepo.update(-1, created.item.id, { checked: true, priority: 2 })
    expect((await todoRepo.list(-1)).items[0]).toMatchObject({ name: 'Book train', checked: 1, priority: 2 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('persists ordering and queues each changed item', async () => {
    const first = await todoRepo.create(-1, { name: 'A' }); const second = await todoRepo.create(-1, { name: 'B' })
    await todoRepo.reorder(-1, [second.item.id, first.item.id])
    expect((await todoRepo.list(-1)).items.map(v => v.name)).toEqual(['B', 'A'])
    expect(await offlineDb.syncOutbox.count()).toBe(2)
  })

  it('soft deletes and retains a tombstone for synchronization', async () => {
    const created = await todoRepo.create(-1, { name: 'A' }); await todoRepo.delete(-1, created.item.id)
    expect((await todoRepo.list(-1)).items).toEqual([])
    const row = await offlineDb.todoItems.get(created.item.id)
    expect(row?.deleted_at).toBeTruthy(); expect((await offlineDb.syncOutbox.get(`todo:${row?.sync_id}`))?.operation).toBe('delete')
  })
})
