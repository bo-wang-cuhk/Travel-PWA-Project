import { dayRepo } from '../../repo/dayRepo'
import { dayNoteRepo } from '../../repo/dayNoteRepo'
import type { StoreApi } from 'zustand'
import type { TripStoreState } from '../tripStore'
import type { DayNote } from '../../types'
import { getApiErrorMessage } from '../../types'

type SetState = StoreApi<TripStoreState>['setState']
type GetState = StoreApi<TripStoreState>['getState']

export interface DayNotesSlice {
  updateDayNotes: (tripId: number | string, dayId: number | string, notes: string) => Promise<void>
  updateDayTitle: (tripId: number | string, dayId: number | string, title: string) => Promise<void>
  addDayNote: (tripId: number | string, dayId: number | string, data: Partial<DayNote> & { text: string }) => Promise<DayNote>
  updateDayNote: (tripId: number | string, dayId: number | string, id: number, data: Partial<DayNote>) => Promise<DayNote>
  deleteDayNote: (tripId: number | string, dayId: number | string, id: number) => Promise<void>
  moveDayNote: (tripId: number | string, fromDayId: number | string, toDayId: number | string, noteId: number, sort_order?: number) => Promise<void>
}

export const createDayNotesSlice = (set: SetState, get: GetState): DayNotesSlice => ({
  updateDayNotes: async (tripId, dayId, notes) => {
    try {
      await dayRepo.update(tripId, dayId, { notes })
      set(state => ({
        days: state.days.map(d => d.id === Number.parseInt(String(dayId)) ? { ...d, notes } : d)
      }))
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error updating notes'))
    }
  },

  updateDayTitle: async (tripId, dayId, title) => {
    try {
      await dayRepo.update(tripId, dayId, { title })
      set(state => ({
        days: state.days.map(d => d.id === Number.parseInt(String(dayId)) ? { ...d, title } : d)
      }))
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error updating day name'))
    }
  },

  addDayNote: async (tripId, dayId, data) => {
    try {
      const result = await dayNoteRepo.create(Number(tripId), Number(dayId), data)
      set(state => ({
        dayNotes: {
          ...state.dayNotes,
          [String(dayId)]: [...(state.dayNotes[String(dayId)] || []), result.note],
        }
      }))
      return result.note
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error adding note'))
    }
  },

  updateDayNote: async (tripId, dayId, id, data) => {
    try {
      const result = await dayNoteRepo.update(Number(tripId), Number(dayId), id, data)
      set(state => ({
        dayNotes: {
          ...state.dayNotes,
          [String(dayId)]: (state.dayNotes[String(dayId)] || []).map(n => n.id === id ? result.note : n),
        }
      }))
      return result.note
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error updating note'))
    }
  },

  deleteDayNote: async (tripId, dayId, id) => {
    try {
      await dayNoteRepo.delete(Number(tripId), Number(dayId), id)
      set(state => ({
        dayNotes: {
          ...state.dayNotes,
          [String(dayId)]: (state.dayNotes[String(dayId)] || []).filter(n => n.id !== id),
        }
      }))
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error deleting note'))
    }
  },

  moveDayNote: async (tripId, fromDayId, toDayId, noteId, sort_order = 9999) => {
    const state = get()
    const note = (state.dayNotes[String(fromDayId)] || []).find(n => n.id === noteId)
    if (!note) return

    set(s => ({
      dayNotes: {
        ...s.dayNotes,
        [String(fromDayId)]: (s.dayNotes[String(fromDayId)] || []).filter(n => n.id !== noteId),
      }
    }))

    try {
      const result = await dayNoteRepo.move(Number(tripId), Number(fromDayId), Number(toDayId), noteId, sort_order)
      set(s => ({
        dayNotes: {
          ...s.dayNotes,
          [String(toDayId)]: [...(s.dayNotes[String(toDayId)] || []), result.note],
        }
      }))
    } catch (err: unknown) {
      set(s => ({
        dayNotes: {
          ...s.dayNotes,
          [String(fromDayId)]: [...(s.dayNotes[String(fromDayId)] || []), note],
        }
      }))
      throw new Error(getApiErrorMessage(err, 'Error moving note'))
    }
  },
})
