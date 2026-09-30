import { fireEvent, render, screen, waitFor } from '../../../../tests/helpers/render'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../tests/helpers/msw/server'
import { resetAllStores, seedStore } from '../../../../tests/helpers/store'
import { buildTrip, buildUser } from '../../../../tests/helpers/factories'
import { useAuthStore } from '../../../store/authStore'
import { useSettingsStore } from '../../../store/settingsStore'
import { tripsApi } from '../../../api/client'
import MNewTripSheet from './MNewTripSheet'

beforeEach(() => {
  resetAllStores()
  useSettingsStore.setState(state => ({ settings: { ...state.settings, language: 'en' } }))
  seedStore(useAuthStore, { user: buildUser({ id: 1, username: 'me' }), isAuthenticated: true })
  server.use(http.get('/api/auth/users', () => HttpResponse.json({ users: [
    { id: 2, username: 'alice' }, { id: 3, username: 'bob' },
  ] })))
})

afterEach(() => vi.restoreAllMocks())

it('shows all directory users on opening the mobile create sheet and adds a selected companion', async () => {
  const addMember = vi.spyOn(tripsApi, 'addMember').mockResolvedValue({} as never)
  const onSave = vi.fn().mockResolvedValue({ trip: buildTrip({ id: 42 }) })
  render(<MNewTripSheet open trip={null} onClose={vi.fn()} onSave={onSave} />)

  await screen.findByText('Travel buddies')
  fireEvent.click(screen.getByText('Add member').closest('button')!)
  expect(await screen.findByRole('button', { name: 'alice' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'bob' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'alice' }))
  fireEvent.change(screen.getByPlaceholderText(/Summer in Japan/i), { target: { value: 'Test trip' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create New Trip' }))

  await waitFor(() => expect(addMember).toHaveBeenCalledWith(42, 'alice'))
})

it('shows current companions and adds a directory user while editing on mobile', async () => {
  const trip = buildTrip({ id: 42 })
  server.use(http.get('/api/trips/42/members', () => HttpResponse.json({ members: [{ id: 4, username: 'cara' }] })))
  const addMember = vi.spyOn(tripsApi, 'addMember').mockResolvedValue({} as never)
  render(<MNewTripSheet open trip={trip} onClose={vi.fn()} onSave={vi.fn()} />)

  await screen.findByText('cara')
  fireEvent.click(screen.getByText('Add member').closest('button')!)
  fireEvent.click(await screen.findByRole('button', { name: 'bob' }))

  await waitFor(() => expect(addMember).toHaveBeenCalledWith(42, 'bob'))
  expect(screen.getByText('bob')).toBeInTheDocument()
})
