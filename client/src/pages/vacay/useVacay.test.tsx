import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAll: vi.fn(async (_options?: { refreshWorkspaceMembers?: boolean; showLoading?: boolean }) => {}),
  loadPlan: vi.fn(async () => {}),
  loadEntries: vi.fn(async () => {}),
  loadStats: vi.fn(async () => {}),
  loadHolidays: vi.fn(async () => {}),
  loadShares: vi.fn(async () => {}),
  loadSharedCalendars: vi.fn(async () => {}),
}))

vi.mock('../../store/vacayStore', () => ({
  useVacayStore: () => ({
    years: [2026], selectedYear: 2026, setSelectedYear: vi.fn(), addYear: vi.fn(), removeYear: vi.fn(),
    loading: false, incomingInvites: [], acceptInvite: vi.fn(), declineInvite: vi.fn(),
    plan: null, sharedCalendars: [],
    ...mocks,
  }),
}))

vi.mock('../../api/websocket', () => ({ addListener: vi.fn(), removeListener: vi.fn() }))

import { useVacay } from './useVacay'

describe('useVacay sync refresh', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockClear())
  })

  it('does not reload workspace data after a local-only sync', () => {
    renderHook(() => useVacay())
    mocks.loadAll.mockClear() // Ignore the initial page load.

    act(() => window.dispatchEvent(new CustomEvent('travel-sync-complete', { detail: { pulled: 0 } })))
    expect(mocks.loadAll).not.toHaveBeenCalled()
  })

  it('rehydrates a remote pull without workspace network refresh or page spinner', () => {
    renderHook(() => useVacay())
    mocks.loadAll.mockClear()

    act(() => window.dispatchEvent(new CustomEvent('travel-sync-complete', { detail: { pulled: 1 } })))
    expect(mocks.loadAll).toHaveBeenCalledWith({ refreshWorkspaceMembers: false, showLoading: false })
  })
})
