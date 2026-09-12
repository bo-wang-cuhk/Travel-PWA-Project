import { assignmentRepo } from '../../repo/assignmentRepo'
import type { StoreApi } from 'zustand'
import type { TripStoreState } from '../tripStore'
import type { Assignment, AssignmentsMap } from '../../types'
import { getApiErrorMessage } from '../../types'

type SetState = StoreApi<TripStoreState>['setState']
type GetState = StoreApi<TripStoreState>['getState']

export interface AssignmentsSlice {
  assignPlaceToDay: (tripId: number | string, dayId: number | string, placeId: number | string, position?: number | null) => Promise<Assignment | undefined>
  removeAssignment: (tripId: number | string, dayId: number | string, assignmentId: number) => Promise<void>
  reorderAssignments: (tripId: number | string, dayId: number | string, orderedIds: number[]) => Promise<void>
  moveAssignment: (tripId: number | string, assignmentId: number, fromDayId: number | string, toDayId: number | string, toOrderIndex?: number | null) => Promise<void>
  setAssignments: (assignments: AssignmentsMap) => void
}

export const createAssignmentsSlice = (set: SetState, _get: GetState): AssignmentsSlice => ({
  assignPlaceToDay: async (tripId, dayId, placeId, position) => {
    try {
      const data = await assignmentRepo.create(tripId, dayId, placeId, position)
      const current = await assignmentRepo.listByDay(dayId)
      set(state => ({
        assignments: {
          ...state.assignments,
          [String(dayId)]: current,
        }
      }))
      return data.assignment
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error assigning place'))
    }
  },

  removeAssignment: async (tripId, dayId, assignmentId) => {
    try {
      await assignmentRepo.delete(tripId, dayId, assignmentId)
      const current = await assignmentRepo.listByDay(dayId)
      set(state => ({ assignments: { ...state.assignments, [String(dayId)]: current } }))
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error removing assignment'))
    }
  },

  reorderAssignments: async (tripId, dayId, orderedIds) => {
    try {
      const reordered = await assignmentRepo.reorder(tripId, dayId, orderedIds)
      set(state => ({ assignments: { ...state.assignments, [String(dayId)]: reordered } }))
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error reordering'))
    }
  },

  moveAssignment: async (tripId, assignmentId, fromDayId, toDayId, toOrderIndex = null) => {
    try {
      await assignmentRepo.move(tripId, assignmentId, fromDayId, toDayId, toOrderIndex)
      const [source, target] = await Promise.all([
        assignmentRepo.listByDay(fromDayId),
        assignmentRepo.listByDay(toDayId),
      ])
      set(state => ({ assignments: { ...state.assignments, [String(fromDayId)]: source, [String(toDayId)]: target } }))
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error moving assignment'))
    }
  },

  setAssignments: (assignments) => {
    set({ assignments })
  },
})
