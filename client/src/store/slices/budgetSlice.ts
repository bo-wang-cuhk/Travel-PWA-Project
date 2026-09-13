import { budgetRepo } from '../../repo/budgetRepo'
import type { StoreApi } from 'zustand'
import type { TripStoreState } from '../tripStore'
import type { BudgetItem, BudgetItemMember } from '../../types'
import type { BudgetCreateItemRequest, BudgetUpdateItemRequest } from '@trek/shared'

type SetState = StoreApi<TripStoreState>['setState']
type GetState = StoreApi<TripStoreState>['getState']

export interface BudgetSlice {
  loadBudgetItems: (tripId: number | string) => Promise<void>
  addBudgetItem: (tripId: number | string, data: BudgetCreateItemRequest) => Promise<BudgetItem>
  updateBudgetItem: (tripId: number | string, id: number, data: BudgetUpdateItemRequest) => Promise<BudgetItem>
  deleteBudgetItem: (tripId: number | string, id: number) => Promise<void>
  setBudgetItemMembers: (tripId: number | string, itemId: number, userIds: number[]) => Promise<{ members: BudgetItemMember[]; item: BudgetItem }>
  toggleBudgetMemberPaid: (tripId: number | string, itemId: number, userId: number, paid: boolean) => Promise<void>
  reorderBudgetItems: (tripId: number | string, orderedIds: number[]) => Promise<void>
  reorderBudgetCategories: (tripId: number | string, orderedCategories: string[]) => Promise<void>
}

export const createBudgetSlice = (set: SetState, get: GetState): BudgetSlice => ({
  loadBudgetItems: async (tripId) => {
    try {
      const data = await budgetRepo.list(tripId)
      set({ budgetItems: data.items })
    } catch (err: unknown) {
      console.error('Failed to load budget items:', err)
    }
  },

  addBudgetItem: async (tripId, data) => {
    const result = await budgetRepo.create(tripId, data)
    set(state => ({ budgetItems: [...state.budgetItems, result.item] }))
    return result.item
  },

  updateBudgetItem: async (tripId, id, data) => {
    const result = await budgetRepo.update(tripId, id, data)
    set(state => ({ budgetItems: state.budgetItems.map(item => item.id === id ? result.item : item) }))
    if (result.item.reservation_id && data.total_price !== undefined) {
      await get().loadReservations(tripId)
    }
    return result.item
  },

  deleteBudgetItem: async (tripId, id) => {
    await budgetRepo.delete(tripId, id)
    set(state => ({ budgetItems: state.budgetItems.filter(item => item.id !== id) }))
  },

  setBudgetItemMembers: async (tripId, itemId, userIds) => {
    const result = await budgetRepo.setMembers(tripId, itemId, userIds);
    set(state => ({
      budgetItems: state.budgetItems.map(item =>
        item.id === itemId ? { ...item, members: result.members, persons: result.item.persons } : item
      )
    }));
    return result;
  },

  toggleBudgetMemberPaid: async (tripId, itemId, userId, paid) => {
    const result = await budgetRepo.togglePaid(tripId, itemId, userId, paid);
    set(state => ({ budgetItems: state.budgetItems.map(item => item.id === itemId ? result.item : item) }));
  },

  reorderBudgetItems: async (tripId, orderedIds) => {
    const result = await budgetRepo.reorderItems(tripId, orderedIds)
    set({ budgetItems: result.items })
  },

  reorderBudgetCategories: async (tripId, orderedCategories) => {
    const result = await budgetRepo.reorderCategories(tripId, orderedCategories)
    set({ budgetItems: result.items })
  },
})
