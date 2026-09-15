import { act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_YEAR_SETTINGS } from '../../../vacay/yearWindow'
import { useAuthStore } from '../../../store/authStore'
import { useVacayStore } from '../../../store/vacayStore'
import { useMVacay } from './useMVacay'

const mocks = vi.hoisted(() => ({
  updateVacationDays: vi.fn(),
}))

vi.mock('../../../pages/vacay/useVacay', () => ({
  useVacay: () => ({
    years: [2026],
    selectedYear: 2026,
    setSelectedYear: vi.fn(),
    loading: false,
    incomingInvites: [],
    acceptInvite: vi.fn(),
    declineInvite: vi.fn(),
    plan: { block_weekends: true, company_holidays_enabled: true, week_start: 1 },
    handleAddNextYear: vi.fn(),
    handleAddPrevYear: vi.fn(),
  }),
}))

vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ error: vi.fn() }),
}))

vi.mock('../../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api/client')>()
  return { ...actual, tripsApi: { ...actual.tripsApi, list: vi.fn(() => new Promise(() => {})) } }
})

describe('useMVacay personal PWA allowance controls', () => {
  beforeEach(() => {
    mocks.updateVacationDays.mockReset()
    useAuthStore.setState({
      user: {
        id: 0,
        username: '旅行者',
        email: 'local@trek.invalid',
        role: 'user',
        avatar_url: null,
        maps_api_key: null,
        created_at: '2026-01-01T00:00:00.000Z',
        mfa_enabled: false,
        must_change_password: false,
      },
      isAuthenticated: true,
    })
    useVacayStore.setState({
      users: [{ id: 0, username: '旅行者', color: '#3b82f6' }],
      selectedUserId: 0,
      stats: [{
        user_id: 0,
        person_name: '旅行者',
        person_color: '#3b82f6',
        year: 2026,
        vacation_days: 30,
        carried_over: 0,
        total_available: 30,
        used: 2,
        remaining: 28,
      }],
      entries: [],
      companyHolidays: [],
      holidays: {},
      incomingShares: [],
      sharedCalendars: [],
      yearSettings: DEFAULT_YEAR_SETTINGS,
      updateVacationDays: mocks.updateVacationDays,
    })
  })

  it('increments and decrements allowance for the standalone user whose id is zero', () => {
    const { result } = renderHook(() => useMVacay(), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    })

    act(() => result.current.allowInc())
    expect(mocks.updateVacationDays).toHaveBeenCalledWith(2026, 31, 0)

    act(() => result.current.allowDec())
    expect(mocks.updateVacationDays).toHaveBeenCalledWith(2026, 29, 0)
  })
})
