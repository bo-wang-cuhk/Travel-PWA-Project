import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllStores, seedStore } from '../../../tests/helpers/store'
import { buildBudgetItem } from '../../../tests/helpers/factories'
import { budgetRepo } from '../../repo/budgetRepo'
import { useTripStore } from '../tripStore'

vi.mock('../../repo/budgetRepo', () => ({
  budgetRepo: {
    list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    setMembers: vi.fn(), togglePaid: vi.fn(), reorderItems: vi.fn(), reorderCategories: vi.fn(),
  },
}))

const repo = vi.mocked(budgetRepo)

beforeEach(() => {
  resetAllStores()
  vi.clearAllMocks()
})

describe('budgetSlice local-first delegation', () => {
  it('loads Budget items from the Repository', async () => {
    const item = buildBudgetItem({ trip_id: 1 })
    repo.list.mockResolvedValue({ items: [item] })
    await useTripStore.getState().loadBudgetItems(1)
    expect(repo.list).toHaveBeenCalledWith(1)
    expect(useTripStore.getState().budgetItems).toEqual([item])
  })

  it('creates and appends the Repository result', async () => {
    const item = buildBudgetItem({ trip_id: 1, name: 'Hotel' })
    repo.create.mockResolvedValue({ item })
    expect(await useTripStore.getState().addBudgetItem(1, { name: 'Hotel' })).toEqual(item)
    expect(useTripStore.getState().budgetItems).toEqual([item])
  })

  it('updates the matching item and refreshes linked Reservations after a price change', async () => {
    const existing = buildBudgetItem({ id: 10, trip_id: 1, name: 'Old' })
    const updated = { ...existing, name: 'New', reservation_id: 9 }
    const loadReservations = vi.fn().mockResolvedValue(undefined)
    seedStore(useTripStore, { budgetItems: [existing], loadReservations })
    repo.update.mockResolvedValue({ item: updated })
    await useTripStore.getState().updateBudgetItem(1, 10, { name: 'New', total_price: 20 })
    expect(useTripStore.getState().budgetItems).toEqual([updated])
    expect(loadReservations).toHaveBeenCalledWith(1)
  })

  it('removes only after the local delete succeeds', async () => {
    const item = buildBudgetItem({ id: 5, trip_id: 1 })
    seedStore(useTripStore, { budgetItems: [item] })
    repo.delete.mockRejectedValueOnce(new Error('local write failed'))
    await expect(useTripStore.getState().deleteBudgetItem(1, 5)).rejects.toThrow('local write failed')
    expect(useTripStore.getState().budgetItems).toEqual([item])
    repo.delete.mockResolvedValueOnce(undefined)
    await useTripStore.getState().deleteBudgetItem(1, 5)
    expect(useTripStore.getState().budgetItems).toEqual([])
  })

  it('replaces member and paid snapshots with Repository results', async () => {
    const item = buildBudgetItem({ id: 7, trip_id: 1, members: [] })
    const members = [{ user_id: 1, username: 'alice', paid: 0 }]
    const withMembers = { ...item, members, persons: 1 }
    const paid = { ...withMembers, members: [{ ...members[0], paid: 1 }] }
    seedStore(useTripStore, { budgetItems: [item] })
    repo.setMembers.mockResolvedValue({ members, item: withMembers })
    await useTripStore.getState().setBudgetItemMembers(1, 7, [1])
    expect(useTripStore.getState().budgetItems).toEqual([withMembers])
    repo.togglePaid.mockResolvedValue({ item: paid })
    await useTripStore.getState().toggleBudgetMemberPaid(1, 7, 1, true)
    expect(useTripStore.getState().budgetItems).toEqual([paid])
  })

  it('uses the persisted Repository order for item and category reordering', async () => {
    const one = buildBudgetItem({ id: 1, trip_id: 1 })
    const two = buildBudgetItem({ id: 2, trip_id: 1 })
    repo.reorderItems.mockResolvedValue({ items: [two, one] })
    await useTripStore.getState().reorderBudgetItems(1, [2, 1])
    expect(useTripStore.getState().budgetItems).toEqual([two, one])
    repo.reorderCategories.mockResolvedValue({ items: [one, two] })
    await useTripStore.getState().reorderBudgetCategories(1, ['food'])
    expect(useTripStore.getState().budgetItems).toEqual([one, two])
  })
})
